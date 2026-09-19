"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TokenAvatar } from "@/components/token-avatar";
import {
  FEED_QUALIFICATION_RULES,
  buildFeedQualification,
  type FeedEvidence,
  type FeedQualificationState,
} from "@/lib/feed-qualification";
import {
  launchSourceLabel,
  type LaunchEnvelope,
} from "@/lib/launch-source";
import type { UnifiedStreamStatus } from "@/lib/unified-stream";

type FeedMode = "live" | "passed" | "all";

type LaunchTableProps = {
  launches: LaunchEnvelope[];
  now: number;
  status: UnifiedStreamStatus;
  selectedKey: string | null;
  replayIds: Set<string>;
  onScan: (launch: LaunchEnvelope) => void;
};

type FeedStatsResponse = {
  holders: number | null;
  holdersComplete: boolean;
  marketCapUsd: number | null;
  coverage: {
    holders: "ready" | "unavailable";
    marketCap: "ready" | "unavailable";
  };
};

type ActivityReceipt = {
  lastActivityAt: number | null;
};

function launchKey(launch: Pick<LaunchEnvelope, "source" | "id">) {
  return `${launch.source}:${launch.id}`;
}

function ageLabel(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function compactUsd(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: value >= 100_000 ? 0 : 1,
  }).format(value);
}

function statusLabel(state: FeedQualificationState) {
  switch (state) {
    case "active":
      return "ACTIVE";
    case "low-holders":
      return "FEW HOLDERS";
    case "low-market-cap":
      return "LOW MC";
    case "quiet":
      return "QUIET";
    case "data-delayed":
      return "DATA DELAY";
    case "dev-spam":
      return "DEV SPAM";
    case "stale":
      return "STALE";
    default:
      return "CHECKING";
  }
}

function countCreatorBurst(
  launches: LaunchEnvelope[],
  creator: string,
  now: number,
) {
  return launches.filter(
    (launch) =>
      launch.creator === creator &&
      now - launch.seenAt <= FEED_QUALIFICATION_RULES.devFloodWindowMs,
  ).length;
}

async function responseJson<T>(response: Response): Promise<T | null> {
  if (!response.ok) return null;
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function emptyEvidence(): FeedEvidence {
  return {
    holders: null,
    holdersComplete: false,
    marketCapUsd: null,
    lastActivityAt: null,
    statsCoverage: "loading",
    activityCoverage: "loading",
  };
}

async function loadEvidence(launch: LaunchEnvelope): Promise<FeedEvidence> {
  const statsParams = new URLSearchParams({
    source: launch.source,
  });

  if (launch.venue.kind === "pump") {
    statsParams.set("curve", launch.venue.bondingCurve);
    statsParams.set("excludeOwner", launch.venue.bondingCurve);
  }

  const activityAddress =
    launch.venue.kind === "pump"
      ? launch.venue.bondingCurve
      : launch.venue.poolState;

  const [statsResult, activityResult] = await Promise.allSettled([
    fetch(
      `/api/feed-stats/${launch.mint}?${statsParams.toString()}`,
      { cache: "no-store" },
    ).then((response) => responseJson<FeedStatsResponse>(response)),
    fetch(`/api/activity/${activityAddress}`, {
      cache: "no-store",
    }).then((response) => responseJson<ActivityReceipt>(response)),
  ]);

  const stats =
    statsResult.status === "fulfilled" ? statsResult.value : null;
  const activity =
    activityResult.status === "fulfilled" ? activityResult.value : null;

  const holderReady = stats?.coverage.holders === "ready";
  const marketCapReady = stats?.coverage.marketCap === "ready";

  return {
    holders: stats?.holders ?? null,
    holdersComplete: stats?.holdersComplete ?? false,
    marketCapUsd: stats?.marketCapUsd ?? null,
    lastActivityAt: activity?.lastActivityAt ?? null,
    statsCoverage:
      holderReady && marketCapReady
        ? "ready"
        : holderReady || marketCapReady
          ? "partial"
          : "unavailable",
    activityCoverage: activity ? "ready" : "unavailable",
  };
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  let index = 0;

  async function next() {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => next()),
  );
}

export function LaunchTable({
  launches,
  now,
  status,
  selectedKey,
  replayIds,
  onScan,
}: LaunchTableProps) {
  const [feedMode, setFeedMode] = useState<FeedMode>("live");
  const [evidenceByKey, setEvidenceByKey] = useState<
    Record<string, FeedEvidence>
  >({});
  const [copiedMint, setCopiedMint] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    const candidates = launches.slice(0, 16).filter((launch) => {
      const key = launchKey(launch);
      const devBurst = countCreatorBurst(launches, launch.creator, Date.now());
      return (
        !replayIds.has(key) &&
        !requested.current.has(key) &&
        devBurst < FEED_QUALIFICATION_RULES.devFloodLaunches
      );
    });

    if (!candidates.length) return;

    for (const launch of candidates) {
      const key = launchKey(launch);
      requested.current.add(key);
      setEvidenceByKey((current) => ({
        ...current,
        [key]: current[key] ?? emptyEvidence(),
      }));
    }

    void runWithConcurrency(candidates, 4, async (launch) => {
      const evidence = await loadEvidence(launch);
      setEvidenceByKey((current) => ({
        ...current,
        [launchKey(launch)]: evidence,
      }));
    });
  }, [launches, replayIds]);

  useEffect(() => {
    const refresh = () => {
      const candidates = launches.slice(0, 12).filter((launch) => {
        const devBurst = countCreatorBurst(
          launches,
          launch.creator,
          Date.now(),
        );
        return (
          !replayIds.has(launchKey(launch)) &&
          devBurst < FEED_QUALIFICATION_RULES.devFloodLaunches
        );
      });

      void runWithConcurrency(candidates, 3, async (launch) => {
        const evidence = await loadEvidence(launch);
        setEvidenceByKey((current) => ({
          ...current,
          [launchKey(launch)]: evidence,
        }));
      });
    };

    const timer = window.setInterval(refresh, 20_000);
    return () => window.clearInterval(timer);
  }, [launches, replayIds]);

  const rows = useMemo(
    () =>
      launches.map((launch) => {
        const key = launchKey(launch);
        const replay = replayIds.has(key);
        const devLaunchesInWindow = countCreatorBurst(
          launches,
          launch.creator,
          now,
        );
        const evidence = evidenceByKey[key] ?? null;
        const qualification = buildFeedQualification({
          evidence,
          devLaunchesInWindow,
          now,
          seenAt: launch.seenAt,
          replay,
        });

        return {
          launch,
          key,
          replay,
          evidence,
          qualification,
          devLaunchesInWindow,
        };
      }),
    [launches, now, evidenceByKey, replayIds],
  );

  const passedCount = rows.filter(
    (row) => row.qualification.state === "active",
  ).length;

  const liveRows = rows.filter((row) =>
    [
      "checking",
      "active",
      "data-delayed",
    ].includes(row.qualification.state),
  );

  const visibleRows =
    feedMode === "all"
      ? rows
      : feedMode === "passed"
        ? rows.filter((row) => row.qualification.state === "active")
        : liveRows;

  async function copyMint(mint: string) {
    try {
      await navigator.clipboard.writeText(mint);
      setCopiedMint(mint);
      window.setTimeout(() => {
        setCopiedMint((current) => (current === mint ? null : current));
      }, 1500);
    } catch {
      setCopiedMint(null);
    }
  }

  return (
    <>
      <div className="panel-head launch-panel-head">
        <div>
          <span className="section-title">LIVE LAUNCHES</span>
          <span className="section-note">
            new tokens appear immediately · weak launches drop out as checks finish
          </span>
        </div>

        <div className="feed-tabs" role="tablist" aria-label="Launch feed mode">
          <button
            type="button"
            data-active={feedMode === "live"}
            onClick={() => setFeedMode("live")}
          >
            LIVE <b>{liveRows.length}</b>
          </button>
          <button
            type="button"
            data-active={feedMode === "passed"}
            onClick={() => setFeedMode("passed")}
          >
            PASSED <b>{passedCount}</b>
          </button>
          <button
            type="button"
            data-active={feedMode === "all"}
            onClick={() => setFeedMode("all")}
          >
            ALL <b>{rows.length}</b>
          </button>
          <span className="feed-live">
            <i />
            STREAMING
          </span>
        </div>
      </div>

      <div className="qualification-strip human-filter-strip">
        <strong>LIVE FILTERS</strong>
        <span>{FEED_QUALIFICATION_RULES.minHolders}+ holders</span>
        <span>{compactUsd(FEED_QUALIFICATION_RULES.minMarketCapUsd)}+ market cap</span>
        <span>trade activity inside 2m</span>
        <span>hide dev spam at {FEED_QUALIFICATION_RULES.devFloodLaunches}+ launches / 10m</span>
        <span>remove quiet launches after 10m</span>
      </div>

      <div className="table-wrap launch-table-wrap">
        <table className="launch-table launch-table-human">
          <thead>
            <tr>
              <th>AGE</th>
              <th>TOKEN</th>
              <th>HOLDERS</th>
              <th>MARKET CAP</th>
              <th>LAST ACTIVITY</th>
              <th>DEV LAUNCHES</th>
              <th>STATUS</th>
              <th>ACTIONS</th>
            </tr>
          </thead>

          <tbody>
            {visibleRows.map(
              ({
                launch,
                key,
                replay,
                evidence,
                qualification,
                devLaunchesInWindow,
              }) => (
                <tr
                  key={key}
                  className="launch-row-v31"
                  data-selected={selectedKey === key}
                  data-replay={replay}
                  data-signal={qualification.state}
                >
                  <td className="mono age-cell">
                    {replay ? "REPLAY" : ageLabel(launch.seenAt, now)}
                  </td>

                  <td>
                    <div className="token-identity">
                      <TokenAvatar
                        uri={launch.uri}
                        symbol={launch.symbol}
                        mint={launch.mint}
                      />
                      <div className="token-cell">
                        <strong>
                          {"$"}{launch.symbol}
                          {replay && (
                            <em className="replay-chip">REAL TX</em>
                          )}
                        </strong>
                        <span>
                          {launch.name} · {launchSourceLabel(launch.source)}
                        </span>
                      </div>
                    </div>
                  </td>

                  <td>
                    <div className="primary-feed-metric">
                      <strong>
                        {evidence?.statsCoverage === "loading" || !evidence
                          ? "…"
                          : evidence.holders ?? "—"}
                      </strong>
                      <span>
                        {evidence?.holdersComplete === false &&
                        evidence?.holders !== null
                          ? "at least"
                          : "wallets"}
                      </span>
                    </div>
                  </td>

                  <td>
                    <div className="primary-feed-metric market-cap-cell">
                      <strong>
                        {evidence?.statsCoverage === "loading" || !evidence
                          ? "…"
                          : compactUsd(evidence.marketCapUsd)}
                      </strong>
                      <span>current</span>
                    </div>
                  </td>

                  <td>
                    <div className="primary-feed-metric activity-cell">
                      <strong>
                        {!evidence ||
                        evidence.activityCoverage === "loading"
                          ? "…"
                          : evidence.activityCoverage === "unavailable"
                            ? "—"
                            : evidence.lastActivityAt
                              ? ageLabel(evidence.lastActivityAt, now)
                              : "—"}
                      </strong>
                      <span>ago</span>
                    </div>
                  </td>

                  <td>
                    <div
                      className="primary-feed-metric dev-burst"
                      data-flood={
                        devLaunchesInWindow >=
                        FEED_QUALIFICATION_RULES.devFloodLaunches
                      }
                    >
                      <strong>{devLaunchesInWindow}</strong>
                      <span>in 10m</span>
                    </div>
                  </td>

                  <td>
                    <div
                      className="qualification-cell human-status"
                      data-state={qualification.state}
                    >
                      <strong>{statusLabel(qualification.state)}</strong>
                      <span>{qualification.reason}</span>
                    </div>
                  </td>

                  <td>
                    <div className="quick-actions">
                      <button
                        type="button"
                        className="copy-ca-button"
                        onClick={() => void copyMint(launch.mint)}
                        title={launch.mint}
                      >
                        {copiedMint === launch.mint ? "COPIED ✓" : "COPY CA"}
                      </button>
                      <a
                        className="row-explorer-link"
                        href={`https://solscan.io/token/${launch.mint}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        VERIFY ↗
                      </a>
                      <button
                        className="scan-button"
                        type="button"
                        onClick={() => onScan(launch)}
                      >
                        SCAN →
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>

        {!visibleRows.length && (
          <div className="empty-state feed-empty-v31">
            <span className="empty-cursor">▌</span>
            <div>
              <strong>
                {status.state === "error"
                  ? "Live connection is having trouble."
                  : feedMode === "passed"
                    ? "No launch has passed the filters yet."
                    : "Waiting for the next launch…"}
              </strong>
              <span>
                {status.state === "error"
                  ? "The feed will reconnect automatically."
                  : feedMode === "passed"
                    ? "LIVE still shows new tokens while TrenchScan checks them."
                    : "New launches appear here as soon as the chain listener sees them."}
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

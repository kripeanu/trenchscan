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
import type { EarlyBuyerScan, TokenSnapshot } from "@/lib/types";
import type { StonkFunAnalysis } from "@/lib/stonkfun-analysis";

type FeedMode = "qualified" | "watching" | "raw";

type LaunchTableProps = {
  launches: LaunchEnvelope[];
  now: number;
  status: UnifiedStreamStatus;
  selectedKey: string | null;
  replayIds: Set<string>;
  onScan: (launch: LaunchEnvelope) => void;
};

function launchKey(launch: Pick<LaunchEnvelope, "source" | "id">) {
  return \`${launch.source}:${launch.id}\`;
}

function ageLabel(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return \`${seconds}s\`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return \`${minutes}m\`;
  return \`${Math.floor(minutes / 60)}h\`;
}

function pct(value: number | null) {
  return value === null ? "—" : \`${value.toFixed(1)}%\`;
}

function statusLabel(state: FeedQualificationState) {
  switch (state) {
    case "qualified":
      return "QUALIFIED";
    case "rpc-blocked":
      return "RPC BLOCKED";
    case "dev-flood":
      return "DEV FLOOD";
    default:
      return "WATCHING";
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

async function loadPumpEvidence(
  launch: LaunchEnvelope,
): Promise<FeedEvidence> {
  const params = new URLSearchParams({
    fromSlot: String(launch.slot),
    launchSig: launch.signature,
    creator: launch.creator,
  });

  const [snapshotResult, earlyResult] = await Promise.allSettled([
    fetch(\`/api/snapshot/${launch.mint}\`, { cache: "no-store" }).then(
      (response) => responseJson<TokenSnapshot>(response),
    ),
    fetch(
      \`/api/early-buyers/${launch.mint}?${params.toString()}\`,
      { cache: "no-store" },
    ).then((response) => responseJson<EarlyBuyerScan>(response)),
  ]);

  const snapshot =
    snapshotResult.status === "fulfilled" ? snapshotResult.value : null;
  const early =
    earlyResult.status === "fulfilled" ? earlyResult.value : null;

  return {
    sampledExternalAccounts: snapshot?.holders.length ?? null,
    earlyBuyerCount: early?.buyers.length ?? null,
    top1ExternalPct: snapshot?.top1ExternalPct ?? null,
    top10ExternalPct: snapshot?.top10ExternalPct ?? null,
    coverage:
      snapshot && early
        ? "ready"
        : snapshot || early
          ? "partial"
          : "blocked",
  };
}

async function loadStonkEvidence(
  launch: LaunchEnvelope,
): Promise<FeedEvidence> {
  try {
    const response = await fetch(
      \`/api/stonkfun/analyze/${launch.signature}\`,
      { cache: "no-store" },
    );
    const analysis = await responseJson<StonkFunAnalysis>(response);

    if (!analysis) {
      return {
        sampledExternalAccounts: null,
        earlyBuyerCount: null,
        top1ExternalPct: null,
        top10ExternalPct: null,
        coverage: "blocked",
      };
    }

    return {
      sampledExternalAccounts: analysis.distribution?.holders.length ?? null,
      earlyBuyerCount: analysis.earlyBuyers?.buyers.length ?? null,
      top1ExternalPct: analysis.distribution?.top1ExternalPct ?? null,
      top10ExternalPct: analysis.distribution?.top10ExternalPct ?? null,
      coverage:
        analysis.distribution && analysis.earlyBuyers
          ? "ready"
          : analysis.distribution || analysis.earlyBuyers
            ? "partial"
            : "blocked",
    };
  } catch {
    return {
      sampledExternalAccounts: null,
      earlyBuyerCount: null,
      top1ExternalPct: null,
      top10ExternalPct: null,
      coverage: "blocked",
    };
  }
}

export function LaunchTable({
  launches,
  now,
  status,
  selectedKey,
  replayIds,
  onScan,
}: LaunchTableProps) {
  const [feedMode, setFeedMode] = useState<FeedMode>("qualified");
  const [evidenceByKey, setEvidenceByKey] = useState<
    Record<string, FeedEvidence>
  >({});
  const [copiedMint, setCopiedMint] = useState<string | null>(null);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;

    const candidates = launches.slice(0, 10).filter((launch) => {
      const key = launchKey(launch);
      return !replayIds.has(key) && !requested.current.has(key);
    });

    if (!candidates.length) return;

    void (async () => {
      for (const launch of candidates) {
        if (cancelled) break;

        const key = launchKey(launch);
        requested.current.add(key);
        setEvidenceByKey((current) => ({
          ...current,
          [key]: {
            sampledExternalAccounts: null,
            earlyBuyerCount: null,
            top1ExternalPct: null,
            top10ExternalPct: null,
            coverage: "loading",
          },
        }));

        const evidence =
          launch.source === "pump.fun"
            ? await loadPumpEvidence(launch)
            : await loadStonkEvidence(launch);

        if (cancelled) break;
        setEvidenceByKey((current) => ({
          ...current,
          [key]: evidence,
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
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
          replay,
        });

        return {
          launch,
          key,
          replay,
          evidence,
          devLaunchesInWindow,
          qualification,
          ageMs: Math.max(0, now - launch.seenAt),
        };
      }),
    [launches, now, evidenceByKey, replayIds],
  );

  const qualifiedCount = rows.filter(
    (row) => row.qualification.state === "qualified",
  ).length;
  const watchingCount = rows.filter(
    (row) =>
      row.qualification.state !== "qualified" &&
      row.qualification.state !== "dev-flood" &&
      row.ageMs <= FEED_QUALIFICATION_RULES.watchingMaxAgeMs,
  ).length;

  const visibleRows = rows.filter((row) => {
    if (feedMode === "raw") return true;
    if (feedMode === "qualified") {
      return row.qualification.state === "qualified";
    }

    return (
      row.qualification.state !== "qualified" &&
      row.qualification.state !== "dev-flood" &&
      row.ageMs <= FEED_QUALIFICATION_RULES.watchingMaxAgeMs
    );
  });

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
          <span className="section-title">FRESH TRENCHES</span>
          <span className="section-note">
            receipt-qualified discovery · raw firehose stays one click away
          </span>
        </div>
        <div className="feed-tabs" role="tablist" aria-label="Launch feed mode">
          <button
            type="button"
            data-active={feedMode === "qualified"}
            onClick={() => setFeedMode("qualified")}
          >
            QUALIFIED <b>{qualifiedCount}</b>
          </button>
          <button
            type="button"
            data-active={feedMode === "watching"}
            onClick={() => setFeedMode("watching")}
          >
            WATCHING <b>{watchingCount}</b>
          </button>
          <button
            type="button"
            data-active={feedMode === "raw"}
            onClick={() => setFeedMode("raw")}
          >
            RAW <b>{rows.length}</b>
          </button>
          <span className="feed-live">
            <i />
            LIVE
          </span>
        </div>
      </div>

      <div className="qualification-strip">
        <span>
          QUALIFIED = {FEED_QUALIFICATION_RULES.minEarlyBuyers}+ decoded early
          buyers + {FEED_QUALIFICATION_RULES.minSampledExternalAccounts}+
          sampled external accounts
        </span>
        <span>
          DEV FLOOD = {FEED_QUALIFICATION_RULES.devFloodLaunches}+ launches from
          the same creator observed in 10m
        </span>
        <span>no hidden score</span>
      </div>

      <div className="table-wrap launch-table-wrap">
        <table className="launch-table">
          <thead>
            <tr>
              <th>AGE</th>
              <th>TOKEN</th>
              <th>SIGNAL</th>
              <th>PAD</th>
              <th>EARLY CREW</th>
              <th>BAG MAP</th>
              <th>DEV</th>
              <th>QUICK ACTIONS</th>
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
                        <span>{launch.name}</span>
                      </div>
                    </div>
                  </td>

                  <td>
                    <div
                      className="qualification-cell"
                      data-state={qualification.state}
                    >
                      <strong>{statusLabel(qualification.state)}</strong>
                      <span>
                        {qualification.reasons[0] ??
                          "waiting on qualification receipts"}
                      </span>
                    </div>
                  </td>

                  <td>
                    <span className="pad-chip" data-source={launch.source}>
                      {launchSourceLabel(launch.source)}
                    </span>
                  </td>

                  <td>
                    <div className="metric-cell">
                      <strong>{evidence?.earlyBuyerCount ?? "—"}</strong>
                      <span>
                        {evidence?.coverage === "loading"
                          ? "digging…"
                          : "decoded buyers"}
                      </span>
                    </div>
                  </td>

                  <td>
                    <div className="metric-cell">
                      <strong>
                        {evidence?.sampledExternalAccounts ?? "—"}
                      </strong>
                      <span>
                        sampled accts
                        {evidence?.top1ExternalPct !== null &&
                        evidence?.top1ExternalPct !== undefined
                          ? \` · top1 ${pct(evidence.top1ExternalPct)}\`
                          : ""}
                      </span>
                    </div>
                  </td>

                  <td>
                    <div
                      className="dev-burst"
                      data-flood={
                        devLaunchesInWindow >=
                        FEED_QUALIFICATION_RULES.devFloodLaunches
                      }
                    >
                      <strong>{devLaunchesInWindow}</strong>
                      <span>observed / 10m</span>
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
                        href={\`https://solscan.io/token/${launch.mint}\`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open token on Solscan"
                      >
                        SOLSCAN ↗
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
                  ? "RPC is acting cooked."
                  : feedMode === "qualified"
                    ? launches.length
                      ? "Qualifying the latest trenches…"
                      : "Waiting for the next freshy…"
                    : feedMode === "watching"
                      ? "Nothing is in the watching window."
                      : "Waiting for the chain…"}
              </strong>
              <span>
                {status.state === "error"
                  ? status.message ?? "Connection failed."
                  : feedMode === "qualified"
                    ? "Only launches with visible qualification receipts land here. RAW keeps the full firehose."
                    : "Switch tabs any time — TrenchScan never deletes the raw launch receipt."}
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FundingMap } from "@/components/funding-map";
import { TrenchBrand } from "@/components/trench-brand";
import { buildTrenchBrief } from "@/lib/trench-brief";
import { buildProofPack, buildShareText } from "@/lib/proof-pack";
import type { DevHistoryScan, EarlyBuyerScan, EarlyRetentionScan, FundingTrace, Launch, ReplayLaunch, StreamStatus, TokenSnapshot } from "@/lib/types";

const MAX_ROWS = 80;

function short(value: string, left = 5, right = 4) {
  if (value.length <= left + right + 3) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function ageLabel(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function statusCopy(status: StreamStatus) {
  if (status.state === "live") return "LISTENING";
  if (status.state === "error") return "RPC ERROR";
  return "CONNECTING";
}

function pct(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function compactNumber(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function afterLaunchLabel(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `+${seconds}s`;
  return `+${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function beforeLaunchLabel(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s before`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m before`;
  return `${Math.floor(seconds / 3600)}h before`;
}

function historyDate(blockTime: number | null) {
  if (blockTime === null) return "time unknown";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(blockTime * 1000));
}

function walletHistoryLabel(historyClass: FundingTrace["fingerprints"][number]["historyClass"]) {
  switch (historyClass) {
    case "no-prior-history":
      return "NO PRIOR TX";
    case "fresh-1h":
      return "<1H OLD";
    case "fresh-24h":
      return "<24H OLD";
    case "deep-history":
      return "50+ TX";
    case "established":
      return "OLDER";
    default:
      return "UNKNOWN";
  }
}

function looksFresh(historyClass: FundingTrace["fingerprints"][number]["historyClass"]) {
  return (
    historyClass === "no-prior-history" ||
    historyClass === "fresh-1h" ||
    historyClass === "fresh-24h"
  );
}

function totalSupplyPct(amount: number | null, supply: number | null) {
  if (amount === null || supply === null || supply <= 0) return null;
  return (amount / supply) * 100;
}

type SnapshotState = "idle" | "loading" | "ready" | "error";

export function LaunchFeed() {
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [status, setStatus] = useState<StreamStatus>({ state: "connecting" });
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<Launch | null>(null);
  const [snapshot, setSnapshot] = useState<TokenSnapshot | null>(null);
  const [snapshotState, setSnapshotState] = useState<SnapshotState>("idle");
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [earlyBuyers, setEarlyBuyers] = useState<EarlyBuyerScan | null>(null);
  const [earlyState, setEarlyState] = useState<SnapshotState>("idle");
  const [earlyError, setEarlyError] = useState<string | null>(null);
  const [earlyRetention, setEarlyRetention] = useState<EarlyRetentionScan | null>(null);
  const [retentionState, setRetentionState] = useState<SnapshotState>("idle");
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [fundingTrace, setFundingTrace] = useState<FundingTrace | null>(null);
  const [fundingState, setFundingState] = useState<SnapshotState>("idle");
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [devHistory, setDevHistory] = useState<DevHistoryScan | null>(null);
  const [devState, setDevState] = useState<SnapshotState>("idle");
  const [devError, setDevError] = useState<string | null>(null);
  const [replayIds, setReplayIds] = useState<Set<string>>(() => new Set());
  const [replayState, setReplayState] = useState<SnapshotState>("idle");
  const [replayError, setReplayError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [briefCopied, setBriefCopied] = useState(false);
  const activeScan = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    const onStatus = (event: MessageEvent<string>) => {
      try {
        setStatus(JSON.parse(event.data) as StreamStatus);
      } catch {
        setStatus({ state: "error", message: "Bad status payload" });
      }
    };

    const onLaunch = (event: MessageEvent<string>) => {
      try {
        const launch = JSON.parse(event.data) as Launch;
        setLaunches((current) => {
          if (current.some((item) => item.id === launch.id)) return current;
          return [launch, ...current].slice(0, MAX_ROWS);
        });
      } catch {
        // One cursed payload should never take down the trenches.
      }
    };

    source.addEventListener("status", onStatus as EventListener);
    source.addEventListener("launch", onLaunch as EventListener);

    source.onerror = () => {
      setStatus({
        state: "connecting",
        message: "Stream interrupted. Reconnecting…",
      });
    };

    return () => {
      source.removeEventListener("status", onStatus as EventListener);
      source.removeEventListener("launch", onLaunch as EventListener);
      source.close();
    };
  }, []);

  useEffect(() => {
    const signature = new URLSearchParams(window.location.search).get("replay");
    if (signature) void replayRealLaunch(signature);
  }, []);

  const sessionAge = useMemo(() => {
    if (!launches.length) return "—";
    return ageLabel(launches[launches.length - 1].seenAt, now);
  }, [launches, now]);

  async function replayRealLaunch(signature?: string) {
    setReplayState("loading");
    setReplayError(null);

    try {
      const params = signature
        ? `?${new URLSearchParams({ signature }).toString()}`
        : "";
      const response = await fetch(`/api/replay${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ReplayLaunch | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Replay lookup failed",
        );
      }

      setReplayIds((current) => {
        const next = new Set(current);
        next.add(payload.launch.id);
        return next;
      });
      setLaunches((current) => [
        payload.launch,
        ...current.filter((launch) => launch.id !== payload.launch.id),
      ].slice(0, MAX_ROWS));

      const replayUrl = new URL(window.location.href);
      replayUrl.searchParams.set("replay", payload.launch.signature);
      window.history.replaceState(null, "", replayUrl);

      setReplayState("ready");
      void scanLaunch(payload.launch);

      window.setTimeout(() => {
        document
          .getElementById("trench-take")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 250);
    } catch (error) {
      setReplayState("error");
      setReplayError(
        error instanceof Error ? error.message : "Could not replay a real launch",
      );
    }
  }

  async function copyReplayLink() {
    if (!selected) return;

    const replayUrl = new URL(window.location.href);
    replayUrl.searchParams.set("replay", selected.signature);

    try {
      await navigator.clipboard.writeText(replayUrl.toString());
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1800);
    } catch {
      setShareCopied(false);
    }
  }

  async function copyTrenchBrief() {
    if (!selected || !trenchBrief) return;

    const replayUrl = new URL(window.location.href);
    replayUrl.searchParams.set("replay", selected.signature);

    try {
      await navigator.clipboard.writeText(
        buildShareText({
          launch: selected,
          brief: trenchBrief,
          replayUrl: replayUrl.toString(),
        }),
      );
      setBriefCopied(true);
      window.setTimeout(() => setBriefCopied(false), 1800);
    } catch {
      setBriefCopied(false);
    }
  }

  function exportProofPack() {
    if (!selected || !snapshot || !trenchBrief) return;

    const pack = buildProofPack({
      launch: selected,
      snapshot,
      earlyBuyers,
      earlyRetention,
      fundingTrace,
      devHistory,
      trenchBrief,
    });
    const blob = new Blob([JSON.stringify(pack, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeSymbol = selected.symbol.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "token";

    anchor.href = url;
    anchor.download = `trenchscan-${safeSymbol}-${selected.mint.slice(0, 8)}.proof.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function runFullReceiptPass() {
    if (earlyState !== "ready") return;
    void checkDevBaggage();
    if (earlyBuyers?.buyers.length) {
      void checkEarlyRetention();
      void traceFunding();
    }
  }

  async function checkEarlyRetention() {
    if (!selected || !earlyBuyers?.buyers.length) return;

    const scanId = selected.id;
    setEarlyRetention(null);
    setRetentionError(null);
    setRetentionState("loading");

    try {
      const response = await fetch("/api/early-retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          mint: selected.mint,
          buyers: earlyBuyers.buyers.slice(0, 12).map((buyer) => ({
            wallet: buyer.wallet,
            rawFirstBuy: buyer.rawTokenDelta,
          })),
        }),
      });
      const payload = (await response.json()) as
        | EarlyRetentionScan
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Retention scan failed",
        );
      }

      if (activeScan.current !== scanId) return;
      setEarlyRetention(payload);
      setRetentionState("ready");
    } catch (error) {
      if (activeScan.current !== scanId) return;
      setRetentionState("error");
      setRetentionError(
        error instanceof Error
          ? error.message
          : "Could not compare early wallets with current balances",
      );
    }
  }

  async function loadEarlyBuyers(launch: Launch) {
    try {
      const params = new URLSearchParams({
        fromSlot: String(launch.slot),
        launchSig: launch.signature,
        creator: launch.creator,
      });
      const response = await fetch(
        `/api/early-buyers/${launch.mint}?${params.toString()}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as
        | EarlyBuyerScan
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Early-buyer scan failed",
        );
      }

      if (activeScan.current !== launch.id) return;
      setEarlyBuyers(payload);
      setEarlyState("ready");
    } catch (error) {
      if (activeScan.current !== launch.id) return;
      setEarlyState("error");
      setEarlyError(
        error instanceof Error ? error.message : "Could not replay early buyers",
      );
    }
  }

  async function traceFunding() {
    if (!selected || !earlyBuyers?.buyers.length) return;

    const scanId = selected.id;
    setFundingTrace(null);
    setFundingError(null);
    setFundingState("loading");

    try {
      const response = await fetch("/api/funding-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          launchSlot: selected.slot,
          buyers: earlyBuyers.buyers.slice(0, 12).map((buyer) => ({
            wallet: buyer.wallet,
            firstBuySignature: buyer.signature,
            firstBuyBlockTime: buyer.blockTime,
          })),
        }),
      });
      const payload = (await response.json()) as
        | FundingTrace
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Funding trace failed",
        );
      }

      if (activeScan.current !== scanId) return;
      setFundingTrace(payload);
      setFundingState("ready");
    } catch (error) {
      if (activeScan.current !== scanId) return;
      setFundingState("error");
      setFundingError(
        error instanceof Error ? error.message : "Could not trace funding",
      );
    }
  }

  async function checkDevBaggage() {
    if (!selected) return;

    const scanId = selected.id;
    setDevHistory(null);
    setDevError(null);
    setDevState("loading");

    try {
      const params = new URLSearchParams({ before: selected.signature });
      const response = await fetch(
        `/api/dev-history/${selected.creator}?${params.toString()}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as
        | DevHistoryScan
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "Dev history scan failed",
        );
      }

      if (activeScan.current !== scanId) return;
      setDevHistory(payload);
      setDevState("ready");
    } catch (error) {
      if (activeScan.current !== scanId) return;
      setDevState("error");
      setDevError(
        error instanceof Error ? error.message : "Could not sample dev history",
      );
    }
  }

  async function scanLaunch(launch: Launch) {
    activeScan.current = launch.id;
    setShareCopied(false);
    setBriefCopied(false);
    setSelected(launch);
    setSnapshot(null);
    setSnapshotError(null);
    setSnapshotState("loading");
    setEarlyBuyers(null);
    setEarlyError(null);
    setEarlyState("loading");
    setEarlyRetention(null);
    setRetentionError(null);
    setRetentionState("idle");
    setFundingTrace(null);
    setFundingError(null);
    setFundingState("idle");
    setDevHistory(null);
    setDevError(null);
    setDevState("idle");
    void loadEarlyBuyers(launch);

    try {
      const response = await fetch(`/api/snapshot/${launch.mint}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as
        | TokenSnapshot
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Snapshot failed");
      }

      if (activeScan.current !== launch.id) return;
      setSnapshot(payload);
      setSnapshotState("ready");
    } catch (error) {
      if (activeScan.current !== launch.id) return;
      setSnapshotState("error");
      setSnapshotError(
        error instanceof Error ? error.message : "Could not scan token",
      );
    }
  }

  const newestSignals = launches
    .filter((launch) => !replayIds.has(launch.id))
    .slice(0, 5);

  const devHolder =
    snapshot && selected
      ? snapshot.holders.find((holder) => holder.owner === selected.creator)
      : undefined;
  const devBagPct =
    snapshot && devHolder
      ? totalSupplyPct(devHolder.uiAmount, snapshot.uiSupply)
      : null;
  const trenchBrief = snapshot
    ? buildTrenchBrief({
        snapshot,
        earlyBuyers,
        earlyRetention,
        fundingTrace,
        devHistory,
        devBagPct,
      })
    : null;
  const fullPassBusy =
    fundingState === "loading" ||
    devState === "loading" ||
    retentionState === "loading";
  const fullPassDone =
    fundingTrace !== null &&
    devHistory !== null &&
    earlyRetention !== null;

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <TrenchBrand />

        <nav className="main-nav" aria-label="Primary navigation">
          <a className="active" href="#fresh-trenches">Dashboard</a>
          <a href="#fresh-trenches">Tokens</a>
          <a href="#trench-take">Intel</a>
          <span>Watchlist</span>
          <span>Alerts</span>
        </nav>

        <div className="top-actions">
          <span className="chain-pill">
            <i className="solana-glyph" />
            SOLANA
          </span>
          <div className="stream-state" data-state={status.state}>
            <span className="pulse" />
            {statusCopy(status)}
          </div>
        </div>
      </header>

      <section className="hero-strip">
        <div className="hero-copy">
          <p className="eyebrow">SOLANA // ON-CHAIN INTEL FOR TRENCHERS</p>
          <h1>
            Fresh trenches.
            <span> Less bullshit.</span>
          </h1>
          <p className="subcopy">
            See fresh launches as they hit, who dropped them, and who is holding
            the bag before you ape. Pump is live first. More pads come after we
            nail the read.
          </p>
          <div className="hero-actions">
            <a className="primary-cta" href="#fresh-trenches">START SCANNING →</a>
            <button
              className="replay-cta"
              type="button"
              onClick={() => void replayRealLaunch()}
              disabled={replayState === "loading"}
            >
              {replayState === "loading"
                ? "FINDING REAL LAUNCH…"
                : "REPLAY REAL LAUNCH"}
            </button>
            <span className="hero-proof">chain first · receipts visible · no magic score</span>
          </div>
          {replayState === "error" && (
            <div className="replay-message error">
              Couldn&apos;t load replay. {replayError}
            </div>
          )}
          {replayState === "ready" && (
            <div className="replay-message">
              Real on-chain launch loaded. Same decoder, same scan pipeline.
            </div>
          )}
        </div>

        <div className="hero-brief">
          <span>THE PLAYBOOK</span>
          <strong>See the launch.</strong>
          <strong>Read the bags.</strong>
          <strong>Don&apos;t get farmed.</strong>
          <small>live feed + real-launch replay · evidence stays verifiable</small>
        </div>
      </section>

      <section className="stats-grid" aria-label="Session statistics">
        <div className="stat">
          <span>FRESH IN BUFFER</span>
          <strong>{launches.length}</strong>
          <small>recent launches cached by the shared listener</small>
        </div>
        <div className="stat">
          <span>OLDEST IN FEED</span>
          <strong>{sessionAge}</strong>
          <small>still early. eyes open.</small>
        </div>
        <div className="stat">
          <span>LAUNCHPADS</span>
          <strong>PUMP <em>LIVE</em></strong>
          <small>more pads loading after v1</small>
        </div>
        <div className="stat">
          <span>DATA SOURCE</span>
          <strong>ON-CHAIN</strong>
          <small>no scraped fairy tales</small>
        </div>
      </section>

      <section className="dashboard-grid" id="fresh-trenches">
        <div className="panel launch-panel">
          <div className="panel-head">
            <div>
              <span className="section-title">FRESH TRENCHES</span>
              <span className="section-note">live Pump launches + server buffer · newest first</span>
            </div>
            <div className="legend">
              <span className="legend-dot" /> real-time
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>AGE</th>
                  <th>TOKEN</th>
                  <th>PAD</th>
                  <th>MINT</th>
                  <th>DEV</th>
                  <th>MODE</th>
                  <th>TX</th>
                  <th>SCAN</th>
                </tr>
              </thead>
              <tbody>
                {launches.map((launch) => (
                  <tr
                    key={launch.id}
                    data-selected={selected?.id === launch.id}
                    data-replay={replayIds.has(launch.id)}
                  >
                    <td className="mono age-cell">
                      {replayIds.has(launch.id) ? "REPLAY" : ageLabel(launch.seenAt, now)}
                    </td>
                    <td>
                      <div className="token-cell">
                        <strong>
                          ${launch.symbol}
                          {replayIds.has(launch.id) && (
                            <em className="replay-chip">REAL TX</em>
                          )}
                        </strong>
                        <span>{launch.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="pad-chip">PUMP</span>
                    </td>
                    <td className="mono">
                      <a
                        href={`https://solscan.io/token/${launch.mint}`}
                        target="_blank"
                        rel="noreferrer"
                        title={launch.mint}
                      >
                        {short(launch.mint)}
                      </a>
                    </td>
                    <td className="mono">
                      <a
                        href={`https://solscan.io/account/${launch.creator}`}
                        target="_blank"
                        rel="noreferrer"
                        title={launch.creator}
                      >
                        {short(launch.creator)}
                      </a>
                    </td>
                    <td>
                      {launch.isMayhemMode ? (
                        <span className="chip warning">MAYHEM</span>
                      ) : (
                        <span className="chip">STD</span>
                      )}
                    </td>
                    <td className="mono">
                      <a
                        href={`https://solscan.io/tx/${launch.signature}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(launch.signature, 4, 4)} ↗
                      </a>
                    </td>
                    <td>
                      <button
                        className="scan-button"
                        type="button"
                        onClick={() => void scanLaunch(launch)}
                      >
                        {selected?.id === launch.id && snapshotState === "loading"
                          ? "READING…"
                          : "SCAN →"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!launches.length && (
              <div className="empty-state">
                <span className="empty-cursor">▌</span>
                <div>
                  <strong>
                    {status.state === "error"
                      ? "RPC is acting cooked."
                      : "Waiting for the next freshy…"}
                  </strong>
                  <span>
                    {status.state === "error"
                      ? status.message ?? "Connection failed."
                      : "When Pump prints a new launch, it lands here."}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="side-stack">
          <section className="side-panel">
            <div className="side-heading">
              <span>LIVE SIGNALS</span>
              <small>chain events, no fanfic</small>
            </div>
            <div className="signal-list">
              {newestSignals.length ? (
                newestSignals.map((launch) => (
                  <a
                    key={launch.id}
                    className="mini-signal"
                    href={`https://solscan.io/tx/${launch.signature}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <i />
                    <span>
                      <b>${launch.symbol} hit the trenches</b>
                      <small>
                        Pump · {ageLabel(launch.seenAt, now)} · slot {launch.slot.toLocaleString()}
                      </small>
                    </span>
                    <em>↗</em>
                  </a>
                ))
              ) : (
                <div className="side-empty">Waiting on the chain…</div>
              )}
            </div>
          </section>

          <section className="side-panel why-panel">
            <div className="side-heading">
              <span>WHY IT MATTERS</span>
              <small>the actual edge</small>
            </div>
            <ul>
              <li><b>See freshies as they land</b><span>BE EARLY</span></li>
              <li><b>Read who&apos;s holding the bag</b><span>SEE SIZE</span></li>
              <li><b>Spot the dev wallet in the holders</b><span>WATCH DEV</span></li>
              <li><b>Curve stash stays out of whale math</b><span>LESS BS</span></li>
              <li><b>Fresh wallet + funding families</b><span>CONNECT DOTS</span></li>
            </ul>
          </section>
        </aside>
      </section>

      {selected && (
        <section className="scan-panel" id="trench-take" aria-live="polite">
          <div className="scan-heading">
            <div>
              <span className="eyebrow">
                {replayIds.has(selected.id)
                  ? "REPLAY SNAPSHOT // REAL ON-CHAIN TX"
                  : "TRENCH SNAPSHOT // DISTRIBUTION READ"}
              </span>
              <h2>
                ${selected.symbol} <span>{selected.name}</span>
              </h2>
            </div>
            <div className="scan-heading-actions">
              <button
                className="deep-scan-button"
                type="button"
                data-ready={fullPassDone}
                disabled={earlyState !== "ready" || fullPassBusy}
                onClick={runFullReceiptPass}
              >
                {fullPassBusy
                  ? "RUNNING FULL PASS…"
                  : fullPassDone
                    ? "RERUN FULL PASS"
                    : "RUN FULL RECEIPT PASS"}
              </button>
              <button
                className="share-button"
                type="button"
                onClick={() => void copyReplayLink()}
              >
                {shareCopied ? "LINK COPIED ✓" : "COPY REPLAY LINK"}
              </button>
              <a
                className="explorer-link"
                href={`https://solscan.io/token/${selected.mint}`}
                target="_blank"
                rel="noreferrer"
              >
                SOLSCAN ↗
              </a>
              <button
                className="close-button"
                type="button"
                onClick={() => {
                  activeScan.current = null;
                  setSelected(null);
                  setSnapshot(null);
                  setSnapshotState("idle");
                  setEarlyBuyers(null);
                  setEarlyState("idle");
                  setEarlyError(null);
                  setEarlyRetention(null);
                  setRetentionState("idle");
                  setRetentionError(null);
                  setFundingTrace(null);
                  setFundingState("idle");
                  setFundingError(null);
                  setDevHistory(null);
                  setDevState("idle");
                  setDevError(null);
                  setShareCopied(false);
                  setBriefCopied(false);
                }}
              >
                CLOSE ×
              </button>
            </div>
          </div>

          {snapshotState === "loading" && (
            <div className="scan-loading">
              Pulling bags straight from Solana…
            </div>
          )}

          {snapshotState === "error" && (
            <div className="scan-error">
              Couldn&apos;t read the bags. {snapshotError}
            </div>
          )}

          {snapshot && snapshotState === "ready" && (
            <>
              <div className="signal-grid">
                <div className="signal-card">
                  <span>BIGGEST BAG*</span>
                  <strong>{pct(snapshot.top1ExternalPct)}</strong>
                  <small>largest ex-curve account</small>
                </div>
                <div className="signal-card">
                  <span>TOP 10 BAGS*</span>
                  <strong>{pct(snapshot.top10ExternalPct)}</strong>
                  <small>how top-heavy this is</small>
                </div>
                <div className="signal-card">
                  <span>IN THE WILD</span>
                  <strong>{pct(snapshot.externalFloatPct)}</strong>
                  <small>outside the curve stash</small>
                </div>
                <div className="signal-card">
                  <span>CURVE STASH</span>
                  <strong>{pct(snapshot.curveInventoryPct)}</strong>
                  <small>kept out of bag math</small>
                </div>
                <div className="signal-card">
                  <span>DEV BAG</span>
                  <strong>{devBagPct === null ? "not top 20" : pct(devBagPct)}</strong>
                  <small>{devBagPct === null ? "creator not among sampled whales" : "creator share of total supply"}</small>
                </div>
              </div>

              <div className="evidence-bar">
                <span>
                  TOTAL SUPPLY <b>{compactNumber(snapshot.uiSupply)}</b>
                </span>
                <a
                  href={`https://solscan.io/account/${snapshot.bondingCurve}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  CURVE {short(snapshot.bondingCurve)} ↗
                </a>
                <span>sampled {ageLabel(snapshot.sampledAt, now)} ago</span>
                <span>* curve stash excluded from bag concentration</span>
              </div>

              <section className="early-buyers-block">
                <div className="early-head">
                  <div>
                    <strong>WHO APED FIRST?</strong>
                    <span>
                      earliest wallet balance increases we can replay on the Pump curve
                    </span>
                  </div>
                  {earlyBuyers && earlyState === "ready" && (
                    <em data-complete={earlyBuyers.historyComplete}>
                      {earlyBuyers.historyComplete ? "LAUNCH WINDOW FOUND" : "PARTIAL WINDOW"}
                    </em>
                  )}
                </div>

                {earlyState === "loading" && (
                  <div className="early-status">Replaying the first curve trades…</div>
                )}

                {earlyState === "error" && (
                  <div className="early-status error">
                    Early-buyer RPC read failed. Holder snapshot is still valid. {earlyError}
                  </div>
                )}

                {earlyBuyers && earlyState === "ready" && (
                  <>
                    {!earlyBuyers.historyComplete && (
                      <div className="history-warning">
                        BUSY TRENCH: our bounded RPC window did not reach the launch boundary.
                        These are the earliest wallets in the sampled window — not a claim that
                        they were literally first.
                      </div>
                    )}

                    <div className="early-summary">
                      <span><b>{earlyBuyers.buyers.length}</b> EARLY WALLETS DECODED</span>
                      <span><b>{earlyBuyers.signaturesScanned}</b> CURVE TX CHECKED</span>
                      <span><b>{earlyBuyers.transactionsParsed}</b> TX PARSED</span>
                    </div>

                    {earlyBuyers.buyers.length ? (
                      <div className="table-wrap early-table">
                        <table>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>WALLET</th>
                              <th>TOKENS GRABBED</th>
                              <th>% SUPPLY</th>
                              <th>AFTER LAUNCH</th>
                              <th>RECEIPT</th>
                              <th>TAG</th>
                            </tr>
                          </thead>
                          <tbody>
                            {earlyBuyers.buyers.slice(0, 12).map((buyer) => (
                              <tr key={buyer.wallet}>
                                <td className="mono muted">{buyer.rank}</td>
                                <td className="mono">
                                  <a
                                    href={`https://solscan.io/account/${buyer.wallet}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {short(buyer.wallet)} ↗
                                  </a>
                                </td>
                                <td className="mono">
                                  {compactNumber(buyer.uiTokenDelta)}
                                </td>
                                <td className="mono strong-cell">
                                  {pct(buyer.supplyPct)}
                                </td>
                                <td className="mono age-cell">
                                  {afterLaunchLabel(buyer.secondsAfterLaunch)}
                                </td>
                                <td className="mono">
                                  <a
                                    href={`https://solscan.io/tx/${buyer.signature}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {short(buyer.signature, 4, 4)} ↗
                                  </a>
                                </td>
                                <td>
                                  {buyer.isCreator ? (
                                    <span className="chip danger">DEV</span>
                                  ) : (
                                    <span className="chip">EARLY</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="early-status">
                        No external positive token deltas decoded in this window yet.
                      </div>
                    )}

                    {earlyBuyers.buyers.length > 0 && (
                      <section className="retention-block">
                        <div className="retention-head">
                          <div>
                            <strong>WHO JEETED?</strong>
                            <span>
                              first decoded grab vs what each early wallet holds now
                            </span>
                          </div>
                          <button
                            className="trace-button"
                            type="button"
                            onClick={() => void checkEarlyRetention()}
                            disabled={retentionState === "loading"}
                          >
                            {retentionState === "loading"
                              ? "CHECKING BAGS…"
                              : retentionState === "ready"
                                ? "CHECK AGAIN"
                                : "CHECK NOW →"}
                          </button>
                        </div>

                        {retentionState === "error" && (
                          <div className="retention-status error">
                            Couldn&apos;t read current bags. {retentionError}
                          </div>
                        )}

                        {earlyRetention && retentionState === "ready" && (
                          <>
                            <div className="retention-summary">
                              <span>
                                <b>{earlyRetention.jeetedCount + earlyRetention.mostlyJeetedCount}</b>{" "}
                                DUMPED MOST
                              </span>
                              <span>
                                <b>{earlyRetention.trimmedCount}</b> TRIMMED
                              </span>
                              <span>
                                <b>{earlyRetention.holdingCount}</b> STILL HOLDING
                              </span>
                              <span>
                                <b>{earlyRetention.addedCount}</b> ADDED MORE
                              </span>
                            </div>

                            <div className="retention-grid">
                              {earlyRetention.rows.map((row) => (
                                <a
                                  key={row.wallet}
                                  className="retention-card"
                                  data-status={row.status}
                                  href={`https://solscan.io/account/${row.wallet}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <div>
                                    <span>{short(row.wallet)}</span>
                                    <em>{row.status.replace("-", " ").toUpperCase()}</em>
                                  </div>
                                  <strong>{pct(row.retainedPct)}</strong>
                                  <small>
                                    first {compactNumber(row.uiFirstBuy)} → now {compactNumber(row.uiCurrent)}
                                  </small>
                                </a>
                              ))}
                            </div>

                            <div className="retention-caveat">
                              CURRENT BAG CHECK: this compares current balance with the first decoded
                              token increase. It does not reconstruct every later buy/sell or claim PnL.
                            </div>
                          </>
                        )}
                      </section>
                    )}

                    {earlyBuyers.buyers.length >= 2 && (
                      <div className="funding-trace">
                        <div className="funding-cta">
                          <div>
                            <strong>SAME BANKROLL?</strong>
                            <span>
                              read wallet history, direct funders, and one upstream hop
                            </span>
                          </div>
                          <button
                            className="trace-button"
                            type="button"
                            onClick={() => void traceFunding()}
                            disabled={fundingState === "loading"}
                          >
                            {fundingState === "loading"
                              ? "TRACING…"
                              : fundingState === "ready"
                                ? "TRACE AGAIN"
                                : "TRACE FUNDING →"}
                          </button>
                        </div>

                        {fundingState === "error" && (
                          <div className="funding-status error">
                            Funding trace failed. {fundingError}
                          </div>
                        )}

                        {fundingTrace && fundingState === "ready" && (
                          <div className="funding-result">
                            <div className="funding-meta">
                              <span>
                                <b>{fundingTrace.walletsChecked}</b> WALLETS CHECKED
                              </span>
                              <span>
                                <b>
                                  {fundingTrace.fingerprints.filter((fingerprint) =>
                                    looksFresh(fingerprint.historyClass),
                                  ).length}
                                </b>{" "}
                                FRESHIES
                              </span>
                              <span>
                                <b>{fundingTrace.linksFound}</b> DIRECT FUNDERS
                              </span>
                              <span>
                                <b>{fundingTrace.clusters.length}</b> SHARED SOURCES
                              </span>
                              <span>
                                <b>{fundingTrace.upstreamClusters.length}</b> UPSTREAM FAMILIES
                              </span>
                            </div>

                            <div className="fingerprint-strip">
                              {fundingTrace.fingerprints.map((fingerprint) => (
                                <a
                                  key={fingerprint.wallet}
                                  className="fingerprint-card"
                                  data-fresh={looksFresh(fingerprint.historyClass)}
                                  href={`https://solscan.io/account/${fingerprint.wallet}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <span>{short(fingerprint.wallet)}</span>
                                  <strong>{walletHistoryLabel(fingerprint.historyClass)}</strong>
                                  <small>
                                    {fingerprint.sampledSignatures} pre-buy tx sampled
                                  </small>
                                </a>
                              ))}
                            </div>

                            {fundingTrace.links.length > 0 && (
                              <FundingMap trace={fundingTrace} />
                            )}

                            {fundingTrace.clusters.length ? (
                              <div className="cluster-grid">
                                {fundingTrace.clusters.slice(0, 4).map((cluster) => (
                                  <article className="cluster-card" key={cluster.source}>
                                    <div className="cluster-head">
                                      <div>
                                        <span>SHARED DIRECT FUNDER</span>
                                        <a
                                          href={`https://solscan.io/account/${cluster.source}`}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          {short(cluster.source, 6, 5)} ↗
                                        </a>
                                      </div>
                                      <strong>{cluster.memberCount} WALLETS</strong>
                                    </div>

                                    <div className="cluster-links">
                                      {cluster.links.map((link) => (
                                        <div key={link.buyer}>
                                          <a
                                            href={`https://solscan.io/account/${link.buyer}`}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            {short(link.buyer)}
                                          </a>
                                          <span>
                                            {link.amountSol?.toFixed(3) ?? "—"} SOL
                                          </span>
                                          <span>{beforeLaunchLabel(link.secondsBeforeLaunch)}</span>
                                          <a
                                            href={`https://solscan.io/tx/${link.signature}`}
                                            target="_blank"
                                            rel="noreferrer"
                                          >
                                            receipt ↗
                                          </a>
                                        </div>
                                      ))}
                                    </div>
                                  </article>
                                ))}
                              </div>
                            ) : (
                              <div className="funding-status">
                                No shared direct SOL funder found among the wallets we could trace.
                                That is not proof they are unrelated — it just means this direct-funder
                                pass did not connect them.
                              </div>
                            )}

                            {fundingTrace.upstreamClusters.length > 0 && (
                              <section className="upstream-section">
                                <div className="upstream-title">
                                  <strong>ONE HOP DEEPER</strong>
                                  <span>different funders · same upstream source</span>
                                </div>
                                <div className="upstream-grid">
                                  {fundingTrace.upstreamClusters.slice(0, 4).map((cluster) => (
                                    <article className="upstream-card" key={cluster.source}>
                                      <div className="upstream-root">
                                        <span>UPSTREAM SOURCE</span>
                                        <a
                                          href={`https://solscan.io/account/${cluster.source}`}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          {short(cluster.source, 6, 5)} ↗
                                        </a>
                                      </div>
                                      <div className="upstream-score">
                                        <strong>{cluster.buyerCount} EARLY WALLETS</strong>
                                        <span>via {cluster.intermediaryCount} direct funders</span>
                                      </div>
                                      <div className="upstream-paths">
                                        {cluster.links.slice(0, 4).map((link) => (
                                          <div key={link.intermediary}>
                                            <a
                                              href={`https://solscan.io/account/${link.intermediary}`}
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              {short(link.intermediary)}
                                            </a>
                                            <span>←</span>
                                            <a
                                              href={`https://solscan.io/tx/${link.signature}`}
                                              target="_blank"
                                              rel="noreferrer"
                                            >
                                              funding receipt ↗
                                            </a>
                                          </div>
                                        ))}
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              </section>
                            )}

                            <div className="funding-caveat">
                              CLUE, NOT PROOF: wallet age is bounded by sampled history, and shared
                              direct/upstream funders can be CEX or payout infrastructure. TrenchScan
                              shows the receipts without pretending that a funding path proves common ownership.
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </section>

              <section className="dev-baggage-block">
                <div className="dev-baggage-head">
                  <div>
                    <strong>DEV BAGGAGE</strong>
                    <span>recent Pump creates by the same creator wallet</span>
                  </div>
                  <button
                    className="trace-button"
                    type="button"
                    onClick={() => void checkDevBaggage()}
                    disabled={devState === "loading"}
                  >
                    {devState === "loading"
                      ? "DIGGING…"
                      : devState === "ready"
                        ? "CHECK AGAIN"
                        : "CHECK DEV →"}
                  </button>
                </div>

                {devState === "error" && (
                  <div className="dev-baggage-status error">
                    Couldn&apos;t sample the dev wallet. {devError}
                  </div>
                )}

                {devHistory && devState === "ready" && (
                  <>
                    <div className="dev-baggage-meta">
                      <span>
                        <b>{devHistory.priorLaunches.length}</b> PRIOR PUMP CREATES FOUND
                      </span>
                      <span>
                        <b>{devHistory.signaturesSampled}</b> RECENT SIGNATURES SAMPLED
                      </span>
                      <span>
                        <b>{devHistory.transactionsParsed}</b> TX PARSED
                      </span>
                    </div>

                    {devHistory.priorLaunches.length ? (
                      <div className="dev-launch-grid">
                        {devHistory.priorLaunches.map((launch) => (
                          <article className="dev-launch-card" key={launch.signature}>
                            <div>
                              <strong>${launch.symbol}</strong>
                              <span>{launch.name}</span>
                            </div>
                            <div className="dev-launch-meta">
                              <a
                                href={`https://solscan.io/token/${launch.mint}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {short(launch.mint)} ↗
                              </a>
                              <span>{historyDate(launch.blockTime)}</span>
                              {launch.isMayhemMode && (
                                <em>MAYHEM</em>
                              )}
                            </div>
                            <a
                              className="dev-receipt"
                              href={`https://solscan.io/tx/${launch.signature}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              launch receipt ↗
                            </a>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="dev-baggage-status">
                        No prior Pump creates found in this recent wallet-history window.
                        That does <b>not</b> prove this is a first-time dev.
                      </div>
                    )}

                    <div className="dev-baggage-caveat">
                      RECENT WINDOW ONLY: TrenchScan samples the 60 signatures immediately
                      before this launch. We show what we can prove from that window and
                      do not label old launches as rugs without separate evidence.
                    </div>
                  </>
                )}
              </section>

              <div className="snapshot-layout">
                <div className="holder-block">
                  <div className="holder-title">
                    <div>
                      WHO&apos;S HOLDING THE BAG?
                      <span>top external accounts · receipts one click away</span>
                    </div>
                  </div>
                  <div className="table-wrap compact-table">
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>WALLET / LABEL</th>
                          <th>AMOUNT</th>
                          <th>SHARE OF EXTERNAL</th>
                          <th>TAG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.holders.slice(0, 10).map((holder) => (
                          <tr key={holder.tokenAccount}>
                            <td className="mono muted">{holder.rank}</td>
                            <td className="mono">
                              {holder.owner ? (
                                <a
                                  href={`https://solscan.io/account/${holder.owner}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {short(holder.owner)} ↗
                                </a>
                              ) : (
                                "unknown"
                              )}
                            </td>
                            <td className="mono">
                              {compactNumber(holder.uiAmount)}
                            </td>
                            <td className="mono strong-cell">
                              {pct(holder.shareOfExternalPct)}
                            </td>
                            <td>
                              {holder.owner === selected.creator ? (
                                <span className="chip danger">DEV</span>
                              ) : (
                                <span className="chip">WALLET</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <aside className="trench-take">
                  <div className="take-head">
                    <span>TRENCH BRIEF</span>
                    {trenchBrief && (
                      <em data-tone={trenchBrief.tone}>{trenchBrief.label}</em>
                    )}
                  </div>

                  <div className="take-actions">
                    <button
                      type="button"
                      onClick={() => void copyTrenchBrief()}
                    >
                      {briefCopied ? "BRIEF COPIED ✓" : "COPY BRIEF"}
                    </button>
                    <button
                      type="button"
                      onClick={exportProofPack}
                    >
                      EXPORT PROOF JSON
                    </button>
                  </div>

                  <div className="take-list">
                    {trenchBrief?.signals.map((signal) => (
                      <div key={signal.label} data-tone={signal.tone}>
                        <i data-tone={signal.tone} />
                        <span>
                          <b>
                            {signal.label}: <strong>{signal.value}</strong>
                          </b>
                          <small>{signal.detail}</small>
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="bottom-line">
                    <span>BOTTOM LINE</span>
                    <p>{trenchBrief?.bottomLine}</p>
                    <small>
                      Evidence summary, not a buy/sell call. Every relationship
                      above stays one click away from its receipt.
                    </small>
                  </div>
                </aside>
              </div>
            </>
          )}
        </section>
      )}

      <footer className="footer-note">
        <span>TrenchScan v0.14 · built for trenchers · backed by chain data</span>
        <span>live feed + real-launch replay · every signal stays receipt-backed</span>
      </footer>
    </main>
  );
}

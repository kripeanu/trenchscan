"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TrenchBrand } from "@/components/trench-brand";
import type { EarlyBuyerScan, FundingTrace, Launch, StreamStatus, TokenSnapshot } from "@/lib/types";

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

function totalSupplyPct(amount: number | null, supply: number | null) {
  if (amount === null || supply === null || supply <= 0) return null;
  return (amount / supply) * 100;
}

function distributionRead(top10: number | null) {
  if (top10 === null) return { label: "READING BAGS", tone: "neutral" };
  if (top10 >= 70) return { label: "TOP-HEAVY", tone: "danger" };
  if (top10 >= 52) return { label: "WATCH TOP BAGS", tone: "warning" };
  return { label: "BAGS LOOK OK", tone: "good" };
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
  const [fundingTrace, setFundingTrace] = useState<FundingTrace | null>(null);
  const [fundingState, setFundingState] = useState<SnapshotState>("idle");
  const [fundingError, setFundingError] = useState<string | null>(null);
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

  const sessionAge = useMemo(() => {
    if (!launches.length) return "—";
    return ageLabel(launches[launches.length - 1].seenAt, now);
  }, [launches, now]);

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
          wallets: earlyBuyers.buyers
            .slice(0, 12)
            .map((buyer) => buyer.wallet),
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

  async function scanLaunch(launch: Launch) {
    activeScan.current = launch.id;
    setSelected(launch);
    setSnapshot(null);
    setSnapshotError(null);
    setSnapshotState("loading");
    setEarlyBuyers(null);
    setEarlyError(null);
    setEarlyState("loading");
    setFundingTrace(null);
    setFundingError(null);
    setFundingState("idle");
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

  const newestSignals = launches.slice(0, 5);

  const devHolder =
    snapshot && selected
      ? snapshot.holders.find((holder) => holder.owner === selected.creator)
      : undefined;
  const devBagPct =
    snapshot && devHolder
      ? totalSupplyPct(devHolder.uiAmount, snapshot.uiSupply)
      : null;
  const read = snapshot
    ? distributionRead(snapshot.top10ExternalPct)
    : distributionRead(null);

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
            <span className="hero-proof">chain first · receipts visible · no magic score</span>
          </div>
        </div>

        <div className="hero-brief">
          <span>THE PLAYBOOK</span>
          <strong>See the launch.</strong>
          <strong>Read the bags.</strong>
          <strong>Don&apos;t get farmed.</strong>
          <small>who aped first is live · same-bankroll comes next</small>
        </div>
      </section>

      <section className="stats-grid" aria-label="Session statistics">
        <div className="stat">
          <span>FRESH THIS SESSION</span>
          <strong>{launches.length}</strong>
          <small>tokens that actually hit our listener</small>
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
              <span className="section-note">live Pump launches · newest first</span>
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
                  <tr key={launch.id} data-selected={selected?.id === launch.id}>
                    <td className="mono age-cell">{ageLabel(launch.seenAt, now)}</td>
                    <td>
                      <div className="token-cell">
                        <strong>${launch.symbol}</strong>
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
              <li><b>Same-bankroll clusters are next</b><span>CONNECT DOTS</span></li>
            </ul>
          </section>
        </aside>
      </section>

      {selected && (
        <section className="scan-panel" id="trench-take" aria-live="polite">
          <div className="scan-heading">
            <div>
              <span className="eyebrow">TRENCH SNAPSHOT // DISTRIBUTION READ</span>
              <h2>
                ${selected.symbol} <span>{selected.name}</span>
              </h2>
            </div>
            <div className="scan-heading-actions">
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
                  setFundingTrace(null);
                  setFundingState("idle");
                  setFundingError(null);
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

                    {earlyBuyers.buyers.length >= 2 && (
                      <div className="funding-trace">
                        <div className="funding-cta">
                          <div>
                            <strong>SAME BANKROLL?</strong>
                            <span>
                              trace the most recent direct SOL funder for the first 12 wallets
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
                                <b>{fundingTrace.linksFound}</b> DIRECT FUNDERS FOUND
                              </span>
                              <span>
                                <b>{fundingTrace.clusters.length}</b> SHARED SOURCES
                              </span>
                            </div>

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

                            <div className="funding-caveat">
                              CLUE, NOT PROOF: a CEX hot wallet or payout service can fund unrelated
                              traders. TrenchScan calls this a shared direct funder, not shared ownership.
                            </div>
                          </div>
                        )}
                      </div>
                    )}
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
                    <span>TRENCH TAKE</span>
                    <em data-tone={read.tone}>{read.label}</em>
                  </div>

                  <div className="take-list">
                    <div>
                      <i />
                      <span>
                        <b>Top 10 bags: {pct(snapshot.top10ExternalPct)}</b>
                        <small>
                          {snapshot.top10ExternalPct !== null && snapshot.top10ExternalPct >= 70
                            ? "That is top-heavy. Keep both eyes open."
                            : snapshot.top10ExternalPct !== null && snapshot.top10ExternalPct >= 52
                              ? "Not instantly cooked, but the top bags matter."
                              : "Distribution is not screaming whale wall from this read."}
                        </small>
                      </span>
                    </div>
                    <div>
                      <i />
                      <span>
                        <b>{pct(snapshot.externalFloatPct)} in the wild</b>
                        <small>External float after removing the Pump curve stash.</small>
                      </span>
                    </div>
                    <div>
                      <i />
                      <span>
                        <b>Curve stash: {pct(snapshot.curveInventoryPct)}</b>
                        <small>We exclude this before calling anything a whale.</small>
                      </span>
                    </div>
                    <div>
                      <i />
                      <span>
                        <b>
                          Dev bag: {devBagPct === null ? "not in sampled top 20" : pct(devBagPct)}
                        </b>
                        <small>Creator wallet is explicitly tagged when it shows up.</small>
                      </span>
                    </div>
                  </div>

                  <div className="bottom-line">
                    <span>BOTTOM LINE</span>
                    <p>
                      No fairy tales: bags + first buyers are chain-derived reads.
                      The same-bankroll trace only flags shared direct funders —
                      a clue, not proof of common control. Dev baggage comes next.
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}
        </section>
      )}

      <footer className="footer-note">
        <span>TrenchScan v0.2 · built for trenchers · backed by chain data</span>
        <span>who aped first? live · same bankroll? live · next: dev baggage</span>
      </footer>
    </main>
  );
}

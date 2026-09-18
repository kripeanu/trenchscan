"use client";

import { useEffect, useMemo, useState } from "react";
import { TrenchBrand } from "@/components/trench-brand";
import type { Launch, StreamStatus, TokenSnapshot } from "@/lib/types";

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

  async function scanLaunch(launch: Launch) {
    setSelected(launch);
    setSnapshot(null);
    setSnapshotError(null);
    setSnapshotState("loading");

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

      setSnapshot(payload);
      setSnapshotState("ready");
    } catch (error) {
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
          <small>same-bankroll + early-buyer intel is next</small>
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
                  setSelected(null);
                  setSnapshot(null);
                  setSnapshotState("idle");
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
                      No fairy tales: this is a holder-distribution read, not a
                      magic risk score. Same-bankroll, early buyers and dev
                      baggage are the next layer.
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
        <span>next: who aped first? · same bankroll? · dev baggage</span>
      </footer>
    </main>
  );
}

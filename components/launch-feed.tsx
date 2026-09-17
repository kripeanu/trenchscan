"use client";

import { useEffect, useMemo, useState } from "react";
import type { Launch, StreamStatus } from "@/lib/types";

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

export function LaunchFeed() {
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [status, setStatus] = useState<StreamStatus>({ state: "connecting" });
  const [now, setNow] = useState(Date.now());

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
        // A malformed row should never take down the terminal.
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

  return (
    <main className="terminal-shell">
      <header className="topbar">
        <div className="brand-row">
          <div className="wordmark">
            <span className="mark">TS</span>
            <span>TrenchScan</span>
          </div>
          <span className="tagline">SCAN FIRST. APE SECOND.</span>
        </div>

        <div className="stream-state" data-state={status.state}>
          <span className="pulse" />
          {statusCopy(status)}
        </div>
      </header>

      <section className="hero-strip">
        <div>
          <p className="eyebrow">LIVE TRENCHES / SOLANA</p>
          <h1>Fresh launches. No fairy tales.</h1>
          <p className="subcopy">
            Listening straight to Pump&apos;s on-chain program. The feed only shows
            launches we actually observed and decoded.
          </p>
        </div>
        <div className="stats-grid" aria-label="Session statistics">
          <div className="stat">
            <span>CAPTURED</span>
            <strong>{launches.length}</strong>
          </div>
          <div className="stat">
            <span>OLDEST IN BUFFER</span>
            <strong>{sessionAge}</strong>
          </div>
          <div className="stat">
            <span>SOURCE</span>
            <strong>PUMP</strong>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="section-title">NEW LAUNCHES</span>
            <span className="section-note">confirmed on-chain</span>
          </div>
          <div className="legend">
            <span className="legend-dot" /> newest first
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>AGE</th>
                <th>TOKEN</th>
                <th>MINT</th>
                <th>CREATOR</th>
                <th>MODE</th>
                <th>TX</th>
              </tr>
            </thead>
            <tbody>
              {launches.map((launch) => (
                <tr key={launch.id}>
                  <td className="mono muted">{ageLabel(launch.seenAt, now)}</td>
                  <td>
                    <div className="token-cell">
                      <strong>${launch.symbol}</strong>
                      <span>{launch.name}</span>
                    </div>
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
                    ) : launch.isHolderReward ? (
                      <span className="chip info">HOLDER</span>
                    ) : (
                      <span className="chip">NORMAL</span>
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
                </tr>
              ))}
            </tbody>
          </table>

          {!launches.length && (
            <div className="empty-state">
              <span className="empty-cursor">▌</span>
              {status.state === "error"
                ? status.message ?? "RPC connection failed."
                : "Waiting for the next launch…"}
            </div>
          )}
        </div>
      </section>

      <footer className="footer-note">
        <span>v0.1 / raw launch feed</span>
        <span>next: dev history · early buyers · wallet clusters</span>
      </footer>
    </main>
  );
}

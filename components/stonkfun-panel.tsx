"use client";

import { useEffect, useRef, useState } from "react";
import type { StonkFunAnalysis } from "@/lib/stonkfun-analysis";
import type { LaunchEnvelope } from "@/lib/launch-source";

const VERIFIED_STONKFUN_SIGNATURE =
  "36T8KBJ5nYvb7mnuZp4ApqPpzzHDYXDuYnewZadGe4GfBXasGwx2YdXG37WuAaLWUzU1Wa83dGVzYab9NP6AviUu";

function short(value: string, left = 6, right = 5) {
  if (value.length <= left + right + 3) return value;
  return value.slice(0, left) + "…" + value.slice(-right);
}

function pct(value: number | null) {
  return value === null ? "—" : value.toFixed(1) + "%";
}

function compact(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function coverageCopy(value: "receipt" | "rpc-blocked") {
  return value === "receipt" ? "RECEIPT" : "RPC BLOCKED";
}

type PanelState = "idle" | "loading" | "ready" | "error";

type StonkFunPanelProps = {
  launch?: LaunchEnvelope;
  signature?: string;
  autoLoad?: boolean;
  replay?: boolean;
  onClose?: () => void;
};

export function StonkFunPanel({
  launch,
  signature = VERIFIED_STONKFUN_SIGNATURE,
  autoLoad = false,
  replay = false,
  onClose,
}: StonkFunPanelProps = {}) {
  const [state, setState] = useState<PanelState>("idle");
  const [analysis, setAnalysis] = useState<StonkFunAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRequest = useRef(0);

  async function loadReceipt(targetSignature = signature) {
    const requestId = ++activeRequest.current;
    setState("loading");
    setError(null);

    try {
      const response = await fetch(
        "/api/stonkfun/analyze/" + targetSignature,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as
        | StonkFunAnalysis
        | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "StonkFun analysis failed",
        );
      }

      if (activeRequest.current !== requestId) return;
      setAnalysis(payload);
      setState("ready");
    } catch (caught) {
      if (activeRequest.current !== requestId) return;
      setAnalysis(null);
      setState("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load verified StonkFun receipt",
      );
    }
  }

  useEffect(() => {
    setAnalysis(null);
    setError(null);
    setState(autoLoad ? "loading" : "idle");

    if (autoLoad) void loadReceipt(signature);
    // loadReceipt only closes over the current signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => {
      activeRequest.current += 1;
    };
  }, [autoLoad, signature]);

  return (
    <section className="stonkfun-panel" id={launch ? "trench-take" : "stonkfun-intel"} aria-live="polite">
      <div className="stonkfun-panel-head">
        <div>
          <span className="eyebrow">
            {replay
              ? "STONKFUN REPLAY // REAL ON-CHAIN TX"
              : "STONKFUN // SOURCE-AWARE INTEL"}
          </span>
          <h2>
            {launch ? `$${launch.symbol} ` : "Same chain. "}
            <span>{launch ? launch.name : "Different launch semantics."}</span>
          </h2>
          <p>
            StonkFun runs on Raydium LaunchLab, so TrenchScan verifies its own
            platform config, pool, vault and buy instructions instead of
            recycling Pump assumptions.
          </p>
        </div>

        <div className="stonkfun-panel-actions">
          <button
            type="button"
            className="stonkfun-load-button"
            disabled={state === "loading"}
            onClick={() => void loadReceipt()}
          >
            {state === "loading"
              ? "PULLING RECEIPTS…"
              : state === "ready"
                ? "RERUN RECEIPTS"
                : launch
                  ? "SCAN STONKFUN →"
                  : "LOAD VERIFIED STONKFUN →"}
          </button>
          {onClose && (
            <button className="close-button" type="button" onClick={onClose}>
              CLOSE ×
            </button>
          )}
        </div>
      </div>

      {state === "idle" && (
        <div className="stonkfun-empty">
          <strong>MAINNET FIXTURE READY</strong>
          <span>
            {launch
              ? `${launch.symbol} · LaunchLab launch receipt ready for source-aware analysis`
              : "RRM · Token-2022 reward-mode LaunchLab initialize · exact receipt pinned in the repo"}
          </span>
        </div>
      )}

      {state === "error" && (
        <div className="stonkfun-error">
          <strong>RPC GOT IN THE WAY</strong>
          <span>{error}</span>
          <small>
            The source receipt stays verified; missing analysis layers are not
            replaced with guesses.
          </small>
        </div>
      )}

      {analysis && state === "ready" && (
        <>
          <div className="stonkfun-proof-strip">
            <div data-state="ready">
              <span>LAUNCH</span>
              <strong>RECEIPT</strong>
            </div>
            <div data-state={analysis.coverage.distribution === "receipt" ? "ready" : "error"}>
              <span>BAG MAP</span>
              <strong>{coverageCopy(analysis.coverage.distribution)}</strong>
            </div>
            <div data-state={analysis.coverage.earlyBuyers === "receipt" ? "ready" : "error"}>
              <span>EARLY CREW</span>
              <strong>{coverageCopy(analysis.coverage.earlyBuyers)}</strong>
            </div>
          </div>

          <div className="stonkfun-launch-card">
            <div className="stonkfun-launch-main">
              <span className="stonkfun-badge">STONKFUN</span>
              <h3>
                {"$" + analysis.launch.symbol}
                <small>{analysis.launch.name}</small>
              </h3>
              <div className="stonkfun-launch-tags">
                <span>{analysis.launch.variant}</span>
                {analysis.launch.rewardMode && <span>REWARD MODE</span>}
                <span>{analysis.launch.decimals} DECIMALS</span>
              </div>
            </div>

            <div className="stonkfun-launch-receipts">
              <a href={"https://solscan.io/tx/" + analysis.launch.signature} target="_blank" rel="noreferrer">
                LAUNCH TX {short(analysis.launch.signature)} ↗
              </a>
              <a href={"https://solscan.io/token/" + analysis.launch.mint} target="_blank" rel="noreferrer">
                MINT {short(analysis.launch.mint)} ↗
              </a>
              <a href={"https://solscan.io/account/" + analysis.launch.poolState} target="_blank" rel="noreferrer">
                POOL {short(analysis.launch.poolState)} ↗
              </a>
              <a href={"https://solscan.io/account/" + analysis.launch.platformConfig} target="_blank" rel="noreferrer">
                PLATFORM {short(analysis.launch.platformConfig)} ↗
              </a>
            </div>
          </div>

          <div className="stonkfun-grid">
            <section className="stonkfun-block">
              <div className="stonkfun-block-head">
                <strong>WHO&apos;S HOLDING THE BAG?</strong>
                <span>LaunchLab base vault excluded from whale math</span>
              </div>

              {analysis.distribution ? (
                <>
                  <div className="stonkfun-metrics">
                    <div><span>BIGGEST BAG*</span><strong>{pct(analysis.distribution.top1ExternalPct)}</strong></div>
                    <div><span>TOP 10 BAGS*</span><strong>{pct(analysis.distribution.top10ExternalPct)}</strong></div>
                    <div><span>IN THE WILD</span><strong>{pct(analysis.distribution.externalFloatPct)}</strong></div>
                    <div><span>SUPPLY</span><strong>{compact(analysis.distribution.uiSupply)}</strong></div>
                  </div>

                  <div className="stonkfun-exclusions">
                    {analysis.distribution.excludedInventory.map((row) => (
                      <a key={row.tokenAccount} href={"https://solscan.io/account/" + row.tokenAccount} target="_blank" rel="noreferrer">
                        <span>{row.label}</span>
                        <strong>{pct(row.supplyPct)}</strong>
                        <small>{short(row.tokenAccount)} ↗</small>
                      </a>
                    ))}
                  </div>
                </>
              ) : (
                <div className="stonkfun-layer-blocked">
                  BAG MAP RPC BLOCKED
                  <small>
                    Launch receipt remains valid. No holder percentages were inferred.
                  </small>
                </div>
              )}
            </section>

            <section className="stonkfun-block">
              <div className="stonkfun-block-head">
                <strong>WHO APED FIRST?</strong>
                <span>exact LaunchLab buy + positive base-token delta</span>
              </div>

              {analysis.earlyBuyers ? (
                <>
                  <div className="stonkfun-early-meta">
                    <span><b>{analysis.earlyBuyers.buyers.length}</b> WALLETS</span>
                    <span><b>{analysis.earlyBuyers.buyTransactionsSeen}</b> BUY TX</span>
                    <span><b>{analysis.earlyBuyers.transactionsParsed}</b> PARSED</span>
                    <span>
                      {analysis.earlyBuyers.historyComplete
                        ? "LAUNCH BOUNDARY REACHED"
                        : "PARTIAL WINDOW"}
                    </span>
                  </div>

                  {analysis.earlyBuyers.buyers.length ? (
                    <div className="stonkfun-buyers">
                      {analysis.earlyBuyers.buyers.slice(0, 8).map((buyer) => (
                        <a key={buyer.wallet} href={"https://solscan.io/tx/" + buyer.signature} target="_blank" rel="noreferrer">
                          <span>#{buyer.rank}</span>
                          <strong>{short(buyer.wallet)}</strong>
                          <span>{buyer.buyVariant.replaceAll("_", " ")}</span>
                          <span>{pct(buyer.supplyPct)}</span>
                          <small>receipt ↗</small>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="stonkfun-layer-empty">
                      No verified buyer rows in this bounded replay window.
                    </div>
                  )}
                </>
              ) : (
                <div className="stonkfun-layer-blocked">
                  EARLY CREW RPC BLOCKED
                  <small>
                    TrenchScan will not reuse Pump buyer semantics as a fallback.
                  </small>
                </div>
              )}
            </section>
          </div>

          <div className="stonkfun-unsupported-grid" aria-label="Source limitations">
            <div>
              <span>WHO JEETED</span>
              <strong>NOT VERIFIED FOR LAUNCHLAB YET</strong>
            </div>
            <div>
              <span>SAME BANKROLL</span>
              <strong>SOURCE-SPECIFIC ADAPTER PENDING</strong>
            </div>
            <div>
              <span>DEV BAGGAGE</span>
              <strong>NO PUMP SEMANTICS REUSED</strong>
            </div>
          </div>

          <div className="stonkfun-caveat">
            SOURCE GATED: StonkFun attribution requires Raydium LaunchLab +
            supported initialize discriminator + known StonkFun platform config.
            Shared LaunchLab infrastructure alone is never enough.
          </div>
        </>
      )}
    </section>
  );
}

import type { Connection } from "@solana/web3.js";
import { buildDevHistoryScan } from "./dev-history";
import { buildEarlyBuyerScan } from "./early-buyers";
import { buildEarlyRetentionScan } from "./early-retention";
import { buildFundingTrace } from "./funding-links";
import { buildProofPack } from "./proof-pack";
import { loadReplayLaunchBySignature } from "./replay";
import { buildTokenSnapshot } from "./snapshot";
import { buildTrenchBrief } from "./trench-brief";
import type {
  DevHistoryScan,
  EarlyBuyerScan,
  EarlyRetentionScan,
  FundingTrace,
  Launch,
  TokenSnapshot,
} from "./types";

export const ANALYSIS_SCHEMA_VERSION = 3 as const;

export type AnalysisStage =
  | "launch"
  | "snapshot"
  | "earlyBuyers"
  | "earlyRetention"
  | "fundingTrace"
  | "devHistory";

export type AnalysisWarning = {
  stage: AnalysisStage;
  message: string;
};

export type AnalysisStageState = "ready" | "error" | "skipped";

export type AnalysisCoverageRow = {
  stage: AnalysisStage;
  state: AnalysisStageState;
  message?: string;
};

export type AnalysisCoverage = {
  complete: boolean;
  readyStages: number;
  totalStages: number;
  stages: AnalysisCoverageRow[];
};

export type AnalysisTiming = Partial<Record<AnalysisStage | "total", number>>;

export type FullAnalysis = {
  schemaVersion: typeof ANALYSIS_SCHEMA_VERSION;
  analyzedAt: number;
  launch: Launch;
  snapshot: TokenSnapshot | null;
  earlyBuyers: EarlyBuyerScan | null;
  earlyRetention: EarlyRetentionScan | null;
  fundingTrace: FundingTrace | null;
  devHistory: DevHistoryScan | null;
  trenchBrief: ReturnType<typeof buildTrenchBrief>;
  proofPack: ReturnType<typeof buildProofPack>;
  coverage: AnalysisCoverage;
  warnings: AnalysisWarning[];
  timingsMs: AnalysisTiming;
};

function elapsed(start: number) {
  return Math.max(0, Date.now() - start);
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Unknown RPC error";
}

function coverageRow(
  stage: AnalysisStage,
  state: AnalysisStageState,
  message?: string,
): AnalysisCoverageRow {
  return message ? { stage, state, message } : { stage, state };
}

export function buildAnalysisCoverage(
  rows: AnalysisCoverageRow[],
): AnalysisCoverage {
  const readyStages = rows.filter((row) => row.state === "ready").length;
  const requiredRows = rows.filter((row) => row.state !== "skipped");

  return {
    complete:
      requiredRows.length > 0 &&
      requiredRows.every((row) => row.state === "ready"),
    readyStages,
    totalStages: rows.length,
    stages: rows,
  };
}

export function deriveDevBagPct(
  snapshot: TokenSnapshot | null,
  creator: string,
): number | null {
  if (!snapshot || snapshot.uiSupply === null || snapshot.uiSupply <= 0) {
    return null;
  }

  const holder = snapshot.holders.find((row) => row.owner === creator);
  if (!holder || holder.uiAmount === null) return null;

  return (holder.uiAmount / snapshot.uiSupply) * 100;
}

/**
 * Runs TrenchScan's receipt-backed evidence pipeline from one exact Pump
 * create_v2 transaction.
 *
 * The launch receipt is the only hard requirement. Every downstream evidence
 * layer degrades independently, so an RPC throttle never turns already-proven
 * evidence into a generic 502.
 */
export async function analyzeLaunchSignature(
  connection: Connection,
  signature: string,
): Promise<FullAnalysis | null> {
  const totalStart = Date.now();
  const timingsMs: AnalysisTiming = {};
  const warnings: AnalysisWarning[] = [];
  const coverageRows: AnalysisCoverageRow[] = [];

  const launchStart = Date.now();
  const replay = await loadReplayLaunchBySignature(connection, signature);
  timingsMs.launch = elapsed(launchStart);

  if (!replay) return null;

  const launch = replay.launch;
  coverageRows.push(coverageRow("launch", "ready"));

  const snapshotStart = Date.now();
  const earlyStart = Date.now();
  const devStart = Date.now();

  const [snapshotResult, earlyResult, devResult] = await Promise.allSettled([
    buildTokenSnapshot(connection, launch.mint),
    buildEarlyBuyerScan(
      connection,
      launch.mint,
      launch.slot,
      launch.signature,
      launch.creator,
    ),
    buildDevHistoryScan(connection, launch.creator, launch.signature),
  ]);

  timingsMs.snapshot = elapsed(snapshotStart);
  timingsMs.earlyBuyers = elapsed(earlyStart);
  timingsMs.devHistory = elapsed(devStart);

  let snapshot: TokenSnapshot | null = null;
  let earlyBuyers: EarlyBuyerScan | null = null;
  let devHistory: DevHistoryScan | null = null;

  if (snapshotResult.status === "fulfilled") {
    snapshot = snapshotResult.value;
    coverageRows.push(coverageRow("snapshot", "ready"));
  } else {
    const message = messageFrom(snapshotResult.reason);
    warnings.push({ stage: "snapshot", message });
    coverageRows.push(coverageRow("snapshot", "error", message));
  }

  if (earlyResult.status === "fulfilled") {
    earlyBuyers = earlyResult.value;
    coverageRows.push(coverageRow("earlyBuyers", "ready"));
  } else {
    const message = messageFrom(earlyResult.reason);
    warnings.push({ stage: "earlyBuyers", message });
    coverageRows.push(coverageRow("earlyBuyers", "error", message));
  }

  if (devResult.status === "fulfilled") {
    devHistory = devResult.value;
    coverageRows.push(coverageRow("devHistory", "ready"));
  } else {
    const message = messageFrom(devResult.reason);
    warnings.push({ stage: "devHistory", message });
    coverageRows.push(coverageRow("devHistory", "error", message));
  }

  let earlyRetention: EarlyRetentionScan | null = null;
  let fundingTrace: FundingTrace | null = null;

  if (earlyBuyers?.buyers.length) {
    const retentionStart = Date.now();
    const fundingStart = Date.now();

    const [retentionResult, fundingResult] = await Promise.allSettled([
      buildEarlyRetentionScan(
        connection,
        launch.mint,
        earlyBuyers.buyers.slice(0, 12).map((buyer) => ({
          wallet: buyer.wallet,
          rawFirstBuy: buyer.rawTokenDelta,
        })),
      ),
      buildFundingTrace(
        connection,
        earlyBuyers.buyers.slice(0, 12).map((buyer) => ({
          wallet: buyer.wallet,
          firstBuySignature: buyer.signature,
          firstBuyBlockTime: buyer.blockTime,
        })),
        launch.slot,
      ),
    ]);

    timingsMs.earlyRetention = elapsed(retentionStart);
    timingsMs.fundingTrace = elapsed(fundingStart);

    if (retentionResult.status === "fulfilled") {
      earlyRetention = retentionResult.value;
      coverageRows.push(coverageRow("earlyRetention", "ready"));
    } else {
      const message = messageFrom(retentionResult.reason);
      warnings.push({ stage: "earlyRetention", message });
      coverageRows.push(coverageRow("earlyRetention", "error", message));
    }

    if (fundingResult.status === "fulfilled") {
      fundingTrace = fundingResult.value;
      coverageRows.push(coverageRow("fundingTrace", "ready"));
    } else {
      const message = messageFrom(fundingResult.reason);
      warnings.push({ stage: "fundingTrace", message });
      coverageRows.push(coverageRow("fundingTrace", "error", message));
    }
  } else {
    const reason = earlyBuyers
      ? "No decoded early buyers were available for this layer."
      : "Skipped because the early-buyer replay was unavailable.";

    timingsMs.earlyRetention = 0;
    timingsMs.fundingTrace = 0;
    coverageRows.push(
      coverageRow("earlyRetention", "skipped", reason),
      coverageRow("fundingTrace", "skipped", reason),
    );
  }

  const devBagPct = deriveDevBagPct(snapshot, launch.creator);
  const trenchBrief = buildTrenchBrief({
    snapshot,
    earlyBuyers,
    earlyRetention,
    fundingTrace,
    devHistory,
    devBagPct,
  });

  const analyzedAt = Date.now();
  const proofPack = buildProofPack({
    launch,
    snapshot,
    earlyBuyers,
    earlyRetention,
    fundingTrace,
    devHistory,
    trenchBrief,
    generatedAt: analyzedAt,
  });

  timingsMs.total = elapsed(totalStart);

  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    analyzedAt,
    launch,
    snapshot,
    earlyBuyers,
    earlyRetention,
    fundingTrace,
    devHistory,
    trenchBrief,
    proofPack,
    coverage: buildAnalysisCoverage(coverageRows),
    warnings,
    timingsMs,
  };
}

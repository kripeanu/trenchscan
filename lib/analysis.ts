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

export const ANALYSIS_SCHEMA_VERSION = 2 as const;

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

export type AnalysisTiming = Partial<Record<AnalysisStage | "total", number>>;

export type FullAnalysis = {
  schemaVersion: typeof ANALYSIS_SCHEMA_VERSION;
  analyzedAt: number;
  launch: Launch;
  snapshot: TokenSnapshot;
  earlyBuyers: EarlyBuyerScan | null;
  earlyRetention: EarlyRetentionScan | null;
  fundingTrace: FundingTrace | null;
  devHistory: DevHistoryScan | null;
  trenchBrief: ReturnType<typeof buildTrenchBrief>;
  proofPack: ReturnType<typeof buildProofPack>;
  warnings: AnalysisWarning[];
  timingsMs: AnalysisTiming;
};

function elapsed(start: number) {
  return Math.max(0, Date.now() - start);
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Unknown RPC error";
}

export function deriveDevBagPct(
  snapshot: TokenSnapshot,
  creator: string,
): number | null {
  if (snapshot.uiSupply === null || snapshot.uiSupply <= 0) return null;

  const holder = snapshot.holders.find((row) => row.owner === creator);
  if (!holder || holder.uiAmount === null) return null;

  return (holder.uiAmount / snapshot.uiSupply) * 100;
}

/**
 * Runs TrenchScan's receipt-backed evidence pipeline from one exact Pump
 * create_v2 transaction.
 *
 * Launch + holder snapshot are required. Every later stage is optional and
 * degrades into an explicit warning instead of a guessed value.
 */
export async function analyzeLaunchSignature(
  connection: Connection,
  signature: string,
): Promise<FullAnalysis | null> {
  const totalStart = Date.now();
  const timingsMs: AnalysisTiming = {};
  const warnings: AnalysisWarning[] = [];

  const launchStart = Date.now();
  const replay = await loadReplayLaunchBySignature(connection, signature);
  timingsMs.launch = elapsed(launchStart);

  if (!replay) return null;
  const launch = replay.launch;

  const snapshotStart = Date.now();
  const snapshot = await buildTokenSnapshot(connection, launch.mint);
  timingsMs.snapshot = elapsed(snapshotStart);

  const earlyStart = Date.now();
  const devStart = Date.now();

  const [earlyResult, devResult] = await Promise.allSettled([
    buildEarlyBuyerScan(
      connection,
      launch.mint,
      launch.slot,
      launch.signature,
      launch.creator,
    ),
    buildDevHistoryScan(connection, launch.creator, launch.signature),
  ]);

  timingsMs.earlyBuyers = elapsed(earlyStart);
  timingsMs.devHistory = elapsed(devStart);

  let earlyBuyers: EarlyBuyerScan | null = null;
  let devHistory: DevHistoryScan | null = null;

  if (earlyResult.status === "fulfilled") {
    earlyBuyers = earlyResult.value;
  } else {
    warnings.push({
      stage: "earlyBuyers",
      message: messageFrom(earlyResult.reason),
    });
  }

  if (devResult.status === "fulfilled") {
    devHistory = devResult.value;
  } else {
    warnings.push({
      stage: "devHistory",
      message: messageFrom(devResult.reason),
    });
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
    } else {
      warnings.push({
        stage: "earlyRetention",
        message: messageFrom(retentionResult.reason),
      });
    }

    if (fundingResult.status === "fulfilled") {
      fundingTrace = fundingResult.value;
    } else {
      warnings.push({
        stage: "fundingTrace",
        message: messageFrom(fundingResult.reason),
      });
    }
  } else if (earlyBuyers) {
    warnings.push(
      {
        stage: "earlyRetention",
        message: "No decoded early buyers were available for retention analysis.",
      },
      {
        stage: "fundingTrace",
        message: "No decoded early buyers were available for funding analysis.",
      },
    );
    timingsMs.earlyRetention = 0;
    timingsMs.fundingTrace = 0;
  } else {
    warnings.push(
      {
        stage: "earlyRetention",
        message: "Retention analysis skipped because early-buyer replay failed.",
      },
      {
        stage: "fundingTrace",
        message: "Funding analysis skipped because early-buyer replay failed.",
      },
    );
    timingsMs.earlyRetention = 0;
    timingsMs.fundingTrace = 0;
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
    warnings,
    timingsMs,
  };
}

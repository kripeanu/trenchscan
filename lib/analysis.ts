import type { Connection } from "@solana/web3.js";
import { buildDevHistoryScan } from "./dev-history";
import { buildEarlyBuyerScan } from "./early-buyers";
import { buildFundingTrace } from "./funding-links";
import { buildProofPack } from "./proof-pack";
import { loadReplayLaunchBySignature } from "./replay";
import { buildTokenSnapshot } from "./snapshot";
import { buildTrenchBrief } from "./trench-brief";
import type {
  DevHistoryScan,
  EarlyBuyerScan,
  FundingTrace,
  Launch,
  TokenSnapshot,
} from "./types";

export const ANALYSIS_SCHEMA_VERSION = 1 as const;

export type AnalysisStage =
  | "launch"
  | "snapshot"
  | "earlyBuyers"
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
 * Runs TrenchScan's evidence layers for one exact Pump launch transaction.
 *
 * Launch + holder snapshot are required to produce a meaningful analysis.
 * Early-buyer, funding and creator-history stages are allowed to degrade to
 * null with explicit warnings so a flaky RPC sub-call does not erase the
 * evidence that did succeed.
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

  let fundingTrace: FundingTrace | null = null;

  if (earlyBuyers?.buyers.length) {
    const fundingStart = Date.now();

    try {
      fundingTrace = await buildFundingTrace(
        connection,
        earlyBuyers.buyers.slice(0, 12).map((buyer) => ({
          wallet: buyer.wallet,
          firstBuySignature: buyer.signature,
          firstBuyBlockTime: buyer.blockTime,
        })),
        launch.slot,
      );
    } catch (error) {
      warnings.push({
        stage: "fundingTrace",
        message: messageFrom(error),
      });
    }

    timingsMs.fundingTrace = elapsed(fundingStart);
  } else if (earlyBuyers) {
    warnings.push({
      stage: "fundingTrace",
      message: "No decoded early buyers were available for funding analysis.",
    });
    timingsMs.fundingTrace = 0;
  } else {
    warnings.push({
      stage: "fundingTrace",
      message: "Funding analysis skipped because early-buyer replay failed.",
    });
    timingsMs.fundingTrace = 0;
  }

  const devBagPct = deriveDevBagPct(snapshot, launch.creator);
  const trenchBrief = buildTrenchBrief({
    snapshot,
    earlyBuyers,
    fundingTrace,
    devHistory,
    devBagPct,
  });

  const analyzedAt = Date.now();
  const proofPack = buildProofPack({
    launch,
    snapshot,
    earlyBuyers,
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
    fundingTrace,
    devHistory,
    trenchBrief,
    proofPack,
    warnings,
    timingsMs,
  };
}

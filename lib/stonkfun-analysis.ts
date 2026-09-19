import type { Connection } from "@solana/web3.js";
import {
  buildExternalDistributionSnapshot,
} from "./snapshot";
import {
  buildStonkFunEarlyBuyerScan,
} from "./stonkfun-early-buyers";
import {
  loadStonkFunReplayBySignature,
} from "./stonkfun-replay";
import type {
  StonkFunEarlyBuyerScan,
  TokenDistributionSnapshot,
} from "./types";
import type { StonkFunLaunch } from "./stonkfun";

export const STONKFUN_ANALYSIS_SCHEMA_VERSION = 2 as const;

export type StonkFunAnalysisWarning = {
  stage: "distribution" | "earlyBuyers";
  message: string;
};

export type StonkFunAnalysis = {
  schemaVersion: typeof STONKFUN_ANALYSIS_SCHEMA_VERSION;
  analyzedAt: number;
  launch: StonkFunLaunch;
  distribution: TokenDistributionSnapshot | null;
  earlyBuyers: StonkFunEarlyBuyerScan | null;
  coverage: {
    complete: boolean;
    launch: "receipt";
    distribution: "receipt" | "rpc-blocked";
    earlyBuyers: "receipt" | "rpc-blocked";
  };
  warnings: StonkFunAnalysisWarning[];
  limitations: string[];
};

function messageFrom(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unknown RPC error";
}

/**
 * Source-aware StonkFun analysis.
 *
 * LaunchLab evidence is implemented independently from Pump semantics:
 * - protocol inventory = LaunchLab base vault
 * - early buyers = exact LaunchLab buy_exact_in/out for this exact pool,
 *   plus a positive base-token balance delta for the instruction payer
 *
 * Funding / creator-history semantics remain gated until separately verified.
 */
export async function analyzeStonkFunSignature(
  connection: Connection,
  signature: string,
): Promise<StonkFunAnalysis | null> {
  const replay = await loadStonkFunReplayBySignature(
    connection,
    signature,
  );

  if (!replay) return null;

  const warnings: StonkFunAnalysisWarning[] = [];

  const [distributionResult, earlyResult] =
    await Promise.allSettled([
      buildExternalDistributionSnapshot(
        connection,
        replay.launch.mint,
        [
          {
            tokenAccount: replay.launch.baseVault,
            label: "launchlab-base-vault",
          },
        ],
      ),
      buildStonkFunEarlyBuyerScan(
        connection,
        replay.launch,
        replay.launchBlockTime,
      ),
    ]);

  let distribution: TokenDistributionSnapshot | null = null;
  let earlyBuyers: StonkFunEarlyBuyerScan | null = null;

  if (distributionResult.status === "fulfilled") {
    distribution = distributionResult.value;
  } else {
    warnings.push({
      stage: "distribution",
      message: messageFrom(distributionResult.reason),
    });
  }

  if (earlyResult.status === "fulfilled") {
    earlyBuyers = earlyResult.value;
  } else {
    warnings.push({
      stage: "earlyBuyers",
      message: messageFrom(earlyResult.reason),
    });
  }

  return {
    schemaVersion: STONKFUN_ANALYSIS_SCHEMA_VERSION,
    analyzedAt: Date.now(),
    launch: replay.launch,
    distribution,
    earlyBuyers,
    coverage: {
      complete:
        distribution !== null &&
        earlyBuyers !== null,
      launch: "receipt",
      distribution:
        distribution !== null ? "receipt" : "rpc-blocked",
      earlyBuyers:
        earlyBuyers !== null ? "receipt" : "rpc-blocked",
    },
    warnings,
    limitations: [
      "Launch attribution requires the Raydium LaunchLab program, a supported initialize discriminator, and a known StonkFun platform_config.",
      "Holder concentration excludes the LaunchLab base vault so protocol inventory is not mislabeled as an external whale.",
      "A StonkFun early-buyer row requires a verified LaunchLab buy_exact_in/out for this exact pool/platform/mint/base-vault plus a positive base-token balance delta for that instruction payer.",
      "If the bounded pool-history window does not reach the launch receipt, earlyBuyers.historyComplete is false and the rows are an early sampled window rather than a claim to be the literal first buyers.",
      "Funding relationships and creator-history semantics are not enabled for StonkFun yet; Pump-specific logic is not reused by assumption.",
      "This analysis is evidence, not a buy/sell recommendation or hidden numeric risk score.",
    ],
  };
}

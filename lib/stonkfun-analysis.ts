import type { Connection } from "@solana/web3.js";
import {
  buildExternalDistributionSnapshot,
} from "./snapshot";
import {
  loadStonkFunReplayBySignature,
} from "./stonkfun-replay";
import type {
  TokenDistributionSnapshot,
} from "./types";
import type { StonkFunLaunch } from "./stonkfun";

export const STONKFUN_ANALYSIS_SCHEMA_VERSION = 1 as const;

export type StonkFunAnalysisWarning = {
  stage: "distribution";
  message: string;
};

export type StonkFunAnalysis = {
  schemaVersion: typeof STONKFUN_ANALYSIS_SCHEMA_VERSION;
  analyzedAt: number;
  launch: StonkFunLaunch;
  distribution: TokenDistributionSnapshot | null;
  coverage: {
    complete: boolean;
    launch: "receipt";
    distribution: "receipt" | "rpc-blocked";
  };
  warnings: StonkFunAnalysisWarning[];
  limitations: string[];
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Unknown RPC error";
}

/**
 * Source-aware StonkFun analysis.
 *
 * We deliberately stop at evidence that is already valid for LaunchLab:
 * launch receipt + holder distribution with the LaunchLab base vault excluded.
 * Pump-specific curve replay, early-buyer and dev-history semantics are not
 * silently reused here.
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
  let distribution: TokenDistributionSnapshot | null = null;

  try {
    distribution = await buildExternalDistributionSnapshot(
      connection,
      replay.launch.mint,
      [
        {
          tokenAccount: replay.launch.baseVault,
          label: "launchlab-base-vault",
        },
      ],
    );
  } catch (error) {
    warnings.push({
      stage: "distribution",
      message: messageFrom(error),
    });
  }

  return {
    schemaVersion: STONKFUN_ANALYSIS_SCHEMA_VERSION,
    analyzedAt: Date.now(),
    launch: replay.launch,
    distribution,
    coverage: {
      complete: distribution !== null,
      launch: "receipt",
      distribution: distribution ? "receipt" : "rpc-blocked",
    },
    warnings,
    limitations: [
      "Launch attribution requires the Raydium LaunchLab program, a supported initialize discriminator, and a known StonkFun platform_config.",
      "Holder concentration excludes the LaunchLab base vault so protocol inventory is not mislabeled as an external whale.",
      "Early-buyer replay, funding relationships and creator-history semantics are not enabled for StonkFun yet; Pump-specific logic is not reused by assumption.",
      "This analysis is evidence, not a buy/sell recommendation or hidden numeric risk score.",
    ],
  };
}

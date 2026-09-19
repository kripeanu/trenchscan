import {
  Connection,
  type ConfirmedSignatureInfo,
} from "@solana/web3.js";
import {
  decodeStonkFunLaunchFromTransaction,
  STONKFUN_REWARD_PLATFORM_CONFIG,
  STONKFUN_STANDARD_PLATFORM_CONFIG,
  type StonkFunLaunch,
} from "./stonkfun";
import {
  MAX_SUPPORTED_TRANSACTION_VERSION,
  withRpcRetry,
} from "./rpc";

const SIGNATURES_PER_PLATFORM = 60;
const MAX_DISCOVERY_CANDIDATES = 90;
const SEARCH_PACE_MS = 450;

export type StonkFunReplay = {
  launch: StonkFunLaunch;
  launchBlockTime: number | null;
  replayedAt: number;
};

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function mergeStonkFunCandidates(
  groups: ConfirmedSignatureInfo[][],
) {
  const unique = new Map<string, ConfirmedSignatureInfo>();

  for (const row of groups.flat()) {
    if (row.err || unique.has(row.signature)) continue;
    unique.set(row.signature, row);
  }

  return [...unique.values()]
    .sort((left, right) => right.slot - left.slot)
    .slice(0, MAX_DISCOVERY_CANDIDATES);
}

export async function loadStonkFunReplayBySignature(
  connection: Connection,
  signature: string,
): Promise<StonkFunReplay | null> {
  const transaction = await withRpcRetry(() =>
    connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
    }),
  );

  if (!transaction || transaction.meta?.err) return null;

  const blockTime = transaction.blockTime ?? null;
  const launch = decodeStonkFunLaunchFromTransaction(
    transaction,
    signature,
    transaction.slot,
    blockTime !== null ? blockTime * 1000 : Date.now(),
  );

  if (!launch) return null;

  return {
    launch,
    launchBlockTime: blockTime,
    replayedAt: Date.now(),
  };
}

/**
 * Searches only transactions that touch StonkFun's own LaunchLab platform
 * configs, then requires the LaunchLab initialize discriminator as a second
 * proof before returning a launch.
 *
 * This is deliberately narrower than scanning every Raydium LaunchLab
 * transaction and then guessing which platform created it.
 */
export async function findRecentStonkFunReplay(
  connection: Connection,
): Promise<StonkFunReplay | null> {
  const groups = await Promise.all(
    [
      STONKFUN_STANDARD_PLATFORM_CONFIG,
      STONKFUN_REWARD_PLATFORM_CONFIG,
    ].map((platformConfig) =>
      withRpcRetry(() =>
        connection.getSignaturesForAddress(
          platformConfig,
          { limit: SIGNATURES_PER_PLATFORM },
          "confirmed",
        ),
      ),
    ),
  );

  const candidates = mergeStonkFunCandidates(groups);

  for (const candidate of candidates) {
    const replay = await loadStonkFunReplayBySignature(
      connection,
      candidate.signature,
    );

    if (replay) return replay;
    await sleep(SEARCH_PACE_MS);
  }

  return null;
}

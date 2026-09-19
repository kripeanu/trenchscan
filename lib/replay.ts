import {
  Connection,
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import {
  decodeLaunchFromTransaction,
  PUMP_PROGRAM_ID,
} from "@/lib/pump";
import type { ReplayLaunch } from "@/lib/types";

const RECENT_SIGNATURE_LIMIT = 80;
const SEARCH_PACE_MS = 325;
const RATE_LIMIT_RETRY_MS = [750, 1_500, 3_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function looksRateLimited(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("429") || message.toLowerCase().includes("too many requests");
}

function replayFromParsed(
  transaction: ParsedTransactionWithMeta,
  signature: string,
  slot: number,
  blockTime: number | null | undefined,
): ReplayLaunch | null {
  const launchTime = blockTime ?? null;
  const launch = decodeLaunchFromTransaction(
    transaction,
    signature,
    slot,
    launchTime !== null ? launchTime * 1000 : Date.now(),
  );

  if (!launch) return null;

  return {
    launch,
    launchBlockTime: launchTime,
    replayedAt: Date.now(),
  };
}

export async function loadReplayLaunchBySignature(
  connection: Connection,
  signature: string,
): Promise<ReplayLaunch | null> {
  const transaction = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!transaction || transaction.meta?.err) return null;

  return replayFromParsed(
    transaction,
    signature,
    transaction.slot,
    transaction.blockTime,
  );
}

async function loadRecentParsedTransaction(
  connection: Connection,
  info: ConfirmedSignatureInfo,
) {
  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_MS.length; attempt += 1) {
    try {
      return await connection.getParsedTransaction(info.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch (error) {
      if (!looksRateLimited(error) || attempt >= RATE_LIMIT_RETRY_MS.length) {
        throw error;
      }

      await sleep(RATE_LIMIT_RETRY_MS[attempt]);
    }
  }

  return null;
}

async function scanRecentSignatures(
  connection: Connection,
  signatures: ConfirmedSignatureInfo[],
) {
  for (const info of signatures) {
    if (info.err) continue;

    const transaction = await loadRecentParsedTransaction(connection, info);

    if (transaction && !transaction.meta?.err) {
      const replay = replayFromParsed(
        transaction,
        info.signature,
        info.slot,
        info.blockTime,
      );

      if (replay) return replay;
    }

    // Public Solana RPC applies a low per-method getTransaction rate limit.
    // Pace discovery so replay remains usable even without a paid RPC.
    await sleep(SEARCH_PACE_MS);
  }

  return null;
}

/**
 * Finds a real recent Pump create_v2 launch from program history.
 *
 * This is intentionally live RPC data, not a bundled demo fixture. The demo
 * path exercises the same decoder and downstream evidence endpoints as a launch
 * caught by the websocket listener.
 */
export async function findRecentReplayLaunch(
  connection: Connection,
): Promise<ReplayLaunch | null> {
  const signatures = await connection.getSignaturesForAddress(
    PUMP_PROGRAM_ID,
    { limit: RECENT_SIGNATURE_LIMIT },
    "confirmed",
  );

  return scanRecentSignatures(connection, signatures);
}

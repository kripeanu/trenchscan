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

const RECENT_SIGNATURE_LIMIT = 48;
const PARSE_BATCH_SIZE = 12;

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

async function parseRecentChunk(
  connection: Connection,
  signatures: ConfirmedSignatureInfo[],
) {
  const transactions = await connection.getParsedTransactions(
    signatures.map((row) => row.signature),
    {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  );

  for (let index = 0; index < signatures.length; index += 1) {
    const transaction = transactions[index];
    const info = signatures[index];

    if (!transaction || transaction.meta?.err || info.err) continue;

    const replay = replayFromParsed(
      transaction,
      info.signature,
      info.slot,
      info.blockTime,
    );

    if (replay) return replay;
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

  for (
    let index = 0;
    index < signatures.length;
    index += PARSE_BATCH_SIZE
  ) {
    const replay = await parseRecentChunk(
      connection,
      signatures.slice(index, index + PARSE_BATCH_SIZE),
    );

    if (replay) return replay;
  }

  return null;
}

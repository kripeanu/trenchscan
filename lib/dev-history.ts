import {
  Connection,
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { decodeLaunchFromTransaction } from "@/lib/pump";
import type { DevHistoryScan, DevLaunchRow } from "@/lib/types";

const SIGNATURE_LIMIT = 60;
const PARSE_BATCH_SIZE = 20;
const MAX_PRIOR_LAUNCHES = 12;

async function parseInBatches(
  connection: Connection,
  signatures: ConfirmedSignatureInfo[],
) {
  const rows: Array<{
    info: ConfirmedSignatureInfo;
    transaction: ParsedTransactionWithMeta | null;
  }> = [];

  for (let index = 0; index < signatures.length; index += PARSE_BATCH_SIZE) {
    const chunk = signatures.slice(index, index + PARSE_BATCH_SIZE);
    const parsed = await connection.getParsedTransactions(
      chunk.map((row) => row.signature),
      {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      },
    );

    parsed.forEach((transaction, chunkIndex) => {
      rows.push({
        info: chunk[chunkIndex],
        transaction,
      });
    });
  }

  return rows;
}

/**
 * Samples the creator wallet's recent history immediately before the current
 * launch and looks for earlier Pump create_v2 transactions by the same creator.
 *
 * "No launches found" only means none were found in this bounded history
 * window. It is never presented as proof that the wallet is a first-time dev.
 */
export async function buildDevHistoryScan(
  connection: Connection,
  creatorAddress: string,
  currentLaunchSignature: string,
): Promise<DevHistoryScan> {
  const creator = new PublicKey(creatorAddress).toBase58();

  const signatures = await connection.getSignaturesForAddress(
    new PublicKey(creator),
    {
      before: currentLaunchSignature,
      limit: SIGNATURE_LIMIT,
    },
    "confirmed",
  );

  const clean = signatures.filter((row) => !row.err);
  const parsed = await parseInBatches(connection, clean);
  const priorLaunches: DevLaunchRow[] = [];

  for (const { info, transaction } of parsed) {
    if (!transaction || transaction.meta?.err) continue;

    const launch = decodeLaunchFromTransaction(
      transaction,
      info.signature,
      info.slot,
      info.blockTime ? info.blockTime * 1000 : Date.now(),
    );

    if (!launch || launch.creator !== creator) continue;

    priorLaunches.push({
      signature: launch.signature,
      slot: launch.slot,
      blockTime: info.blockTime ?? null,
      name: launch.name,
      symbol: launch.symbol,
      mint: launch.mint,
      isMayhemMode: launch.isMayhemMode,
    });

    if (priorLaunches.length >= MAX_PRIOR_LAUNCHES) break;
  }

  const oldestSampledBlockTime =
    clean.length > 0 ? (clean[clean.length - 1].blockTime ?? null) : null;

  return {
    creator,
    sampledAt: Date.now(),
    signaturesSampled: clean.length,
    transactionsParsed: parsed.filter((row) => row.transaction !== null).length,
    oldestSampledBlockTime,
    priorLaunches,
  };
}

import {
  Connection,
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { derivePumpCurveAccounts } from "@/lib/snapshot";
import type { EarlyBuyerRow, EarlyBuyerScan } from "@/lib/types";

const SIGNATURE_PAGE_SIZE = 100;
const MAX_SIGNATURE_PAGES = 3;
const MAX_PARSED_SIGNATURES = 60;
const PARSE_BATCH_SIZE = 20;

type BalanceRow = {
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
  };
};

function pct(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  const scaled = (numerator * 10_000n + denominator / 2n) / denominator;
  return Number(scaled) / 100;
}

function rawToUi(raw: bigint, decimals: number) {
  const divisor = 10 ** decimals;
  if (!Number.isFinite(divisor) || divisor <= 0) return null;
  return Number(raw) / divisor;
}

function balancesByOwner(
  balances: readonly BalanceRow[] | null | undefined,
  mint: string,
) {
  const map = new Map<string, bigint>();

  for (const row of balances ?? []) {
    if (row.mint !== mint || !row.owner) continue;

    const amount = BigInt(row.uiTokenAmount.amount);
    map.set(row.owner, (map.get(row.owner) ?? 0n) + amount);
  }

  return map;
}

function positiveTokenDeltas(
  transaction: ParsedTransactionWithMeta,
  mint: string,
) {
  const pre = balancesByOwner(
    transaction.meta?.preTokenBalances as BalanceRow[] | undefined,
    mint,
  );
  const post = balancesByOwner(
    transaction.meta?.postTokenBalances as BalanceRow[] | undefined,
    mint,
  );

  const owners = new Set([...pre.keys(), ...post.keys()]);
  const deltas: Array<{ wallet: string; rawDelta: bigint }> = [];

  for (const wallet of owners) {
    const delta = (post.get(wallet) ?? 0n) - (pre.get(wallet) ?? 0n);
    if (delta > 0n) deltas.push({ wallet, rawDelta: delta });
  }

  return deltas;
}

async function collectCurveSignatures(
  connection: Connection,
  curve: PublicKey,
  launchSlot: number,
) {
  const collected: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  let reachedLaunchBoundary = false;

  for (let page = 0; page < MAX_SIGNATURE_PAGES; page += 1) {
    const batch = await connection.getSignaturesForAddress(
      curve,
      {
        limit: SIGNATURE_PAGE_SIZE,
        before,
      },
      "confirmed",
    );

    if (!batch.length) break;

    collected.push(...batch);

    if (batch.some((row) => row.slot <= launchSlot)) {
      reachedLaunchBoundary = true;
      break;
    }

    before = batch[batch.length - 1]?.signature;
    if (!before) break;
  }

  const relevant = collected
    .filter((row) => !row.err && row.slot >= launchSlot)
    .reverse();

  return {
    reachedLaunchBoundary,
    signatures: relevant.slice(0, MAX_PARSED_SIGNATURES),
    totalRelevantSeen: relevant.length,
  };
}

async function parseTransactions(
  connection: Connection,
  signatures: ConfirmedSignatureInfo[],
) {
  const parsed: Array<{
    info: ConfirmedSignatureInfo;
    tx: ParsedTransactionWithMeta | null;
  }> = [];

  for (let index = 0; index < signatures.length; index += PARSE_BATCH_SIZE) {
    const chunk = signatures.slice(index, index + PARSE_BATCH_SIZE);
    const transactions = await connection.getParsedTransactions(
      chunk.map((row) => row.signature),
      {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      },
    );

    transactions.forEach((tx, chunkIndex) => {
      parsed.push({ info: chunk[chunkIndex], tx });
    });
  }

  return parsed;
}

/**
 * Replays the earliest Pump bonding-curve transactions we can reach from RPC
 * and extracts wallets whose balance of this mint increased.
 *
 * This is deliberately balance-delta based. We do not infer "buys" from log
 * strings, and we expose when the bounded RPC window did not reach launch.
 */
export async function buildEarlyBuyerScan(
  connection: Connection,
  mintAddress: string,
  launchSlot: number,
  creatorAddress?: string | null,
): Promise<EarlyBuyerScan> {
  const mint = new PublicKey(mintAddress);
  const creator = creatorAddress ? new PublicKey(creatorAddress).toBase58() : null;
  const { bondingCurve } = derivePumpCurveAccounts(mint);

  const [supplyResponse, launchBlockTime, history] = await Promise.all([
    connection.getTokenSupply(mint, "confirmed"),
    connection.getBlockTime(launchSlot).catch(() => null),
    collectCurveSignatures(connection, bondingCurve, launchSlot),
  ]);

  const rawSupply = BigInt(supplyResponse.value.amount);
  const parsed = await parseTransactions(connection, history.signatures);
  const firstByWallet = new Map<string, EarlyBuyerRow>();

  for (const { info, tx } of parsed) {
    if (!tx || tx.meta?.err) continue;

    for (const delta of positiveTokenDeltas(tx, mint.toBase58())) {
      if (delta.wallet === bondingCurve.toBase58()) continue;
      if (firstByWallet.has(delta.wallet)) continue;

      const secondsAfterLaunch =
        launchBlockTime !== null && info.blockTime !== null
          ? Math.max(0, info.blockTime - launchBlockTime)
          : null;

      firstByWallet.set(delta.wallet, {
        rank: 0,
        wallet: delta.wallet,
        signature: info.signature,
        slot: info.slot,
        blockTime: info.blockTime,
        secondsAfterLaunch,
        rawTokenDelta: delta.rawDelta.toString(),
        uiTokenDelta: rawToUi(delta.rawDelta, supplyResponse.value.decimals),
        supplyPct: pct(delta.rawDelta, rawSupply),
        isCreator: creator !== null && delta.wallet === creator,
      });
    }
  }

  const buyers = [...firstByWallet.values()]
    .sort((left, right) => {
      if (left.slot !== right.slot) return left.slot - right.slot;
      return (left.blockTime ?? 0) - (right.blockTime ?? 0);
    })
    .slice(0, 25)
    .map((buyer, index) => ({ ...buyer, rank: index + 1 }));

  return {
    mint: mint.toBase58(),
    bondingCurve: bondingCurve.toBase58(),
    launchSlot,
    launchBlockTime,
    sampledAt: Date.now(),
    historyComplete: history.reachedLaunchBoundary,
    signaturesScanned: history.signatures.length,
    relevantSignaturesSeen: history.totalRelevantSeen,
    transactionsParsed: parsed.filter((row) => row.tx !== null).length,
    buyers,
  };
}

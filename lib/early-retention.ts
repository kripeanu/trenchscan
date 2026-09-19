import { Connection, PublicKey } from "@solana/web3.js";
import type {
  EarlyRetentionInput,
  EarlyRetentionRow,
  EarlyRetentionScan,
  EarlyRetentionStatus,
} from "./types";

const MAX_WALLETS = 12;
const RPC_CONCURRENCY = 4;

function rawToUi(raw: bigint, decimals: number) {
  const divisor = 10 ** decimals;
  if (!Number.isFinite(divisor) || divisor <= 0) return null;
  return Number(raw) / divisor;
}

function retainedPct(current: bigint, firstBuy: bigint) {
  if (firstBuy <= 0n) return null;
  const basisPoints = (current * 10_000n + firstBuy / 2n) / firstBuy;
  return Number(basisPoints) / 100;
}

export function classifyRetention(
  current: bigint,
  firstBuy: bigint,
): EarlyRetentionStatus {
  if (current <= 0n) return "jeeted";
  if (firstBuy <= 0n) return "holding";

  const basisPoints = (current * 10_000n) / firstBuy;

  if (basisPoints < 2_000n) return "mostly-jeeted";
  if (basisPoints < 8_000n) return "trimmed";
  if (basisPoints <= 12_000n) return "holding";
  return "added";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];

  for (let index = 0; index < items.length; index += concurrency) {
    results.push(
      ...(await Promise.all(items.slice(index, index + concurrency).map(mapper))),
    );
  }

  return results;
}

async function readCurrentBalance(
  connection: Connection,
  mint: PublicKey,
  input: EarlyRetentionInput,
  decimals: number,
): Promise<EarlyRetentionRow> {
  const wallet = new PublicKey(input.wallet);
  const firstBuy = BigInt(input.rawFirstBuy);

  const accounts = await connection.getParsedTokenAccountsByOwner(
    wallet,
    { mint },
    "confirmed",
  );

  let current = 0n;

  for (const account of accounts.value) {
    const parsed = account.account.data;
    if (!("parsed" in parsed)) continue;

    const info = parsed.parsed?.info as
      | { tokenAmount?: { amount?: string } }
      | undefined;
    const amount = info?.tokenAmount?.amount;
    if (!amount) continue;

    try {
      current += BigInt(amount);
    } catch {
      // Ignore malformed parsed token-account amounts.
    }
  }

  return {
    wallet: wallet.toBase58(),
    rawFirstBuy: firstBuy.toString(),
    rawCurrent: current.toString(),
    uiFirstBuy: rawToUi(firstBuy, decimals),
    uiCurrent: rawToUi(current, decimals),
    retainedPct: retainedPct(current, firstBuy),
    status: classifyRetention(current, firstBuy),
  };
}

/**
 * Compares each decoded early buyer's first positive token delta with their
 * current balance of the same mint.
 *
 * This measures retention relative to that first decoded grab. It is not a
 * complete PnL ledger: a wallet may have bought/sold multiple times afterward.
 */
export async function buildEarlyRetentionScan(
  connection: Connection,
  mintAddress: string,
  buyers: EarlyRetentionInput[],
): Promise<EarlyRetentionScan> {
  const mint = new PublicKey(mintAddress);
  const uniqueBuyers = [
    ...new Map(
      buyers.slice(0, MAX_WALLETS).map((buyer) => [
        new PublicKey(buyer.wallet).toBase58(),
        {
          wallet: new PublicKey(buyer.wallet).toBase58(),
          rawFirstBuy: BigInt(buyer.rawFirstBuy).toString(),
        },
      ]),
    ).values(),
  ];

  const supply = await connection.getTokenSupply(mint, "confirmed");
  const rows = await mapWithConcurrency(
    uniqueBuyers,
    RPC_CONCURRENCY,
    (buyer) => readCurrentBalance(
      connection,
      mint,
      buyer,
      supply.value.decimals,
    ),
  );

  return {
    mint: mint.toBase58(),
    sampledAt: Date.now(),
    decimals: supply.value.decimals,
    walletsChecked: rows.length,
    jeetedCount: rows.filter((row) => row.status === "jeeted").length,
    mostlyJeetedCount: rows.filter((row) => row.status === "mostly-jeeted").length,
    trimmedCount: rows.filter((row) => row.status === "trimmed").length,
    holdingCount: rows.filter((row) => row.status === "holding").length,
    addedCount: rows.filter((row) => row.status === "added").length,
    rows,
  };
}

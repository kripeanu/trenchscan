import { Connection, PublicKey } from "@solana/web3.js";
import { PUMP_PROGRAM_ID } from "@/lib/pump";
import type { HolderRow, TokenSnapshot } from "@/lib/types";

const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

function pct(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  const scaled = (numerator * 10_000n + denominator / 2n) / denominator;
  return Number(scaled) / 100;
}

function clampSub(left: bigint, right: bigint) {
  return left > right ? left - right : 0n;
}

export function derivePumpCurveAccounts(mint: PublicKey) {
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM_ID,
  );

  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      TOKEN_2022_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  return { bondingCurve, associatedBondingCurve };
}

async function readCurveInventory(
  connection: Connection,
  associatedBondingCurve: PublicKey,
) {
  try {
    const balance = await connection.getTokenAccountBalance(
      associatedBondingCurve,
      "confirmed",
    );
    return BigInt(balance.value.amount);
  } catch {
    // A freshly migrated / unusual coin may no longer have the expected ATA.
    // Treat it as zero rather than fabricating a value.
    return 0n;
  }
}

function tokenAccountOwner(data: Buffer | null | undefined) {
  if (!data || data.length < 64) return null;

  try {
    // SPL Token and Token-2022 share the same base account layout:
    // mint [0..32), owner [32..64).
    return new PublicKey(data.subarray(32, 64)).toBase58();
  } catch {
    return null;
  }
}

export async function buildTokenSnapshot(
  connection: Connection,
  mintAddress: string,
): Promise<TokenSnapshot> {
  const mint = new PublicKey(mintAddress);
  const { bondingCurve, associatedBondingCurve } = derivePumpCurveAccounts(mint);

  const [supplyResponse, largestResponse, curveInventory] = await Promise.all([
    connection.getTokenSupply(mint, "confirmed"),
    connection.getTokenLargestAccounts(mint, "confirmed"),
    readCurveInventory(connection, associatedBondingCurve),
  ]);

  const rawSupply = BigInt(supplyResponse.value.amount);
  const rawExternalSupply = clampSub(rawSupply, curveInventory);

  const externalAccounts = largestResponse.value.filter(
    (row) => !row.address.equals(associatedBondingCurve),
  );

  const accountInfos = await connection.getMultipleAccountsInfo(
    externalAccounts.map((row) => row.address),
    "confirmed",
  );

  const holders: HolderRow[] = externalAccounts.map((row, index) => {
    const rawAmount = BigInt(row.amount);
    return {
      rank: index + 1,
      tokenAccount: row.address.toBase58(),
      owner: tokenAccountOwner(accountInfos[index]?.data),
      rawAmount: row.amount,
      uiAmount: row.uiAmount,
      shareOfExternalPct: pct(rawAmount, rawExternalSupply),
    };
  });

  const top1Amount = holders.length ? BigInt(holders[0].rawAmount) : 0n;
  const top10Amount = holders
    .slice(0, 10)
    .reduce((sum, holder) => sum + BigInt(holder.rawAmount), 0n);

  return {
    mint: mint.toBase58(),
    sampledAt: Date.now(),
    decimals: supplyResponse.value.decimals,
    rawSupply: rawSupply.toString(),
    uiSupply: supplyResponse.value.uiAmount,
    bondingCurve: bondingCurve.toBase58(),
    associatedBondingCurve: associatedBondingCurve.toBase58(),
    rawCurveInventory: curveInventory.toString(),
    curveInventoryPct: pct(curveInventory, rawSupply),
    rawExternalSupply: rawExternalSupply.toString(),
    externalFloatPct: pct(rawExternalSupply, rawSupply),
    top1ExternalPct: pct(top1Amount, rawExternalSupply),
    top10ExternalPct: pct(top10Amount, rawExternalSupply),
    holders,
  };
}

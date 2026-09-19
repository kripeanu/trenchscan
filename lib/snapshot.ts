import { Connection, PublicKey } from "@solana/web3.js";
import { PUMP_PROGRAM_ID } from "@/lib/pump";
import type {
  HolderRow,
  TokenDistributionSnapshot,
  TokenSnapshot,
} from "@/lib/types";
import { withRpcRetry } from "@/lib/rpc";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

export type DistributionExclusion = {
  tokenAccount: string | PublicKey;
  label: string;
  allowMissing?: boolean;
};

function pct(numerator: bigint, denominator: bigint): number | null {
  if (denominator <= 0n) return null;
  const scaled = (numerator * 10_000n + denominator / 2n) / denominator;
  return Number(scaled) / 100;
}

function clampSub(left: bigint, right: bigint) {
  return left > right ? left - right : 0n;
}

export function derivePumpBondingCurve(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM_ID,
  )[0];
}

export function derivePumpCurveAccounts(
  mint: PublicKey,
  tokenProgram = TOKEN_2022_PROGRAM_ID,
) {
  const bondingCurve = derivePumpBondingCurve(mint);
  const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
    [
      bondingCurve.toBuffer(),
      tokenProgram.toBuffer(),
      mint.toBuffer(),
    ],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  return { bondingCurve, associatedBondingCurve };
}

async function resolveMintTokenProgram(
  connection: Connection,
  mint: PublicKey,
) {
  const account = await withRpcRetry(() =>
    connection.getAccountInfo(mint, "confirmed"),
  );

  if (!account) {
    throw new Error("Mint account not found");
  }

  if (
    !account.owner.equals(TOKEN_PROGRAM_ID) &&
    !account.owner.equals(TOKEN_2022_PROGRAM_ID)
  ) {
    throw new Error(
      `Unsupported mint owner program: ${account.owner.toBase58()}`,
    );
  }

  return account.owner;
}

function tokenAccountOwner(data: Buffer | null | undefined) {
  if (!data || data.length < 64) return null;

  try {
    return new PublicKey(data.subarray(32, 64)).toBase58();
  } catch {
    return null;
  }
}

function tokenAccountState(
  data: Buffer | null | undefined,
  expectedMint: PublicKey,
) {
  if (!data || data.length < 72) return null;

  const mint = new PublicKey(data.subarray(0, 32));
  if (!mint.equals(expectedMint)) {
    throw new Error(
      `Excluded token account belongs to ${mint.toBase58()}, expected ${expectedMint.toBase58()}`,
    );
  }

  return {
    owner: tokenAccountOwner(data),
    amount: data.readBigUInt64LE(64),
  };
}

export function computeDistributionMath(
  rawSupply: bigint,
  excludedRaw: bigint,
  holderRawAmounts: bigint[],
) {
  const rawExternalSupply = clampSub(rawSupply, excludedRaw);
  const top1Amount = holderRawAmounts[0] ?? 0n;
  const top10Amount = holderRawAmounts
    .slice(0, 10)
    .reduce((sum, amount) => sum + amount, 0n);

  return {
    rawExternalSupply,
    externalFloatPct: pct(rawExternalSupply, rawSupply),
    excludedInventoryPct: pct(excludedRaw, rawSupply),
    top1ExternalPct: pct(top1Amount, rawExternalSupply),
    top10ExternalPct: pct(top10Amount, rawExternalSupply),
  };
}

/**
 * Source-neutral token distribution read.
 *
 * Callers explicitly provide protocol-controlled token accounts that should be
 * excluded from "external holder" concentration. Pump passes its curve ATA;
 * LaunchLab/StonkFun passes its base vault. TrenchScan never guesses that a
 * protocol vault is a whale.
 */
export async function buildExternalDistributionSnapshot(
  connection: Connection,
  mintAddress: string,
  exclusions: DistributionExclusion[],
): Promise<TokenDistributionSnapshot> {
  const mint = new PublicKey(mintAddress);

  // Validate the mint owner before applying SPL/Token-2022 account layout.
  await resolveMintTokenProgram(connection, mint);

  const supplyResponse = await withRpcRetry(() =>
    connection.getTokenSupply(mint, "confirmed"),
  );
  const largestResponse = await withRpcRetry(() =>
    connection.getTokenLargestAccounts(mint, "confirmed"),
  );

  const normalizedExclusions = exclusions.map((row) => ({
    ...row,
    tokenAccount:
      typeof row.tokenAccount === "string"
        ? new PublicKey(row.tokenAccount)
        : row.tokenAccount,
  }));
  const excludedAddresses = new Set(
    normalizedExclusions.map((row) => row.tokenAccount.toBase58()),
  );
  const externalAccounts = largestResponse.value.filter(
    (row) => !excludedAddresses.has(row.address.toBase58()),
  );

  const requestedAccounts = [
    ...normalizedExclusions.map((row) => row.tokenAccount),
    ...externalAccounts.map((row) => row.address),
  ];
  const accountInfos = requestedAccounts.length
    ? await withRpcRetry(() =>
        connection.getMultipleAccountsInfo(
          requestedAccounts,
          "confirmed",
        ),
      )
    : [];

  const excludedInventory = normalizedExclusions.map((row, index) => {
    const state = tokenAccountState(accountInfos[index]?.data, mint);

    if (!state && !row.allowMissing) {
      throw new Error(
        `Required excluded token account missing: ${row.tokenAccount.toBase58()}`,
      );
    }

    return {
      label: row.label,
      tokenAccount: row.tokenAccount.toBase58(),
      rawAmount: (state?.amount ?? 0n).toString(),
      supplyPct: null as number | null,
    };
  });

  const rawSupply = BigInt(supplyResponse.value.amount);
  const excludedRaw = excludedInventory.reduce(
    (sum, row) => sum + BigInt(row.rawAmount),
    0n,
  );
  const holderRawAmounts = externalAccounts.map((row) => BigInt(row.amount));
  const math = computeDistributionMath(
    rawSupply,
    excludedRaw,
    holderRawAmounts,
  );

  const externalInfoOffset = normalizedExclusions.length;
  const holders: HolderRow[] = externalAccounts.map((row, index) => {
    const rawAmount = BigInt(row.amount);

    return {
      rank: index + 1,
      tokenAccount: row.address.toBase58(),
      owner: tokenAccountOwner(
        accountInfos[externalInfoOffset + index]?.data,
      ),
      rawAmount: row.amount,
      uiAmount: row.uiAmount,
      shareOfExternalPct: pct(rawAmount, math.rawExternalSupply),
    };
  });

  for (const row of excludedInventory) {
    row.supplyPct = pct(BigInt(row.rawAmount), rawSupply);
  }

  return {
    mint: mint.toBase58(),
    sampledAt: Date.now(),
    decimals: supplyResponse.value.decimals,
    rawSupply: rawSupply.toString(),
    uiSupply: supplyResponse.value.uiAmount,
    excludedInventory,
    rawExternalSupply: math.rawExternalSupply.toString(),
    externalFloatPct: math.externalFloatPct,
    top1ExternalPct: math.top1ExternalPct,
    top10ExternalPct: math.top10ExternalPct,
    holders,
  };
}

export async function buildTokenSnapshot(
  connection: Connection,
  mintAddress: string,
): Promise<TokenSnapshot> {
  const mint = new PublicKey(mintAddress);
  const tokenProgram = await resolveMintTokenProgram(connection, mint);
  const { bondingCurve, associatedBondingCurve } = derivePumpCurveAccounts(
    mint,
    tokenProgram,
  );

  const distribution = await buildExternalDistributionSnapshot(
    connection,
    mint.toBase58(),
    [
      {
        tokenAccount: associatedBondingCurve,
        label: "pump-bonding-curve",
        // After migration the old curve ATA can legitimately disappear.
        allowMissing: true,
      },
    ],
  );

  const curveInventory = distribution.excludedInventory[0];

  return {
    mint: distribution.mint,
    sampledAt: distribution.sampledAt,
    decimals: distribution.decimals,
    rawSupply: distribution.rawSupply,
    uiSupply: distribution.uiSupply,
    bondingCurve: bondingCurve.toBase58(),
    associatedBondingCurve: associatedBondingCurve.toBase58(),
    rawCurveInventory: curveInventory?.rawAmount ?? "0",
    curveInventoryPct: curveInventory?.supplyPct ?? 0,
    rawExternalSupply: distribution.rawExternalSupply,
    externalFloatPct: distribution.externalFloatPct,
    top1ExternalPct: distribution.top1ExternalPct,
    top10ExternalPct: distribution.top10ExternalPct,
    holders: distribution.holders,
  };
}

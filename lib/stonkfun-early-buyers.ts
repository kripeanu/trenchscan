import bs58 from "bs58";
import {
  Connection,
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
} from "@solana/web3.js";
import {
  RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  type StonkFunLaunch,
} from "./stonkfun";
import {
  MAX_SUPPORTED_TRANSACTION_VERSION,
  withRpcRetry,
} from "./rpc";
import type {
  StonkFunBuyVariant,
  StonkFunEarlyBuyerRow,
  StonkFunEarlyBuyerScan,
} from "./types";

const BUY_EXACT_IN_DISCRIMINATOR = Uint8Array.from([
  250, 234, 13, 123, 213, 156, 19, 236,
]);
const BUY_EXACT_OUT_DISCRIMINATOR = Uint8Array.from([
  24, 211, 116, 40, 105, 3, 153, 56,
]);

const SIGNATURE_PAGE_SIZE = 100;
const MAX_SIGNATURE_PAGES = 3;
const MAX_PARSED_SIGNATURES = 48;
const PARSE_BATCH_SIZE = 6;

type BalanceRow = {
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
  };
};

export type DecodedLaunchLabBuy = {
  variant: StonkFunBuyVariant;
  payer: string;
  poolState: string;
  platformConfig: string;
  userBaseToken: string;
  baseVault: string;
  baseMint: string;
};

function hasDiscriminator(bytes: Uint8Array, discriminator: Uint8Array) {
  if (bytes.length < discriminator.length) return false;

  for (let index = 0; index < discriminator.length; index += 1) {
    if (bytes[index] !== discriminator[index]) return false;
  }

  return true;
}

function isPartiallyDecoded(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
): instruction is PartiallyDecodedInstruction {
  return "data" in instruction && "accounts" in instruction;
}

function buyVariant(bytes: Uint8Array): StonkFunBuyVariant | null {
  if (hasDiscriminator(bytes, BUY_EXACT_IN_DISCRIMINATOR)) {
    return "buy_exact_in";
  }

  if (hasDiscriminator(bytes, BUY_EXACT_OUT_DISCRIMINATOR)) {
    return "buy_exact_out";
  }

  return null;
}

/**
 * Verifies a Raydium LaunchLab buy against one already-proven StonkFun launch.
 *
 * Official LaunchLab buy account positions used here:
 * payer=0, platform_config=3, pool_state=4, user_base_token=5,
 * base_vault=7, base_token_mint=9.
 */
export function decodeStonkFunBuyInstruction(
  instruction: PartiallyDecodedInstruction,
  launch: Pick<
    StonkFunLaunch,
    "poolState" | "platformConfig" | "mint" | "baseVault"
  >,
): DecodedLaunchLabBuy | null {
  if (!instruction.programId.equals(RAYDIUM_LAUNCHLAB_PROGRAM_ID)) {
    return null;
  }

  if (instruction.accounts.length < 11) return null;

  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(instruction.data);
  } catch {
    return null;
  }

  const variant = buyVariant(bytes);
  if (!variant) return null;

  const poolState = instruction.accounts[4].toBase58();
  const platformConfig = instruction.accounts[3].toBase58();
  const baseVault = instruction.accounts[7].toBase58();
  const baseMint = instruction.accounts[9].toBase58();

  if (
    poolState !== launch.poolState ||
    platformConfig !== launch.platformConfig ||
    baseVault !== launch.baseVault ||
    baseMint !== launch.mint
  ) {
    return null;
  }

  return {
    variant,
    payer: instruction.accounts[0].toBase58(),
    poolState,
    platformConfig,
    userBaseToken: instruction.accounts[5].toBase58(),
    baseVault,
    baseMint,
  };
}

function transactionInstructions(transaction: ParsedTransactionWithMeta) {
  return [
    ...transaction.transaction.message.instructions,
    ...(transaction.meta?.innerInstructions?.flatMap(
      (group) => group.instructions,
    ) ?? []),
  ];
}

export function findStonkFunBuyInstruction(
  transaction: ParsedTransactionWithMeta,
  launch: Pick<
    StonkFunLaunch,
    "poolState" | "platformConfig" | "mint" | "baseVault"
  >,
) {
  for (const instruction of transactionInstructions(transaction)) {
    if (!isPartiallyDecoded(instruction)) continue;

    const buy = decodeStonkFunBuyInstruction(instruction, launch);
    if (buy) return buy;
  }

  return null;
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

export function positiveBalanceDeltaForOwner(
  preBalances: readonly BalanceRow[] | null | undefined,
  postBalances: readonly BalanceRow[] | null | undefined,
  mint: string,
  owner: string,
) {
  const pre = balancesByOwner(preBalances, mint).get(owner) ?? 0n;
  const post = balancesByOwner(postBalances, mint).get(owner) ?? 0n;
  const delta = post - pre;

  return delta > 0n ? delta : null;
}

function pct(numerator: bigint, denominator: bigint | null) {
  if (denominator === null || denominator <= 0n) return null;

  const scaled =
    (numerator * 10_000n + denominator / 2n) / denominator;
  return Number(scaled) / 100;
}

function rawToUi(raw: bigint, decimals: number) {
  const divisor = 10 ** decimals;
  if (!Number.isFinite(divisor) || divisor <= 0) return null;
  return Number(raw) / divisor;
}

async function collectPoolSignatures(
  connection: Connection,
  poolState: PublicKey,
  launchSlot: number,
  launchSignature: string,
) {
  const collected: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  let reachedLaunchBoundary = false;

  for (let page = 0; page < MAX_SIGNATURE_PAGES; page += 1) {
    const batch = await withRpcRetry(() =>
      connection.getSignaturesForAddress(
        poolState,
        {
          limit: SIGNATURE_PAGE_SIZE,
          ...(before ? { before } : {}),
        },
        "confirmed",
      ),
    );

    if (!batch.length) break;

    collected.push(...batch);

    if (batch.some((row) => row.signature === launchSignature)) {
      reachedLaunchBoundary = true;
      break;
    }

    before = batch[batch.length - 1]?.signature;
    if (!before) break;
  }

  const chronological = collected
    .filter((row) => !row.err)
    .reverse();
  const launchIndex = chronological.findIndex(
    (row) => row.signature === launchSignature,
  );
  const relevant =
    launchIndex >= 0
      ? chronological.slice(launchIndex)
      : chronological.filter((row) => row.slot >= launchSlot);

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

  for (
    let index = 0;
    index < signatures.length;
    index += PARSE_BATCH_SIZE
  ) {
    const chunk = signatures.slice(index, index + PARSE_BATCH_SIZE);
    const transactions = await withRpcRetry(() =>
      connection.getParsedTransactions(
        chunk.map((row) => row.signature),
        {
          commitment: "confirmed",
          maxSupportedTransactionVersion:
            MAX_SUPPORTED_TRANSACTION_VERSION,
        },
      ),
    );

    transactions.forEach((tx, chunkIndex) => {
      parsed.push({
        info: chunk[chunkIndex],
        tx,
      });
    });
  }

  return parsed;
}

/**
 * Replays an early bounded window of one verified StonkFun LaunchLab pool.
 *
 * A row only becomes an "early buyer" when BOTH are true:
 * 1. the exact transaction contains a verified LaunchLab buy_exact_in/out
 *    instruction for this exact StonkFun pool/platform/mint/base-vault;
 * 2. that instruction's payer has a positive base-token balance delta.
 *
 * If the RPC window cannot reach the launch receipt, historyComplete is false
 * and the result must be described as an early sampled window, not "the first
 * buyers".
 */
export async function buildStonkFunEarlyBuyerScan(
  connection: Connection,
  launch: StonkFunLaunch,
  launchBlockTime: number | null,
): Promise<StonkFunEarlyBuyerScan> {
  const mint = new PublicKey(launch.mint);
  const poolState = new PublicKey(launch.poolState);

  const [supplyResult, history] = await Promise.all([
    withRpcRetry(() =>
      connection.getTokenSupply(mint, "confirmed"),
    ).catch(() => null),
    collectPoolSignatures(
      connection,
      poolState,
      launch.slot,
      launch.signature,
    ),
  ]);

  const rawSupply = supplyResult
    ? BigInt(supplyResult.value.amount)
    : null;
  const decimals =
    supplyResult?.value.decimals ?? launch.decimals;
  const parsed = await parseTransactions(
    connection,
    history.signatures,
  );

  const firstByWallet = new Map<
    string,
    StonkFunEarlyBuyerRow
  >();
  let buyTransactionsSeen = 0;

  for (const { info, tx } of parsed) {
    if (!tx || tx.meta?.err) continue;

    const buy = findStonkFunBuyInstruction(tx, launch);
    if (!buy) continue;

    buyTransactionsSeen += 1;

    const rawDelta = positiveBalanceDeltaForOwner(
      tx.meta?.preTokenBalances as BalanceRow[] | undefined,
      tx.meta?.postTokenBalances as BalanceRow[] | undefined,
      launch.mint,
      buy.payer,
    );

    if (rawDelta === null || firstByWallet.has(buy.payer)) {
      continue;
    }

    const blockTime = info.blockTime ?? tx.blockTime ?? null;
    const secondsAfterLaunch =
      launchBlockTime !== null && blockTime !== null
        ? Math.max(0, blockTime - launchBlockTime)
        : null;

    firstByWallet.set(buy.payer, {
      rank: 0,
      wallet: buy.payer,
      signature: info.signature,
      slot: info.slot,
      blockTime,
      secondsAfterLaunch,
      rawTokenDelta: rawDelta.toString(),
      uiTokenDelta: rawToUi(rawDelta, decimals),
      supplyPct: pct(rawDelta, rawSupply),
      isCreator: buy.payer === launch.creator,
      buyVariant: buy.variant,
    });
  }

  const buyers = [...firstByWallet.values()]
    .sort((left, right) => {
      if (left.slot !== right.slot) return left.slot - right.slot;
      return (left.blockTime ?? 0) - (right.blockTime ?? 0);
    })
    .slice(0, 25)
    .map((buyer, index) => ({
      ...buyer,
      rank: index + 1,
    }));

  return {
    mint: launch.mint,
    poolState: launch.poolState,
    launchSlot: launch.slot,
    launchBlockTime,
    sampledAt: Date.now(),
    historyComplete: history.reachedLaunchBoundary,
    signaturesScanned: history.signatures.length,
    relevantSignaturesSeen: history.totalRelevantSeen,
    transactionsParsed: parsed.filter((row) => row.tx !== null).length,
    buyTransactionsSeen,
    buyers,
  };
}

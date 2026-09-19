import {
  Connection,
  PublicKey,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
} from "@solana/web3.js";
import type {
  FundingCluster,
  FundingLink,
  FundingTrace,
} from "@/lib/types";

const MAX_WALLETS = 12;
const SIGNATURES_PER_WALLET = 14;
const TX_TO_PARSE_PER_WALLET = 8;
const RPC_CONCURRENCY = 3;
const MIN_FUNDING_LAMPORTS = 10_000_000n; // 0.01 SOL: ignore dust/rent noise.

function isParsedInstruction(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
): instruction is ParsedInstruction {
  return "parsed" in instruction;
}

function inboundSystemTransfers(
  transaction: ParsedTransactionWithMeta,
  wallet: string,
) {
  const instructions: Array<ParsedInstruction | PartiallyDecodedInstruction> = [
    ...transaction.transaction.message.instructions,
    ...(transaction.meta?.innerInstructions?.flatMap(
      (group) => group.instructions,
    ) ?? []),
  ];

  const transfers: Array<{ source: string; lamports: bigint }> = [];

  for (const instruction of instructions) {
    if (!isParsedInstruction(instruction)) continue;
    if (instruction.program !== "system") continue;

    const parsed = instruction.parsed as {
      type?: string;
      info?: {
        source?: string;
        destination?: string;
        lamports?: number | string;
      };
    };

    if (
      parsed.type !== "transfer" &&
      parsed.type !== "transferWithSeed"
    ) {
      continue;
    }

    const source = parsed.info?.source;
    const destination = parsed.info?.destination;
    const lamportsValue = parsed.info?.lamports;

    if (
      !source ||
      destination !== wallet ||
      lamportsValue === undefined ||
      source === wallet
    ) {
      continue;
    }

    let lamports: bigint;
    try {
      lamports = BigInt(String(lamportsValue));
    } catch {
      continue;
    }

    if (lamports < MIN_FUNDING_LAMPORTS) continue;
    transfers.push({ source, lamports });
  }

  return transfers.sort((a, b) => (a.lamports > b.lamports ? -1 : 1));
}

async function findMostRecentDirectFunder(
  connection: Connection,
  wallet: string,
  launchSlot: number,
  launchBlockTime: number | null,
): Promise<FundingLink | null> {
  const address = new PublicKey(wallet);
  const signatures = await connection.getSignaturesForAddress(
    address,
    { limit: SIGNATURES_PER_WALLET },
    "confirmed",
  );

  const candidates = signatures
    .filter((row) => {
      if (row.err || row.slot > launchSlot) return false;
      if (
        launchBlockTime !== null &&
        row.blockTime !== null &&
        row.blockTime !== undefined &&
        row.blockTime > launchBlockTime
      ) {
        return false;
      }
      return true;
    })
    .slice(0, TX_TO_PARSE_PER_WALLET);

  if (!candidates.length) return null;

  const transactions = await connection.getParsedTransactions(
    candidates.map((row) => row.signature),
    {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    },
  );

  for (let index = 0; index < candidates.length; index += 1) {
    const tx = transactions[index];
    if (!tx || tx.meta?.err) continue;

    const transfer = inboundSystemTransfers(tx, wallet)[0];
    if (!transfer) continue;

    const blockTime = candidates[index].blockTime ?? null;
    const secondsBeforeLaunch =
      launchBlockTime !== null && blockTime !== null
        ? Math.max(0, launchBlockTime - blockTime)
        : null;

    return {
      buyer: wallet,
      source: transfer.source,
      signature: candidates[index].signature,
      blockTime,
      secondsBeforeLaunch,
      lamports: transfer.lamports.toString(),
      amountSol: Number(transfer.lamports) / 1_000_000_000,
    };
  }

  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];

  for (let index = 0; index < items.length; index += concurrency) {
    const chunk = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(chunk.map(mapper))));
  }

  return results;
}

export function buildFundingClusters(links: FundingLink[]) {
  const bySource = new Map<string, FundingLink[]>();

  for (const link of links) {
    const group = bySource.get(link.source) ?? [];
    group.push(link);
    bySource.set(link.source, group);
  }

  const clusters: FundingCluster[] = [];

  for (const [source, sourceLinks] of bySource) {
    if (sourceLinks.length < 2) continue;

    const totalSol = sourceLinks.reduce(
      (sum, link) => sum + (link.amountSol ?? 0),
      0,
    );

    clusters.push({
      source,
      memberCount: sourceLinks.length,
      totalSol,
      buyers: sourceLinks.map((link) => link.buyer),
      links: sourceLinks,
    });
  }

  return clusters.sort((a, b) => {
    if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount;
    return b.totalSol - a.totalSol;
  });
}

/**
 * Traces only direct pre-launch native-SOL funding transfers.
 *
 * A shared direct funder is a clue, not proof of common control: exchange hot
 * wallets and payout services can fund unrelated people. The UI calls this out
 * instead of turning it into a fake certainty score.
 */
export async function buildFundingTrace(
  connection: Connection,
  wallets: string[],
  launchSlot: number,
): Promise<FundingTrace> {
  const uniqueWallets = [...new Set(wallets)]
    .slice(0, MAX_WALLETS)
    .map((wallet) => new PublicKey(wallet).toBase58());

  const launchBlockTime = await connection
    .getBlockTime(launchSlot)
    .catch(() => null);

  const maybeLinks = await mapWithConcurrency(
    uniqueWallets,
    RPC_CONCURRENCY,
    (wallet) =>
      findMostRecentDirectFunder(
        connection,
        wallet,
        launchSlot,
        launchBlockTime,
      ),
  );

  const links = maybeLinks.filter(
    (link): link is FundingLink => link !== null,
  );

  return {
    sampledAt: Date.now(),
    launchSlot,
    launchBlockTime,
    walletsChecked: uniqueWallets.length,
    linksFound: links.length,
    links,
    clusters: buildFundingClusters(links),
  };
}

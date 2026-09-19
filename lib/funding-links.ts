import {
  Connection,
  PublicKey,
  type ConfirmedSignatureInfo,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
} from "@solana/web3.js";
import type {
  FundingBuyerInput,
  FundingCluster,
  FundingLink,
  FundingTrace,
  UpstreamFundingCluster,
  UpstreamFundingLink,
  WalletFingerprint,
  WalletHistoryClass,
} from "./types";
import { MAX_SUPPORTED_TRANSACTION_VERSION, withRpcRetry } from "./rpc";

const MAX_WALLETS = 12;
const HISTORY_SAMPLE_LIMIT = 50;
const TX_TO_PARSE_PER_WALLET = 8;
const MAX_UPSTREAM_INTERMEDIARIES = 8;
const UPSTREAM_SIGNATURE_LIMIT = 12;
const UPSTREAM_TX_TO_PARSE = 6;
const RPC_CONCURRENCY = 2;
const MIN_FUNDING_LAMPORTS = 10_000_000n;

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
    ...(transaction.meta?.innerInstructions?.flatMap((group) => group.instructions) ?? []),
  ];
  const transfers: Array<{ source: string; lamports: bigint }> = [];

  for (const instruction of instructions) {
    if (!isParsedInstruction(instruction) || instruction.program !== "system") continue;

    const parsed = instruction.parsed as {
      type?: string;
      info?: {
        source?: string;
        destination?: string;
        lamports?: number | string;
      };
    };

    if (parsed.type !== "transfer" && parsed.type !== "transferWithSeed") continue;

    const source = parsed.info?.source;
    const destination = parsed.info?.destination;
    const lamportsValue = parsed.info?.lamports;

    if (!source || destination !== wallet || lamportsValue === undefined || source === wallet) continue;

    try {
      const lamports = BigInt(String(lamportsValue));
      if (lamports >= MIN_FUNDING_LAMPORTS) transfers.push({ source, lamports });
    } catch {
      // Ignore malformed parsed transfer amounts.
    }
  }

  return transfers.sort((a, b) => (a.lamports > b.lamports ? -1 : 1));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    results.push(...(await Promise.all(items.slice(index, index + concurrency).map(mapper))));
  }
  return results;
}

async function parseTransactions(
  connection: Connection,
  signatures: ConfirmedSignatureInfo[],
) {
  if (!signatures.length) return [];

  return withRpcRetry(() =>
    connection.getParsedTransactions(
      signatures.map((row) => row.signature),
      {
        commitment: "confirmed",
        maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
      },
    ),
  );
}

function classifyHistory(
  rows: ConfirmedSignatureInfo[],
  historyExhausted: boolean,
  firstBuyBlockTime: number | null,
): { historyClass: WalletHistoryClass; ageSecondsAtBuy: number | null; oldestSampledBlockTime: number | null } {
  const timed = rows
    .map((row) => row.blockTime ?? null)
    .filter((value): value is number => value !== null);
  const oldestSampledBlockTime = timed.length ? Math.min(...timed) : null;

  if (!rows.length && historyExhausted) {
    return {
      historyClass: "no-prior-history",
      ageSecondsAtBuy: 0,
      oldestSampledBlockTime: null,
    };
  }

  if (oldestSampledBlockTime === null || firstBuyBlockTime === null) {
    return {
      historyClass: historyExhausted ? "unknown" : "deep-history",
      ageSecondsAtBuy: null,
      oldestSampledBlockTime,
    };
  }

  const ageSecondsAtBuy = Math.max(0, firstBuyBlockTime - oldestSampledBlockTime);

  if (!historyExhausted) {
    return { historyClass: "deep-history", ageSecondsAtBuy, oldestSampledBlockTime };
  }

  const historyClass: WalletHistoryClass =
    ageSecondsAtBuy <= 3_600
      ? "fresh-1h"
      : ageSecondsAtBuy <= 86_400
        ? "fresh-24h"
        : "established";

  return { historyClass, ageSecondsAtBuy, oldestSampledBlockTime };
}

async function loadPreBuyHistory(
  connection: Connection,
  buyer: FundingBuyerInput,
  launchSlot: number,
) {
  const address = new PublicKey(buyer.wallet);
  let rows: ConfirmedSignatureInfo[];
  let anchored = true;

  try {
    rows = await connection.getSignaturesForAddress(
      address,
      { before: buyer.firstBuySignature, limit: HISTORY_SAMPLE_LIMIT },
      "confirmed",
    );
  } catch {
    anchored = false;
    rows = await connection.getSignaturesForAddress(
      address,
      { limit: HISTORY_SAMPLE_LIMIT },
      "confirmed",
    );
  }

  const preLaunchRows = rows.filter((row) => !row.err && row.slot <= launchSlot);
  const historyExhausted = anchored && rows.length < HISTORY_SAMPLE_LIMIT;

  return { rows: preLaunchRows, historyExhausted };
}

async function fingerprintAndDirectFunder(
  connection: Connection,
  buyer: FundingBuyerInput,
  launchSlot: number,
  launchBlockTime: number | null,
) {
  const history = await loadPreBuyHistory(connection, buyer, launchSlot);
  const classification = classifyHistory(
    history.rows,
    history.historyExhausted,
    buyer.firstBuyBlockTime,
  );

  const fingerprint: WalletFingerprint = {
    wallet: buyer.wallet,
    sampledSignatures: history.rows.length,
    historyExhausted: history.historyExhausted,
    ...classification,
  };

  const candidates = history.rows.slice(0, TX_TO_PARSE_PER_WALLET);
  const transactions = await parseTransactions(connection, candidates);
  let link: FundingLink | null = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const tx = transactions[index];
    if (!tx || tx.meta?.err) continue;

    const transfer = inboundSystemTransfers(tx, buyer.wallet)[0];
    if (!transfer) continue;

    const blockTime = candidates[index].blockTime ?? null;
    link = {
      buyer: buyer.wallet,
      source: transfer.source,
      signature: candidates[index].signature,
      blockTime,
      secondsBeforeLaunch:
        launchBlockTime !== null && blockTime !== null
          ? Math.max(0, launchBlockTime - blockTime)
          : null,
      lamports: transfer.lamports.toString(),
      amountSol: Number(transfer.lamports) / 1_000_000_000,
    };
    break;
  }

  return { fingerprint, link };
}

async function findUpstreamFunder(
  connection: Connection,
  intermediary: string,
  launchSlot: number,
  launchBlockTime: number | null,
): Promise<UpstreamFundingLink | null> {
  const rows = (
    await connection.getSignaturesForAddress(
      new PublicKey(intermediary),
      { limit: UPSTREAM_SIGNATURE_LIMIT },
      "confirmed",
    )
  )
    .filter((row) => !row.err && row.slot <= launchSlot)
    .slice(0, UPSTREAM_TX_TO_PARSE);

  const transactions = await parseTransactions(connection, rows);

  for (let index = 0; index < rows.length; index += 1) {
    const tx = transactions[index];
    if (!tx || tx.meta?.err) continue;

    const transfer = inboundSystemTransfers(tx, intermediary)[0];
    if (!transfer) continue;

    const blockTime = rows[index].blockTime ?? null;
    return {
      intermediary,
      source: transfer.source,
      signature: rows[index].signature,
      blockTime,
      secondsBeforeLaunch:
        launchBlockTime !== null && blockTime !== null
          ? Math.max(0, launchBlockTime - blockTime)
          : null,
      lamports: transfer.lamports.toString(),
      amountSol: Number(transfer.lamports) / 1_000_000_000,
    };
  }

  return null;
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

    clusters.push({
      source,
      memberCount: sourceLinks.length,
      totalSol: sourceLinks.reduce((sum, link) => sum + (link.amountSol ?? 0), 0),
      buyers: sourceLinks.map((link) => link.buyer),
      links: sourceLinks,
    });
  }

  return clusters.sort((a, b) =>
    b.memberCount !== a.memberCount
      ? b.memberCount - a.memberCount
      : b.totalSol - a.totalSol,
  );
}

export function buildUpstreamFundingClusters(
  upstreamLinks: UpstreamFundingLink[],
  directLinks: FundingLink[],
) {
  const buyersByIntermediary = new Map<string, string[]>();

  for (const link of directLinks) {
    const buyers = buyersByIntermediary.get(link.source) ?? [];
    buyers.push(link.buyer);
    buyersByIntermediary.set(link.source, buyers);
  }

  const bySource = new Map<string, UpstreamFundingLink[]>();
  for (const link of upstreamLinks) {
    const group = bySource.get(link.source) ?? [];
    group.push(link);
    bySource.set(link.source, group);
  }

  const clusters: UpstreamFundingCluster[] = [];

  for (const [source, links] of bySource) {
    const intermediaries = [...new Set(links.map((link) => link.intermediary))];
    if (intermediaries.length < 2) continue;

    const buyers = [...new Set(
      intermediaries.flatMap((intermediary) => buyersByIntermediary.get(intermediary) ?? []),
    )];

    if (buyers.length < 2) continue;

    clusters.push({
      source,
      intermediaryCount: intermediaries.length,
      buyerCount: buyers.length,
      intermediaries,
      buyers,
      links,
    });
  }

  return clusters.sort((a, b) =>
    b.buyerCount !== a.buyerCount
      ? b.buyerCount - a.buyerCount
      : b.intermediaryCount - a.intermediaryCount,
  );
}

/**
 * Maps first-buy wallets to their recent pre-buy history, direct SOL funder,
 * and one upstream funding hop. These are relationship clues, never proof of
 * common ownership.
 */
export async function buildFundingTrace(
  connection: Connection,
  buyers: FundingBuyerInput[],
  launchSlot: number,
): Promise<FundingTrace> {
  const uniqueBuyers = [...new Map(
    buyers.slice(0, MAX_WALLETS).map((buyer) => [
      new PublicKey(buyer.wallet).toBase58(),
      { ...buyer, wallet: new PublicKey(buyer.wallet).toBase58() },
    ]),
  ).values()];

  const launchBlockTime = await connection.getBlockTime(launchSlot).catch(() => null);

  const buyerResults = await mapWithConcurrency(
    uniqueBuyers,
    RPC_CONCURRENCY,
    (buyer) => fingerprintAndDirectFunder(connection, buyer, launchSlot, launchBlockTime),
  );

  const fingerprints = buyerResults.map((result) => result.fingerprint);
  const links = buyerResults
    .map((result) => result.link)
    .filter((link): link is FundingLink => link !== null);

  const intermediaries = [...new Set(links.map((link) => link.source))]
    .slice(0, MAX_UPSTREAM_INTERMEDIARIES);

  const maybeUpstream = await mapWithConcurrency(
    intermediaries,
    RPC_CONCURRENCY,
    (intermediary) =>
      findUpstreamFunder(connection, intermediary, launchSlot, launchBlockTime),
  );

  const upstreamLinks = maybeUpstream.filter(
    (link): link is UpstreamFundingLink => link !== null,
  );

  return {
    sampledAt: Date.now(),
    launchSlot,
    launchBlockTime,
    walletsChecked: uniqueBuyers.length,
    linksFound: links.length,
    links,
    clusters: buildFundingClusters(links),
    fingerprints,
    upstreamLinks,
    upstreamClusters: buildUpstreamFundingClusters(upstreamLinks, links),
  };
}

export type Launch = {
  id: string;
  signature: string;
  slot: number;
  seenAt: number;
  name: string;
  symbol: string;
  uri: string | null;
  mint: string;
  creator: string;
  payer: string | null;
  bondingCurve: string;
  associatedBondingCurve: string;
  source: "pump.fun";
  isMayhemMode: boolean | null;
  isHolderReward: boolean | null;
};

export type HolderRow = {
  rank: number;
  tokenAccount: string;
  owner: string | null;
  rawAmount: string;
  uiAmount: number | null;
  shareOfExternalPct: number | null;
};

export type ExcludedInventoryRow = {
  label: string;
  tokenAccount: string;
  rawAmount: string;
  supplyPct: number | null;
};

export type TokenDistributionSnapshot = {
  mint: string;
  sampledAt: number;
  decimals: number;
  rawSupply: string;
  uiSupply: number | null;
  excludedInventory: ExcludedInventoryRow[];
  rawExternalSupply: string;
  externalFloatPct: number | null;
  top1ExternalPct: number | null;
  top10ExternalPct: number | null;
  holders: HolderRow[];
};

export type TokenSnapshot = {
  mint: string;
  sampledAt: number;
  decimals: number;
  rawSupply: string;
  uiSupply: number | null;
  bondingCurve: string;
  associatedBondingCurve: string;
  rawCurveInventory: string;
  curveInventoryPct: number | null;
  rawExternalSupply: string;
  externalFloatPct: number | null;
  top1ExternalPct: number | null;
  top10ExternalPct: number | null;
  holders: HolderRow[];
};

export type EarlyBuyerRow = {
  rank: number;
  wallet: string;
  signature: string;
  slot: number;
  blockTime: number | null;
  secondsAfterLaunch: number | null;
  rawTokenDelta: string;
  uiTokenDelta: number | null;
  supplyPct: number | null;
  isCreator: boolean;
};

export type EarlyBuyerScan = {
  mint: string;
  bondingCurve: string;
  launchSlot: number;
  launchBlockTime: number | null;
  sampledAt: number;
  historyComplete: boolean;
  signaturesScanned: number;
  relevantSignaturesSeen: number;
  transactionsParsed: number;
  buyers: EarlyBuyerRow[];
};


export type StonkFunBuyVariant =
  | "buy_exact_in"
  | "buy_exact_out";

export type StonkFunEarlyBuyerRow = {
  rank: number;
  wallet: string;
  signature: string;
  slot: number;
  blockTime: number | null;
  secondsAfterLaunch: number | null;
  rawTokenDelta: string;
  uiTokenDelta: number | null;
  supplyPct: number | null;
  isCreator: boolean;
  buyVariant: StonkFunBuyVariant;
};

export type StonkFunEarlyBuyerScan = {
  mint: string;
  poolState: string;
  launchSlot: number;
  launchBlockTime: number | null;
  sampledAt: number;
  historyComplete: boolean;
  signaturesScanned: number;
  relevantSignaturesSeen: number;
  transactionsParsed: number;
  buyTransactionsSeen: number;
  buyers: StonkFunEarlyBuyerRow[];
};

export type EarlyRetentionStatus =
  | "jeeted"
  | "mostly-jeeted"
  | "trimmed"
  | "holding"
  | "added";

export type EarlyRetentionInput = {
  wallet: string;
  rawFirstBuy: string;
};

export type EarlyRetentionRow = {
  wallet: string;
  rawFirstBuy: string;
  rawCurrent: string;
  uiFirstBuy: number | null;
  uiCurrent: number | null;
  retainedPct: number | null;
  status: EarlyRetentionStatus;
};

export type EarlyRetentionScan = {
  mint: string;
  sampledAt: number;
  decimals: number;
  walletsChecked: number;
  jeetedCount: number;
  mostlyJeetedCount: number;
  trimmedCount: number;
  holdingCount: number;
  addedCount: number;
  rows: EarlyRetentionRow[];
};

export type FundingBuyerInput = {
  wallet: string;
  firstBuySignature: string;
  firstBuyBlockTime: number | null;
};

export type WalletHistoryClass =
  | "no-prior-history"
  | "fresh-1h"
  | "fresh-24h"
  | "established"
  | "deep-history"
  | "unknown";

export type WalletFingerprint = {
  wallet: string;
  sampledSignatures: number;
  historyExhausted: boolean;
  oldestSampledBlockTime: number | null;
  ageSecondsAtBuy: number | null;
  historyClass: WalletHistoryClass;
};

export type FundingLink = {
  buyer: string;
  source: string;
  signature: string;
  blockTime: number | null;
  secondsBeforeLaunch: number | null;
  lamports: string;
  amountSol: number | null;
};

export type FundingCluster = {
  source: string;
  memberCount: number;
  totalSol: number;
  buyers: string[];
  links: FundingLink[];
};

export type UpstreamFundingLink = {
  intermediary: string;
  source: string;
  signature: string;
  blockTime: number | null;
  secondsBeforeLaunch: number | null;
  lamports: string;
  amountSol: number | null;
};

export type UpstreamFundingCluster = {
  source: string;
  intermediaryCount: number;
  buyerCount: number;
  intermediaries: string[];
  buyers: string[];
  links: UpstreamFundingLink[];
};

export type FundingTrace = {
  sampledAt: number;
  launchSlot: number;
  launchBlockTime: number | null;
  walletsChecked: number;
  linksFound: number;
  links: FundingLink[];
  clusters: FundingCluster[];
  fingerprints: WalletFingerprint[];
  upstreamLinks: UpstreamFundingLink[];
  upstreamClusters: UpstreamFundingCluster[];
};

export type DevLaunchRow = {
  signature: string;
  slot: number;
  blockTime: number | null;
  name: string;
  symbol: string;
  mint: string;
  isMayhemMode: boolean | null;
};

export type DevHistoryScan = {
  creator: string;
  sampledAt: number;
  signaturesSampled: number;
  transactionsParsed: number;
  oldestSampledBlockTime: number | null;
  priorLaunches: DevLaunchRow[];
};

export type ReplayLaunch = {
  launch: Launch;
  launchBlockTime: number | null;
  replayedAt: number;
};

export type StreamStatus = {
  state: "connecting" | "live" | "error";
  message?: string;
  program?: string;
};

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

export type StreamStatus = {
  state: "connecting" | "live" | "error";
  message?: string;
  program?: string;
};

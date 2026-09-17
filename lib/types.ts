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
  source: "pump.fun";
  isMayhemMode: boolean | null;
  isHolderReward: boolean | null;
};

export type StreamStatus = {
  state: "connecting" | "live" | "error";
  message?: string;
  program?: string;
};

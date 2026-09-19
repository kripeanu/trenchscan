import type { Launch } from "./types";
import type { StonkFunLaunch } from "./stonkfun";

export type LaunchSource = "pump.fun" | "stonkfun.xyz";

export type LaunchVenue =
  | {
      kind: "pump";
      bondingCurve: string;
      associatedBondingCurve: string;
      mayhemMode: boolean | null;
      holderReward: boolean | null;
    }
  | {
      kind: "raydium-launchlab";
      poolState: string;
      platformConfig: string;
      baseVault: string;
      quoteVault: string;
      quoteMint: string;
      variant: StonkFunLaunch["variant"];
      rewardMode: boolean;
    };

export type LaunchEnvelope = {
  id: string;
  signature: string;
  slot: number;
  seenAt: number;
  source: LaunchSource;
  name: string;
  symbol: string;
  uri: string | null;
  mint: string;
  creator: string;
  payer: string | null;
  venue: LaunchVenue;
};

export function pumpLaunchEnvelope(launch: Launch): LaunchEnvelope {
  return {
    id: launch.id,
    signature: launch.signature,
    slot: launch.slot,
    seenAt: launch.seenAt,
    source: launch.source,
    name: launch.name,
    symbol: launch.symbol,
    uri: launch.uri,
    mint: launch.mint,
    creator: launch.creator,
    payer: launch.payer,
    venue: {
      kind: "pump",
      bondingCurve: launch.bondingCurve,
      associatedBondingCurve: launch.associatedBondingCurve,
      mayhemMode: launch.isMayhemMode,
      holderReward: launch.isHolderReward,
    },
  };
}

export function pumpLaunchFromEnvelope(
  envelope: LaunchEnvelope,
): Launch | null {
  if (envelope.source !== "pump.fun" || envelope.venue.kind !== "pump") {
    return null;
  }

  return {
    id: envelope.id,
    signature: envelope.signature,
    slot: envelope.slot,
    seenAt: envelope.seenAt,
    name: envelope.name,
    symbol: envelope.symbol,
    uri: envelope.uri,
    mint: envelope.mint,
    creator: envelope.creator,
    payer: envelope.payer,
    bondingCurve: envelope.venue.bondingCurve,
    associatedBondingCurve: envelope.venue.associatedBondingCurve,
    source: "pump.fun",
    isMayhemMode: envelope.venue.mayhemMode,
    isHolderReward: envelope.venue.holderReward,
  };
}

export function stonkFunLaunchEnvelope(
  launch: StonkFunLaunch,
): LaunchEnvelope {
  return {
    id: launch.id,
    signature: launch.signature,
    slot: launch.slot,
    seenAt: launch.seenAt,
    source: launch.source,
    name: launch.name,
    symbol: launch.symbol,
    uri: launch.uri,
    mint: launch.mint,
    creator: launch.creator,
    payer: launch.payer,
    venue: {
      kind: "raydium-launchlab",
      poolState: launch.poolState,
      platformConfig: launch.platformConfig,
      baseVault: launch.baseVault,
      quoteVault: launch.quoteVault,
      quoteMint: launch.quoteMint,
      variant: launch.variant,
      rewardMode: launch.rewardMode,
    },
  };
}

export function launchSourceLabel(source: LaunchSource) {
  return source === "pump.fun" ? "PUMP" : "STONKFUN";
}

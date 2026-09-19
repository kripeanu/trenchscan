import { describe, expect, it } from "vitest";
import { pumpLaunchEnvelope, stonkFunLaunchEnvelope } from "./launch-source";
import type { Launch } from "./types";
import type { StonkFunLaunch } from "./stonkfun";

const pump: Launch = {
  id: "pump-sig",
  signature: "pump-sig",
  slot: 11,
  seenAt: 22,
  name: "Pump Test",
  symbol: "PUMPY",
  uri: "https://example.com/pump.json",
  mint: "pump-mint",
  creator: "pump-creator",
  payer: "pump-payer",
  bondingCurve: "curve",
  associatedBondingCurve: "curve-ata",
  source: "pump.fun",
  isMayhemMode: true,
  isHolderReward: null,
};

const stonk: StonkFunLaunch = {
  id: "stonk-sig",
  signature: "stonk-sig",
  slot: 33,
  seenAt: 44,
  source: "stonkfun.xyz",
  variant: "initialize_with_token_2022",
  rewardMode: true,
  decimals: 6,
  name: "Stonk Test",
  symbol: "STONK",
  uri: "https://example.com/stonk.json",
  payer: "stonk-payer",
  creator: "stonk-creator",
  globalConfig: "global",
  platformConfig: "platform",
  authority: "authority",
  poolState: "pool",
  mint: "stonk-mint",
  quoteMint: "quote",
  baseVault: "base-vault",
  quoteVault: "quote-vault",
  baseTokenProgram: "token-2022",
  quoteTokenProgram: "spl-token",
};

describe("source-neutral launch envelope", () => {
  it("keeps Pump identity common while preserving Pump-only venue evidence", () => {
    const envelope = pumpLaunchEnvelope(pump);

    expect(envelope.source).toBe("pump.fun");
    expect(envelope.symbol).toBe("PUMPY");
    expect(envelope.venue.kind).toBe("pump");

    if (envelope.venue.kind === "pump") {
      expect(envelope.venue.bondingCurve).toBe("curve");
      expect(envelope.venue.mayhemMode).toBe(true);
    }
  });

  it("keeps StonkFun identity common while preserving LaunchLab-only venue evidence", () => {
    const envelope = stonkFunLaunchEnvelope(stonk);

    expect(envelope.source).toBe("stonkfun.xyz");
    expect(envelope.symbol).toBe("STONK");
    expect(envelope.venue.kind).toBe("raydium-launchlab");

    if (envelope.venue.kind === "raydium-launchlab") {
      expect(envelope.venue.poolState).toBe("pool");
      expect(envelope.venue.quoteMint).toBe("quote");
      expect(envelope.venue.rewardMode).toBe(true);
    }
  });
});

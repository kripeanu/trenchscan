import { describe, expect, it } from "vitest";
import { buildProofPack, buildShareText } from "./proof-pack";
import type { Launch, TokenSnapshot } from "./types";
import type { TrenchBrief } from "./trench-brief";

const launch: Launch = {
  id: "sig",
  signature: "sig",
  slot: 1,
  seenAt: 1,
  name: "Test",
  symbol: "TEST",
  uri: null,
  mint: "mint",
  creator: "creator",
  payer: "payer",
  bondingCurve: "curve",
  associatedBondingCurve: "curve-ata",
  source: "pump.fun",
  isMayhemMode: false,
  isHolderReward: null,
};

const snapshot: TokenSnapshot = {
  mint: "mint",
  sampledAt: 1,
  decimals: 6,
  rawSupply: "1000",
  uiSupply: 1000,
  bondingCurve: "curve",
  associatedBondingCurve: "curve-ata",
  rawCurveInventory: "100",
  curveInventoryPct: 10,
  rawExternalSupply: "900",
  externalFloatPct: 90,
  top1ExternalPct: 10,
  top10ExternalPct: 40,
  holders: [],
};

const brief: TrenchBrief = {
  label: "KEEP BOTH EYES OPEN",
  tone: "warning",
  signals: [{
    label: "TOP BAGS",
    value: "40.0%",
    detail: "test",
    tone: "good",
  }],
  bottomLine: "Top 10 external bags sit at 40.0%.",
};

describe("proof pack", () => {
  it("exports core receipts and caveats without inventing evidence", () => {
    const pack = buildProofPack({
      launch,
      snapshot,
      earlyBuyers: null,
      fundingTrace: null,
      devHistory: null,
      trenchBrief: brief,
      generatedAt: 123,
    });

    expect(pack.schemaVersion).toBe(1);
    expect(pack.generatedAt).toBe(123);
    expect(pack.receipts.launchTx).toContain("/tx/sig");
    expect(pack.receipts.directFundingTxs).toEqual([]);
    expect(pack.limitations.join(" ")).toContain("not proof");
  });

  it("builds trench-native share copy with an optional replay link", () => {
    const text = buildShareText({
      launch,
      brief,
      replayUrl: "https://trenchscan.fun/?replay=sig",
    });

    expect(text).toContain("$TEST // TrenchScan");
    expect(text).toContain("KEEP BOTH EYES OPEN");
    expect(text).toContain("Receipts: https://trenchscan.fun/?replay=sig");
    expect(text).toContain("Fresh trenches. Less bullshit.");
  });
});

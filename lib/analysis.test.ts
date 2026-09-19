import { describe, expect, it } from "vitest";
import { deriveDevBagPct } from "./analysis";
import type { TokenSnapshot } from "./types";

const baseSnapshot: TokenSnapshot = {
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
  top1ExternalPct: 20,
  top10ExternalPct: 50,
  holders: [],
};

describe("deriveDevBagPct", () => {
  it("uses total token supply for the creator bag", () => {
    const snapshot: TokenSnapshot = {
      ...baseSnapshot,
      holders: [{
        rank: 1,
        tokenAccount: "dev-ata",
        owner: "creator",
        rawAmount: "125",
        uiAmount: 125,
        shareOfExternalPct: 13.89,
      }],
    };

    expect(deriveDevBagPct(snapshot, "creator")).toBe(12.5);
  });

  it("returns null when the creator is outside the sampled holders", () => {
    expect(deriveDevBagPct(baseSnapshot, "creator")).toBeNull();
  });

  it("returns null when UI supply is unavailable", () => {
    expect(
      deriveDevBagPct({ ...baseSnapshot, uiSupply: null }, "creator"),
    ).toBeNull();
  });
});

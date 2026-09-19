import { describe, expect, it } from "vitest";
import { buildSameSlotClusters } from "./early-timing";
import type { EarlyBuyerScan } from "./types";

function scan(slots: number[]): EarlyBuyerScan {
  return {
    mint: "mint",
    bondingCurve: "curve",
    launchSlot: 100,
    launchBlockTime: 1000,
    sampledAt: 1,
    historyComplete: true,
    signaturesScanned: slots.length,
    relevantSignaturesSeen: slots.length,
    transactionsParsed: slots.length,
    buyers: slots.map((slot, index) => ({
      rank: index + 1,
      wallet: `wallet-${index}`,
      signature: `sig-${index}`,
      slot,
      blockTime: 1000 + index,
      secondsAfterLaunch: index,
      rawTokenDelta: "100",
      uiTokenDelta: 100,
      supplyPct: index + 1,
      isCreator: false,
    })),
  };
}

describe("buildSameSlotClusters", () => {
  it("groups only buyers that landed in the exact same slot", () => {
    const clusters = buildSameSlotClusters(scan([101, 101, 102, 103, 103, 103]));

    expect(clusters).toHaveLength(2);
    expect(clusters[0].slot).toBe(103);
    expect(clusters[0].buyerCount).toBe(3);
    expect(clusters[1].slot).toBe(101);
    expect(clusters[1].buyerCount).toBe(2);
  });

  it("does not create a cluster from merely adjacent slots", () => {
    expect(buildSameSlotClusters(scan([101, 102, 103]))).toEqual([]);
  });

  it("adds known supply share without inventing missing values", () => {
    const input = scan([101, 101]);
    input.buyers[1].supplyPct = null;

    const cluster = buildSameSlotClusters(input)[0];
    expect(cluster.combinedSupplyPct).toBe(1);
  });
});

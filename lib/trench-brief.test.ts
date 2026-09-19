import { describe, expect, it } from "vitest";
import { buildTrenchBrief } from "./trench-brief";
import type { DevHistoryScan, EarlyBuyerScan, EarlyRetentionScan, FundingTrace, TokenSnapshot } from "./types";

const snapshot = (top10ExternalPct: number): TokenSnapshot => ({
  mint: "mint",
  sampledAt: 1,
  decimals: 6,
  rawSupply: "1000000000",
  uiSupply: 1000,
  bondingCurve: "curve",
  associatedBondingCurve: "ata",
  rawCurveInventory: "100",
  curveInventoryPct: 10,
  rawExternalSupply: "900",
  externalFloatPct: 90,
  top1ExternalPct: 15,
  top10ExternalPct,
  holders: [],
});

const early = (pcts: number[], complete = true): EarlyBuyerScan => ({
  mint: "mint",
  bondingCurve: "curve",
  launchSlot: 1,
  launchBlockTime: 100,
  sampledAt: 200,
  historyComplete: complete,
  signaturesScanned: 10,
  relevantSignaturesSeen: 10,
  transactionsParsed: 10,
  buyers: pcts.map((supplyPct, index) => ({
    rank: index + 1,
    wallet: `wallet-${index}`,
    signature: `sig-${index}`,
    slot: index + 2,
    blockTime: 100 + index,
    secondsAfterLaunch: index < 5 ? 10 : 45,
    rawTokenDelta: "1",
    uiTokenDelta: 1,
    supplyPct,
    isCreator: false,
  })),
});

const dev = (count: number): DevHistoryScan => ({
  creator: "creator",
  sampledAt: 1,
  signaturesSampled: 60,
  transactionsParsed: 60,
  oldestSampledBlockTime: 1,
  priorLaunches: Array.from({ length: count }, (_, index) => ({
    signature: `dev-sig-${index}`,
    slot: index,
    blockTime: 1,
    name: `Token ${index}`,
    symbol: `T${index}`,
    mint: `mint-${index}`,
    isMayhemMode: false,
  })),
});

const funding = (members: number): FundingTrace => ({
  sampledAt: 1,
  launchSlot: 1,
  launchBlockTime: 100,
  walletsChecked: members,
  linksFound: members,
  links: [],
  clusters: members > 1 ? [{
    source: "source",
    memberCount: members,
    totalSol: members,
    buyers: Array.from({ length: members }, (_, index) => `wallet-${index}`),
    links: [],
  }] : [],
  fingerprints: Array.from({ length: members }, (_, index) => ({
    wallet: `wallet-${index}`,
    sampledSignatures: 2,
    historyExhausted: true,
    oldestSampledBlockTime: 50,
    ageSecondsAtBuy: 50,
    historyClass: "fresh-1h" as const,
  })),
  upstreamLinks: [],
  upstreamClusters: [],
});

const retention = (statuses: Array<"jeeted" | "mostly-jeeted" | "trimmed" | "holding" | "added">): EarlyRetentionScan => ({
  mint: "mint",
  sampledAt: 1,
  decimals: 6,
  walletsChecked: statuses.length,
  jeetedCount: statuses.filter((status) => status === "jeeted").length,
  mostlyJeetedCount: statuses.filter((status) => status === "mostly-jeeted").length,
  trimmedCount: statuses.filter((status) => status === "trimmed").length,
  holdingCount: statuses.filter((status) => status === "holding").length,
  addedCount: statuses.filter((status) => status === "added").length,
  rows: statuses.map((status, index) => ({
    wallet: `wallet-${index}`,
    rawFirstBuy: "100",
    rawCurrent: status === "jeeted" ? "0" : status === "mostly-jeeted" ? "10" : "100",
    uiFirstBuy: 100,
    uiCurrent: status === "jeeted" ? 0 : status === "mostly-jeeted" ? 10 : 100,
    retainedPct: status === "jeeted" ? 0 : status === "mostly-jeeted" ? 10 : 100,
    status,
  })),
});

describe("buildTrenchBrief", () => {
  it("stays conservative when relationship checks are missing", () => {
    const brief = buildTrenchBrief({
      snapshot: snapshot(35),
      earlyBuyers: early([2, 2, 2]),
      fundingTrace: null,
      devHistory: null,
      devBagPct: null,
    });

    expect(brief.label).toBe("MORE RECEIPTS NEEDED");
    expect(brief.tone).toBe("neutral");
    expect(brief.signals.find((signal) => signal.label === "SAME BANKROLL?")?.value).toBe("NOT CHECKED");
    expect(brief.signals.find((signal) => signal.label === "DEV BAGGAGE")?.value).toBe("NOT CHECKED");
  });

  it("raises multiple red flags only from visible evidence", () => {
    const brief = buildTrenchBrief({
      snapshot: snapshot(78),
      earlyBuyers: early([10, 9, 8, 7, 6]),
      fundingTrace: funding(5),
      devHistory: dev(5),
      devBagPct: 12,
    });

    expect(brief.label).toBe("MULTIPLE RED FLAGS");
    expect(brief.tone).toBe("danger");
    expect(brief.bottomLine).toContain("5 early wallets share one direct funder");
    expect(brief.signals.filter((signal) => signal.tone === "danger").length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces an upstream funding family without calling it ownership proof", () => {
    const trace = funding(3);
    trace.upstreamClusters = [{
      source: "root",
      intermediaryCount: 2,
      buyerCount: 3,
      intermediaries: ["funder-a", "funder-b"],
      buyers: ["wallet-0", "wallet-1", "wallet-2"],
      links: [],
    }];

    const brief = buildTrenchBrief({
      snapshot: snapshot(45),
      earlyBuyers: early([4, 4, 4]),
      fundingTrace: trace,
      devHistory: dev(0),
      devBagPct: 1,
    });

    const signal = brief.signals.find((row) => row.label === "ONE HOP DEEPER");
    expect(signal?.value).toBe("3 WALLETS");
    expect(signal?.detail).toContain("Relationship clue, not ownership proof");
  });

  it("surfaces same-slot timing without calling it a bundle", () => {
    const earlyScan = early([2, 2, 2, 2]);
    earlyScan.buyers.forEach((buyer) => {
      buyer.slot = 777;
    });

    const brief = buildTrenchBrief({
      snapshot: snapshot(40),
      earlyBuyers: earlyScan,
      fundingTrace: null,
      devHistory: null,
      devBagPct: null,
    });

    const signal = brief.signals.find((row) => row.label === "SAME SLOT?");
    expect(signal?.value).toBe("4 WALLETS");
    expect(signal?.tone).toBe("warning");
    expect(signal?.detail).toContain("not proof of a Jito bundle");
  });

  it("surfaces early wallets that already dumped most of the first decoded grab", () => {
    const brief = buildTrenchBrief({
      snapshot: snapshot(42),
      earlyBuyers: early([3, 3, 3, 3, 3, 3]),
      earlyRetention: retention([
        "jeeted",
        "mostly-jeeted",
        "jeeted",
        "mostly-jeeted",
        "holding",
        "holding",
      ]),
      fundingTrace: funding(1),
      devHistory: dev(0),
      devBagPct: 1,
    });

    const signal = brief.signals.find((row) => row.label === "EARLY EXIT?");
    expect(signal?.value).toBe("4/6 DUMPED MOST");
    expect(signal?.tone).toBe("warning");
    expect(brief.bottomLine).toContain("4/6 checked early wallets");
  });

  it("does not pretend a partial early window is complete", () => {
    const brief = buildTrenchBrief({
      snapshot: snapshot(40),
      earlyBuyers: early([5, 5, 5], false),
      fundingTrace: funding(1),
      devHistory: dev(0),
      devBagPct: 1,
    });

    const earlySignal = brief.signals.find((signal) => signal.label === "EARLY WINDOW");
    expect(earlySignal?.detail).toContain("launch boundary was not reached");
    expect(brief.label).toBe("NO BIG FLAG YET");
  });
});

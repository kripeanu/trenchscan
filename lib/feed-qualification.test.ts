import { describe, expect, it } from "vitest";
import { buildFeedQualification } from "./feed-qualification";

const NOW = 1_000_000;

describe("feed qualification", () => {
  it("qualifies only when transparent receipt thresholds are met", () => {
    expect(
      buildFeedQualification({
        now: NOW,
        devLaunchesInWindow: 1,
        evidence: {
          coverage: "ready",
          activityCoverage: "ready",
          sampledExternalAccounts: 8,
          earlyBuyerCount: 5,
          top1ExternalPct: 18,
          top10ExternalPct: 44,
          lastActivityAt: NOW - 30_000,
        },
      }).state,
    ).toBe("qualified");
  });

  it("keeps thin launches in watching instead of pretending they are signal", () => {
    const result = buildFeedQualification({
      now: NOW,
      devLaunchesInWindow: 1,
      evidence: {
        coverage: "ready",
        activityCoverage: "ready",
        sampledExternalAccounts: 3,
        earlyBuyerCount: 2,
        top1ExternalPct: 51,
        top10ExternalPct: 82,
        lastActivityAt: NOW - 20_000,
      },
    });

    expect(result.state).toBe("watching");
    expect(result.reasons.join(" ")).toContain("needs 6+");
    expect(result.reasons.join(" ")).toContain("needs 4+");
  });

  it("does not call a launch qualified when its pool has gone quiet", () => {
    const result = buildFeedQualification({
      now: NOW,
      devLaunchesInWindow: 1,
      evidence: {
        coverage: "ready",
        activityCoverage: "ready",
        sampledExternalAccounts: 10,
        earlyBuyerCount: 9,
        top1ExternalPct: 12,
        top10ExternalPct: 40,
        lastActivityAt: NOW - 5 * 60_000,
      },
    });

    expect(result.state).toBe("watching");
    expect(result.reasons.join(" ")).toContain("last 2m");
  });

  it("ages out a launch after ten quiet minutes while RAW can still preserve it", () => {
    const result = buildFeedQualification({
      now: NOW,
      devLaunchesInWindow: 1,
      evidence: {
        coverage: "ready",
        activityCoverage: "ready",
        sampledExternalAccounts: 10,
        earlyBuyerCount: 9,
        top1ExternalPct: 12,
        top10ExternalPct: 40,
        lastActivityAt: NOW - 11 * 60_000,
      },
    });

    expect(result.state).toBe("stale");
  });

  it("suppresses observed rapid-fire creator floods without calling them scams", () => {
    const result = buildFeedQualification({
      now: NOW,
      devLaunchesInWindow: 5,
      evidence: null,
    });

    expect(result.state).toBe("dev-flood");
    expect(result.reasons[0]).toContain("5 launches");
  });

  it("keeps verified demo receipts available even during creator flood", () => {
    expect(
      buildFeedQualification({
        now: NOW,
        devLaunchesInWindow: 20,
        replay: true,
        evidence: null,
      }).state,
    ).toBe("qualified");
  });
});

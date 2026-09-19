import { describe, expect, it } from "vitest";
import { buildFeedQualification } from "./feed-qualification";

const NOW = 1_000_000;

function evidence(overrides: Partial<Parameters<typeof buildFeedQualification>[0]["evidence"] & {}> = {}) {
  return {
    holders: 18,
    holdersComplete: true,
    marketCapUsd: 14_000,
    lastActivityAt: NOW - 20_000,
    statsCoverage: "ready" as const,
    activityCoverage: "ready" as const,
    ...overrides,
  };
}

describe("feed qualification", () => {
  it("passes a launch with enough holders, market cap, and recent activity", () => {
    expect(
      buildFeedQualification({
        now: NOW,
        seenAt: NOW - 60_000,
        devLaunchesInWindow: 1,
        evidence: evidence(),
      }).state,
    ).toBe("active");
  });

  it("filters launches with too few holders", () => {
    const result = buildFeedQualification({
      now: NOW,
      seenAt: NOW - 60_000,
      devLaunchesInWindow: 1,
      evidence: evidence({ holders: 4 }),
    });

    expect(result.state).toBe("low-holders");
    expect(result.reason).toContain("4 holders");
  });

  it("filters launches below the market-cap floor", () => {
    expect(
      buildFeedQualification({
        now: NOW,
        seenAt: NOW - 60_000,
        devLaunchesInWindow: 1,
        evidence: evidence({ marketCapUsd: 3_500 }),
      }).state,
    ).toBe("low-market-cap");
  });

  it("keeps otherwise good launches out of active when activity cools", () => {
    expect(
      buildFeedQualification({
        now: NOW,
        seenAt: NOW - 5 * 60_000,
        devLaunchesInWindow: 1,
        evidence: evidence({ lastActivityAt: NOW - 5 * 60_000 }),
      }).state,
    ).toBe("quiet");
  });

  it("ages out a launch after ten quiet minutes", () => {
    expect(
      buildFeedQualification({
        now: NOW,
        seenAt: NOW - 12 * 60_000,
        devLaunchesInWindow: 1,
        evidence: evidence({ lastActivityAt: NOW - 11 * 60_000 }),
      }).state,
    ).toBe("stale");
  });

  it("describes provider trouble as delayed data, not token risk", () => {
    expect(
      buildFeedQualification({
        now: NOW,
        seenAt: NOW - 30_000,
        devLaunchesInWindow: 1,
        evidence: evidence({
          holders: null,
          statsCoverage: "unavailable",
        }),
      }).state,
    ).toBe("data-delayed");
  });

  it("suppresses rapid-fire creator floods without calling them scams", () => {
    const result = buildFeedQualification({
      now: NOW,
      seenAt: NOW - 30_000,
      devLaunchesInWindow: 5,
      evidence: null,
    });

    expect(result.state).toBe("dev-spam");
    expect(result.reason).toContain("5 launches");
  });

  it("keeps verified demo receipts visible", () => {
    expect(
      buildFeedQualification({
        now: NOW,
        seenAt: NOW,
        devLaunchesInWindow: 20,
        replay: true,
        evidence: null,
      }).state,
    ).toBe("active");
  });
});

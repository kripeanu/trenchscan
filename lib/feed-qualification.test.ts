import { describe, expect, it } from "vitest";
import { buildFeedQualification } from "./feed-qualification";

describe("feed qualification", () => {
  it("qualifies only when transparent receipt thresholds are met", () => {
    expect(
      buildFeedQualification({
        devLaunchesInWindow: 1,
        evidence: {
          coverage: "ready",
          sampledExternalAccounts: 8,
          earlyBuyerCount: 5,
          top1ExternalPct: 18,
          top10ExternalPct: 44,
        },
      }).state,
    ).toBe("qualified");
  });

  it("keeps thin launches in watching instead of pretending they are signal", () => {
    const result = buildFeedQualification({
      devLaunchesInWindow: 1,
      evidence: {
        coverage: "ready",
        sampledExternalAccounts: 3,
        earlyBuyerCount: 2,
        top1ExternalPct: 51,
        top10ExternalPct: 82,
      },
    });

    expect(result.state).toBe("watching");
    expect(result.reasons.join(" ")).toContain("needs 6+");
    expect(result.reasons.join(" ")).toContain("needs 4+");
  });

  it("suppresses observed rapid-fire creator floods without calling them scams", () => {
    const result = buildFeedQualification({
      devLaunchesInWindow: 5,
      evidence: null,
    });

    expect(result.state).toBe("dev-flood");
    expect(result.reasons[0]).toContain("5 launches");
  });

  it("keeps verified demo receipts available even during creator flood", () => {
    expect(
      buildFeedQualification({
        devLaunchesInWindow: 20,
        replay: true,
        evidence: null,
      }).state,
    ).toBe("qualified");
  });
});

import { describe, expect, it } from "vitest";
import { computeDistributionMath } from "./snapshot";

describe("computeDistributionMath", () => {
  it("removes protocol inventory before holder concentration math", () => {
    const result = computeDistributionMath(
      1_000n,
      600n,
      [100n, 80n, 50n, 20n],
    );

    expect(result.rawExternalSupply).toBe(400n);
    expect(result.externalFloatPct).toBe(40);
    expect(result.excludedInventoryPct).toBe(60);
    expect(result.top1ExternalPct).toBe(25);
    expect(result.top10ExternalPct).toBe(62.5);
  });

  it("clamps external supply when an invalid exclusion exceeds supply", () => {
    const result = computeDistributionMath(
      100n,
      120n,
      [10n],
    );

    expect(result.rawExternalSupply).toBe(0n);
    expect(result.externalFloatPct).toBe(0);
    expect(result.top1ExternalPct).toBeNull();
    expect(result.top10ExternalPct).toBeNull();
  });

  it("keeps full supply external when there is no protocol inventory", () => {
    const result = computeDistributionMath(
      1_000n,
      0n,
      [200n, 100n],
    );

    expect(result.rawExternalSupply).toBe(1_000n);
    expect(result.externalFloatPct).toBe(100);
    expect(result.top1ExternalPct).toBe(20);
    expect(result.top10ExternalPct).toBe(30);
  });
});

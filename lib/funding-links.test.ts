import { describe, expect, it } from "vitest";
import { buildFundingClusters } from "./funding-links";
import type { FundingLink } from "./types";

const link = (
  buyer: string,
  source: string,
  amountSol: number,
): FundingLink => ({
  buyer,
  source,
  signature: `sig-${buyer}`,
  blockTime: 1,
  secondsBeforeLaunch: 10,
  lamports: String(Math.round(amountSol * 1_000_000_000)),
  amountSol,
});

describe("buildFundingClusters", () => {
  it("groups buyers by shared direct funder", () => {
    const clusters = buildFundingClusters([
      link("a", "source-1", 1),
      link("b", "source-1", 2),
      link("c", "source-2", 4),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].source).toBe("source-1");
    expect(clusters[0].memberCount).toBe(2);
    expect(clusters[0].totalSol).toBe(3);
    expect(clusters[0].buyers).toEqual(["a", "b"]);
  });

  it("does not create a cluster from a single funding link", () => {
    expect(buildFundingClusters([link("a", "source-1", 1)])).toEqual([]);
  });

  it("sorts larger clusters first and uses total SOL as a tie-breaker", () => {
    const clusters = buildFundingClusters([
      link("a", "source-a", 1),
      link("b", "source-a", 1),
      link("c", "source-b", 3),
      link("d", "source-b", 2),
      link("e", "source-c", 1),
      link("f", "source-c", 1),
      link("g", "source-c", 1),
    ]);

    expect(clusters.map((cluster) => cluster.source)).toEqual([
      "source-c",
      "source-b",
      "source-a",
    ]);
  });
});

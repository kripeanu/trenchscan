import { describe, expect, it } from "vitest";
import { buildFundingGraph } from "./funding-graph";
import type { FundingTrace } from "./types";

const trace: FundingTrace = {
  sampledAt: 1,
  launchSlot: 1,
  launchBlockTime: 1,
  walletsChecked: 3,
  linksFound: 3,
  links: [
    {
      buyer: "buyer-a",
      source: "funder-a",
      signature: "sig-a",
      blockTime: 1,
      secondsBeforeLaunch: 5,
      lamports: "1",
      amountSol: 1,
    },
    {
      buyer: "buyer-b",
      source: "funder-b",
      signature: "sig-b",
      blockTime: 1,
      secondsBeforeLaunch: 5,
      lamports: "1",
      amountSol: 1,
    },
    {
      buyer: "buyer-c",
      source: "funder-b",
      signature: "sig-c",
      blockTime: 1,
      secondsBeforeLaunch: 5,
      lamports: "1",
      amountSol: 1,
    },
  ],
  clusters: [],
  fingerprints: [],
  upstreamLinks: [
    {
      intermediary: "funder-a",
      source: "root",
      signature: "up-a",
      blockTime: 1,
      secondsBeforeLaunch: 10,
      lamports: "1",
      amountSol: 1,
    },
    {
      intermediary: "funder-b",
      source: "root",
      signature: "up-b",
      blockTime: 1,
      secondsBeforeLaunch: 10,
      lamports: "1",
      amountSol: 1,
    },
  ],
  upstreamClusters: [],
};

describe("buildFundingGraph", () => {
  it("deduplicates nodes while preserving every direct and upstream edge", () => {
    const graph = buildFundingGraph(trace);

    expect(graph.nodes.filter((node) => node.type === "buyer")).toHaveLength(3);
    expect(graph.nodes.filter((node) => node.type === "funder")).toHaveLength(2);
    expect(graph.nodes.filter((node) => node.type === "upstream")).toHaveLength(1);
    expect(graph.edges.filter((edge) => edge.kind === "direct")).toHaveLength(3);
    expect(graph.edges.filter((edge) => edge.kind === "upstream")).toHaveLength(2);
  });

  it("lays upstream, funder and buyer nodes left to right", () => {
    const graph = buildFundingGraph(trace);
    const upstream = graph.nodes.find((node) => node.type === "upstream");
    const funder = graph.nodes.find((node) => node.type === "funder");
    const buyer = graph.nodes.find((node) => node.type === "buyer");

    expect(upstream?.x).toBeLessThan(funder?.x ?? 0);
    expect(funder?.x).toBeLessThan(buyer?.x ?? 0);
    expect(graph.height).toBeGreaterThanOrEqual(260);
  });
});

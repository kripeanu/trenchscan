import type { FundingTrace } from "./types";

export const FUNDING_GRAPH_VERSION = 1 as const;

export type FundingGraphNodeType = "upstream" | "funder" | "buyer";

export type FundingGraphNode = {
  id: string;
  address: string;
  type: FundingGraphNodeType;
  x: number;
  y: number;
};

export type FundingGraphEdge = {
  id: string;
  from: string;
  to: string;
  kind: "upstream" | "direct";
};

export type FundingGraphModel = {
  width: number;
  height: number;
  nodes: FundingGraphNode[];
  edges: FundingGraphEdge[];
};

const WIDTH = 1000;
const LEFT_X = 130;
const MIDDLE_X = 500;
const RIGHT_X = 870;
const TOP = 72;
const ROW_GAP = 62;
const MIN_HEIGHT = 260;

function positions(count: number, height: number) {
  if (count <= 0) return [];
  if (count === 1) return [height / 2];

  const usable = height - TOP * 2;
  const gap = usable / (count - 1);
  return Array.from({ length: count }, (_, index) => TOP + index * gap);
}

export function buildFundingGraph(trace: FundingTrace): FundingGraphModel {
  const buyers = [...new Set(trace.links.map((link) => link.buyer))].slice(0, 12);
  const funders = [...new Set(trace.links.map((link) => link.source))].slice(0, 12);
  const upstream = [...new Set(trace.upstreamLinks.map((link) => link.source))].slice(0, 8);

  const maxCount = Math.max(buyers.length, funders.length, upstream.length, 1);
  const height = Math.max(MIN_HEIGHT, TOP * 2 + (maxCount - 1) * ROW_GAP);

  const nodes: FundingGraphNode[] = [
    ...upstream.map((address, index) => ({
      id: `upstream:${address}`,
      address,
      type: "upstream" as const,
      x: LEFT_X,
      y: positions(upstream.length, height)[index],
    })),
    ...funders.map((address, index) => ({
      id: `funder:${address}`,
      address,
      type: "funder" as const,
      x: MIDDLE_X,
      y: positions(funders.length, height)[index],
    })),
    ...buyers.map((address, index) => ({
      id: `buyer:${address}`,
      address,
      type: "buyer" as const,
      x: RIGHT_X,
      y: positions(buyers.length, height)[index],
    })),
  ];

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: FundingGraphEdge[] = [];

  for (const link of trace.links) {
    const from = `funder:${link.source}`;
    const to = `buyer:${link.buyer}`;
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
    edges.push({
      id: `direct:${link.source}:${link.buyer}`,
      from,
      to,
      kind: "direct",
    });
  }

  for (const link of trace.upstreamLinks) {
    const from = `upstream:${link.source}`;
    const to = `funder:${link.intermediary}`;
    if (!nodeIds.has(from) || !nodeIds.has(to)) continue;
    edges.push({
      id: `upstream:${link.source}:${link.intermediary}`,
      from,
      to,
      kind: "upstream",
    });
  }

  return { width: WIDTH, height, nodes, edges };
}

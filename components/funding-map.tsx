"use client";

import { buildFundingGraph } from "@/lib/funding-graph";
import type { FundingTrace } from "@/lib/types";

function shortAddress(value: string) {
  return value.length > 13 ? `${value.slice(0, 6)}…${value.slice(-5)}` : value;
}

function nodeLabel(type: "upstream" | "funder" | "buyer") {
  if (type === "upstream") return "UPSTREAM";
  if (type === "funder") return "FUNDER";
  return "EARLY BUYER";
}

export function FundingMap({ trace }: { trace: FundingTrace }) {
  const model = buildFundingGraph(trace);
  if (!model.edges.length) return null;

  const byId = new Map(model.nodes.map((node) => [node.id, node]));

  return (
    <section className="funding-map">
      <div className="funding-map-head">
        <div>
          <strong>MONEY TRAIL</strong>
          <span>one-hop relationship map · receipts stay underneath</span>
        </div>
        <small>
          {trace.links.length} direct · {trace.upstreamLinks.length} upstream
        </small>
      </div>

      <div className="funding-map-canvas">
        <svg
          viewBox={`0 0 ${model.width} ${model.height}`}
          role="img"
          aria-label="Funding relationship map from upstream sources through direct funders to early buyers"
        >
          <text x="130" y="28" textAnchor="middle" className="funding-col-label">
            UPSTREAM
          </text>
          <text x="500" y="28" textAnchor="middle" className="funding-col-label">
            DIRECT FUNDERS
          </text>
          <text x="870" y="28" textAnchor="middle" className="funding-col-label">
            EARLY BUYERS
          </text>

          {model.edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;

            return (
              <line
                key={edge.id}
                x1={from.x + 86}
                y1={from.y}
                x2={to.x - 86}
                y2={to.y}
                className={`funding-edge funding-edge-${edge.kind}`}
              />
            );
          })}

          {model.nodes.map((node) => (
            <a
              key={node.id}
              href={`https://solscan.io/account/${node.address}`}
              target="_blank"
            >
              <g className={`funding-node funding-node-${node.type}`}>
                <title>{node.address}</title>
                <rect
                  x={node.x - 82}
                  y={node.y - 21}
                  width="164"
                  height="42"
                  rx="4"
                />
                <text
                  x={node.x}
                  y={node.y - 5}
                  textAnchor="middle"
                  className="funding-node-type"
                >
                  {nodeLabel(node.type)}
                </text>
                <text
                  x={node.x}
                  y={node.y + 10}
                  textAnchor="middle"
                  className="funding-node-address"
                >
                  {shortAddress(node.address)}
                </text>
              </g>
            </a>
          ))}
        </svg>
      </div>

      <div className="funding-map-note">
        MONEY TRAIL ≠ IDENTITY. Shared infrastructure can connect unrelated wallets.
      </div>
    </section>
  );
}

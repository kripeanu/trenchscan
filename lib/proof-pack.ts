import type { TrenchBrief } from "./trench-brief";
import type {
  DevHistoryScan,
  EarlyBuyerScan,
  FundingTrace,
  Launch,
  TokenSnapshot,
} from "./types";

export const PROOF_PACK_SCHEMA_VERSION = 1 as const;

export type ProofPack = {
  schemaVersion: typeof PROOF_PACK_SCHEMA_VERSION;
  generatedAt: number;
  launch: Launch;
  snapshot: TokenSnapshot;
  earlyBuyers: EarlyBuyerScan | null;
  fundingTrace: FundingTrace | null;
  devHistory: DevHistoryScan | null;
  trenchBrief: TrenchBrief;
  receipts: {
    launchTx: string;
    mint: string;
    creator: string;
    bondingCurve: string;
    earlyBuyerTxs: string[];
    directFundingTxs: string[];
    upstreamFundingTxs: string[];
    devLaunchTxs: string[];
  };
  limitations: string[];
};

const solscan = (kind: "tx" | "account" | "token", value: string) =>
  `https://solscan.io/${kind}/${value}`;

export function buildProofPack(input: {
  launch: Launch;
  snapshot: TokenSnapshot;
  earlyBuyers: EarlyBuyerScan | null;
  fundingTrace: FundingTrace | null;
  devHistory: DevHistoryScan | null;
  trenchBrief: TrenchBrief;
  generatedAt?: number;
}): ProofPack {
  const {
    launch,
    snapshot,
    earlyBuyers,
    fundingTrace,
    devHistory,
    trenchBrief,
  } = input;

  return {
    schemaVersion: PROOF_PACK_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? Date.now(),
    launch,
    snapshot,
    earlyBuyers,
    fundingTrace,
    devHistory,
    trenchBrief,
    receipts: {
      launchTx: solscan("tx", launch.signature),
      mint: solscan("token", launch.mint),
      creator: solscan("account", launch.creator),
      bondingCurve: solscan("account", snapshot.bondingCurve),
      earlyBuyerTxs:
        earlyBuyers?.buyers.map((buyer) => solscan("tx", buyer.signature)) ?? [],
      directFundingTxs:
        fundingTrace?.links.map((link) => solscan("tx", link.signature)) ?? [],
      upstreamFundingTxs:
        fundingTrace?.upstreamLinks.map((link) => solscan("tx", link.signature)) ?? [],
      devLaunchTxs:
        devHistory?.priorLaunches.map((row) => solscan("tx", row.signature)) ?? [],
    },
    limitations: [
      earlyBuyers?.historyComplete === false
        ? "Early-buyer replay is a partial bounded window and is not claimed as the literal first complete buyer set."
        : "Early-buyer conclusions are limited to decoded balance increases in the replayed Pump curve window.",
      "Wallet freshness is inferred from bounded sampled pre-buy history, not proof that an address never existed before.",
      "Shared direct or upstream funding is a relationship clue, not proof of common ownership or coordination.",
      "Prior creator launches are prior creates only; they are not labeled rugs without separate evidence.",
      "The Trench Brief is an evidence summary, not a buy/sell recommendation or hidden numeric risk score.",
    ],
  };
}

export function buildShareText(input: {
  launch: Launch;
  brief: TrenchBrief;
  replayUrl?: string | null;
}) {
  const lines = [
    `$${input.launch.symbol} // TrenchScan`,
    input.brief.label,
    "",
    ...input.brief.signals.slice(0, 6).map(
      (signal) => `${signal.label}: ${signal.value}`,
    ),
  ];

  if (input.brief.bottomLine) {
    lines.push("", `Bottom line: ${input.brief.bottomLine}`);
  }

  if (input.replayUrl) {
    lines.push("", `Receipts: ${input.replayUrl}`);
  }

  lines.push("", "Fresh trenches. Less bullshit.");

  return lines.join("\n");
}

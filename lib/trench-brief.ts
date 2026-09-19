import type { DevHistoryScan, EarlyBuyerScan, FundingTrace, TokenSnapshot } from "./types";

export type BriefTone = "good" | "neutral" | "warning" | "danger";
export type BriefSignal = { label: string; value: string; detail: string; tone: BriefTone };
export type TrenchBrief = { label: string; tone: BriefTone; signals: BriefSignal[]; bottomLine: string };

const pct = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;
const sumKnown = (values: Array<number | null>) => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
};

export function buildTrenchBrief(input: {
  snapshot: TokenSnapshot;
  earlyBuyers: EarlyBuyerScan | null;
  fundingTrace: FundingTrace | null;
  devHistory: DevHistoryScan | null;
  devBagPct: number | null;
}): TrenchBrief {
  const { snapshot, earlyBuyers, fundingTrace, devHistory, devBagPct } = input;
  const signals: BriefSignal[] = [];
  const top10 = snapshot.top10ExternalPct;

  if (top10 !== null) {
    signals.push({
      label: "TOP BAGS",
      value: pct(top10),
      detail: top10 >= 70
        ? "Top-heavy. A lot of the external float sits in a few hands."
        : top10 >= 52
          ? "Not instantly cooked, but the top bags deserve attention."
          : "This holder read is not screaming whale wall.",
      tone: top10 >= 70 ? "danger" : top10 >= 52 ? "warning" : "good",
    });
  }

  const earlyConcentration = earlyBuyers
    ? sumKnown(earlyBuyers.buyers.slice(0, 10).map((buyer) => buyer.supplyPct))
    : null;

  if (earlyBuyers && earlyConcentration !== null) {
    signals.push({
      label: earlyBuyers.historyComplete ? "EARLY CREW" : "EARLY WINDOW",
      value: pct(earlyConcentration),
      detail: earlyBuyers.historyComplete
        ? "Combined supply grabbed by the first decoded external wallets."
        : "Combined supply in our sampled early window; launch boundary was not reached.",
      tone: earlyConcentration >= 40 ? "danger" : earlyConcentration >= 25 ? "warning" : "neutral",
    });
  }

  const fastBuyers = earlyBuyers?.buyers.filter(
    (buyer) => buyer.secondsAfterLaunch !== null && buyer.secondsAfterLaunch <= 30,
  ).length ?? 0;

  if (fastBuyers) {
    signals.push({
      label: "FAST FRESHIES",
      value: String(fastBuyers),
      detail: `${fastBuyers} decoded wallet${fastBuyers === 1 ? "" : "s"} landed inside 30s of launch.`,
      tone: fastBuyers >= 5 ? "warning" : "neutral",
    });
  }

  const largestCluster = fundingTrace?.clusters[0] ?? null;

  if (fundingTrace) {
    signals.push(largestCluster ? {
      label: "SAME BANKROLL?",
      value: `${largestCluster.memberCount} WALLETS`,
      detail: "They share the same direct pre-launch SOL funder. Clue, not proof of common control.",
      tone: largestCluster.memberCount >= 4 ? "danger" : "warning",
    } : {
      label: "SAME BANKROLL?",
      value: "NO DIRECT CLUSTER",
      detail: "No shared direct SOL funder found in the wallets this pass could trace.",
      tone: "good",
    });
  } else {
    signals.push({
      label: "SAME BANKROLL?",
      value: "NOT CHECKED",
      detail: "Run the funding trace for the relationship layer.",
      tone: "neutral",
    });
  }

  if (devHistory) {
    const count = devHistory.priorLaunches.length;
    signals.push({
      label: "DEV BAGGAGE",
      value: count ? `${count} PRIOR CREATE${count === 1 ? "" : "S"}` : "NONE FOUND",
      detail: count
        ? "Prior Pump creates by this creator in the recent sampled wallet window."
        : "No prior Pump creates found in the recent 60-signature window; not proof the dev is new.",
      tone: count >= 4 ? "warning" : count > 0 ? "neutral" : "good",
    });
  } else {
    signals.push({
      label: "DEV BAGGAGE",
      value: "NOT CHECKED",
      detail: "Sample the creator wallet before calling the dev fresh.",
      tone: "neutral",
    });
  }

  if (devBagPct !== null) {
    signals.push({
      label: "DEV BAG",
      value: pct(devBagPct),
      detail: devBagPct >= 10
        ? "Creator still sits on a chunky share of total supply."
        : devBagPct >= 5
          ? "Creator bag is worth watching."
          : "Creator is visible in the sampled holders, but the bag is relatively light.",
      tone: devBagPct >= 10 ? "danger" : devBagPct >= 5 ? "warning" : "good",
    });
  }

  const dangers = signals.filter((signal) => signal.tone === "danger").length;
  const warnings = signals.filter((signal) => signal.tone === "warning").length;
  const complete = fundingTrace !== null && devHistory !== null;

  let label = "MORE RECEIPTS NEEDED";
  let tone: BriefTone = "neutral";
  if (dangers >= 2) { label = "MULTIPLE RED FLAGS"; tone = "danger"; }
  else if (dangers === 1 || warnings >= 2) { label = "KEEP BOTH EYES OPEN"; tone = "warning"; }
  else if (complete) { label = "NO BIG FLAG YET"; tone = "good"; }

  const bottom: string[] = [];
  if (top10 !== null) bottom.push(`Top 10 external bags sit at ${pct(top10)}.`);
  if (earlyConcentration !== null) bottom.push(`Decoded early wallets account for ${pct(earlyConcentration)} of supply in this read.`);
  if (largestCluster) bottom.push(`${largestCluster.memberCount} early wallets share one direct funder.`);
  if (devHistory?.priorLaunches.length) bottom.push(`Dev has ${devHistory.priorLaunches.length} prior Pump create${devHistory.priorLaunches.length === 1 ? "" : "s"} in the sampled window.`);
  if (!complete) bottom.push("Run Same Bankroll + Dev Baggage for the fuller read.");

  return { label, tone, signals, bottomLine: bottom.join(" ") };
}

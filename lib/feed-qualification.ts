export const FEED_QUALIFICATION_RULES = {
  minSampledExternalAccounts: 6,
  minEarlyBuyers: 4,
  devFloodLaunches: 4,
  devFloodWindowMs: 10 * 60 * 1000,
  watchingMaxAgeMs: 10 * 60 * 1000,
} as const;

export type FeedEvidence = {
  sampledExternalAccounts: number | null;
  earlyBuyerCount: number | null;
  top1ExternalPct: number | null;
  top10ExternalPct: number | null;
  coverage: "loading" | "ready" | "partial" | "blocked";
};

export type FeedQualificationState =
  | "qualified"
  | "watching"
  | "rpc-blocked"
  | "dev-flood";

export type FeedQualification = {
  state: FeedQualificationState;
  reasons: string[];
};

export function buildFeedQualification(input: {
  evidence: FeedEvidence | null;
  devLaunchesInWindow: number;
  replay?: boolean;
}): FeedQualification {
  const { evidence, devLaunchesInWindow, replay = false } = input;

  if (replay) {
    return {
      state: "qualified",
      reasons: ["verified replay receipt"],
    };
  }

  if (devLaunchesInWindow >= FEED_QUALIFICATION_RULES.devFloodLaunches) {
    return {
      state: "dev-flood",
      reasons: [
        `${devLaunchesInWindow} launches from this creator observed inside 10m`,
      ],
    };
  }

  if (!evidence || evidence.coverage === "loading") {
    return {
      state: "watching",
      reasons: ["qualification receipts still loading"],
    };
  }

  const reasons: string[] = [];
  const enoughAccounts =
    evidence.sampledExternalAccounts !== null &&
    evidence.sampledExternalAccounts >=
      FEED_QUALIFICATION_RULES.minSampledExternalAccounts;
  const enoughEarlyBuyers =
    evidence.earlyBuyerCount !== null &&
    evidence.earlyBuyerCount >= FEED_QUALIFICATION_RULES.minEarlyBuyers;

  if (evidence.sampledExternalAccounts !== null) {
    reasons.push(
      `${evidence.sampledExternalAccounts} sampled external accounts in bag map`,
    );
  }

  if (evidence.earlyBuyerCount !== null) {
    reasons.push(`${evidence.earlyBuyerCount} decoded early buyers`);
  }

  if (replay || (enoughAccounts && enoughEarlyBuyers)) {
    return {
      state: "qualified",
      reasons: replay ? ["verified replay receipt", ...reasons] : reasons,
    };
  }

  if (evidence.coverage === "blocked") {
    return {
      state: "rpc-blocked",
      reasons: reasons.length ? reasons : ["RPC blocked qualification evidence"],
    };
  }

  if (!enoughAccounts) {
    reasons.push(
      `needs ${FEED_QUALIFICATION_RULES.minSampledExternalAccounts}+ sampled external accounts`,
    );
  }

  if (!enoughEarlyBuyers) {
    reasons.push(
      `needs ${FEED_QUALIFICATION_RULES.minEarlyBuyers}+ decoded early buyers`,
    );
  }

  return {
    state: "watching",
    reasons,
  };
}

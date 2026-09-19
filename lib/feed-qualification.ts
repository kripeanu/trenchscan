export const FEED_QUALIFICATION_RULES = {
  minSampledExternalAccounts: 6,
  minEarlyBuyers: 4,
  maxQualifiedQuietMs: 2 * 60 * 1000,
  staleAfterMs: 10 * 60 * 1000,
  devFloodLaunches: 4,
  devFloodWindowMs: 10 * 60 * 1000,
  watchingMaxAgeMs: 10 * 60 * 1000,
} as const;

export type FeedEvidence = {
  sampledExternalAccounts: number | null;
  earlyBuyerCount: number | null;
  top1ExternalPct: number | null;
  top10ExternalPct: number | null;
  lastActivityAt: number | null;
  activityCoverage: "loading" | "ready" | "blocked";
  coverage: "loading" | "ready" | "partial" | "blocked";
};

export type FeedQualificationState =
  | "qualified"
  | "watching"
  | "rpc-blocked"
  | "dev-flood"
  | "stale";

export type FeedQualification = {
  state: FeedQualificationState;
  reasons: string[];
};

export function buildFeedQualification(input: {
  evidence: FeedEvidence | null;
  devLaunchesInWindow: number;
  now: number;
  replay?: boolean;
}): FeedQualification {
  const {
    evidence,
    devLaunchesInWindow,
    now,
    replay = false,
  } = input;

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

  const quietMs =
    evidence.activityCoverage === "ready" &&
    evidence.lastActivityAt !== null
      ? Math.max(0, now - evidence.lastActivityAt)
      : null;

  if (
    quietMs !== null &&
    quietMs > FEED_QUALIFICATION_RULES.staleAfterMs
  ) {
    return {
      state: "stale",
      reasons: [
        `pool/curve quiet for ${Math.floor(quietMs / 60_000)}m`,
      ],
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
  const recentActivity =
    quietMs !== null &&
    quietMs <= FEED_QUALIFICATION_RULES.maxQualifiedQuietMs;

  if (evidence.sampledExternalAccounts !== null) {
    reasons.push(
      `${evidence.sampledExternalAccounts} sampled external accounts in bag map`,
    );
  }

  if (evidence.earlyBuyerCount !== null) {
    reasons.push(`${evidence.earlyBuyerCount} decoded early buyers`);
  }

  if (quietMs !== null) {
    reasons.push(
      quietMs < 60_000
        ? `pool/curve activity ${Math.floor(quietMs / 1000)}s ago`
        : `pool/curve activity ${Math.floor(quietMs / 60_000)}m ago`,
    );
  } else if (evidence.activityCoverage === "blocked") {
    reasons.push("pool/curve activity receipt RPC-blocked");
  }

  if (enoughAccounts && enoughEarlyBuyers && recentActivity) {
    return {
      state: "qualified",
      reasons,
    };
  }

  if (
    evidence.coverage === "blocked" &&
    evidence.activityCoverage === "blocked"
  ) {
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

  if (!recentActivity) {
    reasons.push("needs pool/curve activity inside the last 2m");
  }

  return {
    state:
      evidence.coverage === "blocked" ? "rpc-blocked" : "watching",
    reasons,
  };
}

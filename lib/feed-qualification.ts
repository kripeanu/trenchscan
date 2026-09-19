export const FEED_QUALIFICATION_RULES = {
  minHolders: 10,
  minMarketCapUsd: 8_000,
  maxQualifiedQuietMs: 2 * 60 * 1000,
  staleAfterMs: 10 * 60 * 1000,
  devFloodLaunches: 4,
  devFloodWindowMs: 10 * 60 * 1000,
  instantPreviewMs: 12_000,
} as const;

export type FeedEvidence = {
  holders: number | null;
  holdersComplete: boolean;
  marketCapUsd: number | null;
  lastActivityAt: number | null;
  statsCoverage: "loading" | "ready" | "partial" | "unavailable";
  activityCoverage: "loading" | "ready" | "unavailable";
};

export type FeedQualificationState =
  | "checking"
  | "active"
  | "low-holders"
  | "low-market-cap"
  | "quiet"
  | "data-delayed"
  | "dev-spam"
  | "stale";

export type FeedQualification = {
  state: FeedQualificationState;
  reason: string;
};

export function buildFeedQualification(input: {
  evidence: FeedEvidence | null;
  devLaunchesInWindow: number;
  now: number;
  seenAt: number;
  replay?: boolean;
}): FeedQualification {
  const {
    evidence,
    devLaunchesInWindow,
    now,
    seenAt,
    replay = false,
  } = input;

  if (replay) {
    return {
      state: "active",
      reason: "Verified replay",
    };
  }

  if (devLaunchesInWindow >= FEED_QUALIFICATION_RULES.devFloodLaunches) {
    return {
      state: "dev-spam",
      reason: `${devLaunchesInWindow} launches from this dev in 10m`,
    };
  }

  if (!evidence || evidence.statsCoverage === "loading") {
    return {
      state: "checking",
      reason: "Checking holders and market cap…",
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
      reason: `No activity for ${Math.floor(quietMs / 60_000)}m`,
    };
  }

  if (
    evidence.statsCoverage === "unavailable" ||
    evidence.activityCoverage === "unavailable"
  ) {
    return {
      state: "data-delayed",
      reason: "Live launch found · detailed stats delayed",
    };
  }

  if (
    evidence.holders !== null &&
    evidence.holders < FEED_QUALIFICATION_RULES.minHolders
  ) {
    return {
      state: "low-holders",
      reason: `${evidence.holders} holders · needs ${FEED_QUALIFICATION_RULES.minHolders}+`,
    };
  }

  if (
    evidence.marketCapUsd !== null &&
    evidence.marketCapUsd < FEED_QUALIFICATION_RULES.minMarketCapUsd
  ) {
    return {
      state: "low-market-cap",
      reason: "Below the $8K market-cap filter",
    };
  }

  if (
    evidence.holders === null ||
    evidence.marketCapUsd === null ||
    quietMs === null
  ) {
    return {
      state: "data-delayed",
      reason: "Live launch found · detailed stats delayed",
    };
  }

  if (quietMs > FEED_QUALIFICATION_RULES.maxQualifiedQuietMs) {
    return {
      state: "quiet",
      reason: `Last activity ${Math.max(1, Math.floor(quietMs / 60_000))}m ago`,
    };
  }

  if (
    evidence.holders >= FEED_QUALIFICATION_RULES.minHolders &&
    evidence.marketCapUsd >= FEED_QUALIFICATION_RULES.minMarketCapUsd
  ) {
    return {
      state: "active",
      reason: "Passed the live filters",
    };
  }

  if (now - seenAt <= FEED_QUALIFICATION_RULES.instantPreviewMs) {
    return {
      state: "checking",
      reason: "New launch · checking…",
    };
  }

  return {
    state: "checking",
    reason: "Checking launch quality…",
  };
}

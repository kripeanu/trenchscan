import type { LaunchEnvelope, LaunchSource } from "./launch-source";
import type { StreamStatus } from "./types";

export type SourceStreamStatuses = Record<LaunchSource, StreamStatus>;

export type UnifiedStreamStatus = StreamStatus & {
  sources: SourceStreamStatuses;
};

export const INITIAL_SOURCE_STATUSES: SourceStreamStatuses = {
  "pump.fun": { state: "connecting" },
  "stonkfun.xyz": { state: "connecting" },
};

export function combineStreamStatuses(
  sources: SourceStreamStatuses,
): UnifiedStreamStatus {
  const rows = Object.values(sources);
  const liveCount = rows.filter((row) => row.state === "live").length;
  const errorCount = rows.filter((row) => row.state === "error").length;

  if (liveCount === rows.length) {
    return { state: "live", sources };
  }

  if (liveCount > 0) {
    return {
      state: "live",
      message: `${liveCount}/${rows.length} launch sources live`,
      sources,
    };
  }

  if (errorCount === rows.length) {
    return {
      state: "error",
      message: "All launch listeners are retrying.",
      sources,
    };
  }

  return {
    state: "connecting",
    message: errorCount
      ? "One launch listener is retrying."
      : "Connecting launch listeners…",
    sources,
  };
}

export function mergeLaunchEnvelopes(
  current: LaunchEnvelope[],
  incoming: LaunchEnvelope,
  limit = 80,
) {
  const key = `${incoming.source}:${incoming.id}`;
  const next = current.filter(
    (launch) => `${launch.source}:${launch.id}` !== key,
  );

  next.push(incoming);
  next.sort(
    (left, right) =>
      right.seenAt - left.seenAt || right.slot - left.slot,
  );

  return next.slice(0, limit);
}

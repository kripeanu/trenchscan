import type { DevHistoryScan } from "./types";

export type DevCadence = {
  launchBlockTime: number | null;
  priorCreatesWithTime: number;
  within1h: number;
  within24h: number;
  within7d: number;
  shortestGapSeconds: number | null;
  newestPriorAgeSeconds: number | null;
};

export function buildDevCadence(
  history: DevHistoryScan | null,
  currentLaunchBlockTime: number | null,
): DevCadence | null {
  if (!history) return null;

  const timed = history.priorLaunches
    .map((launch) => launch.blockTime)
    .filter((value): value is number => value !== null)
    .sort((a, b) => b - a);

  const ages =
    currentLaunchBlockTime === null
      ? []
      : timed
          .map((blockTime) => currentLaunchBlockTime - blockTime)
          .filter((age) => age >= 0);

  const allTimes =
    currentLaunchBlockTime === null
      ? timed
      : [currentLaunchBlockTime, ...timed].sort((a, b) => b - a);

  let shortestGapSeconds: number | null = null;
  for (let index = 0; index < allTimes.length - 1; index += 1) {
    const gap = Math.max(0, allTimes[index] - allTimes[index + 1]);
    shortestGapSeconds =
      shortestGapSeconds === null ? gap : Math.min(shortestGapSeconds, gap);
  }

  return {
    launchBlockTime: currentLaunchBlockTime,
    priorCreatesWithTime: timed.length,
    within1h: ages.filter((age) => age <= 3_600).length,
    within24h: ages.filter((age) => age <= 86_400).length,
    within7d: ages.filter((age) => age <= 604_800).length,
    shortestGapSeconds,
    newestPriorAgeSeconds: ages.length ? Math.min(...ages) : null,
  };
}

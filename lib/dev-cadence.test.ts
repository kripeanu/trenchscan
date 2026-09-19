import { describe, expect, it } from "vitest";
import { buildDevCadence } from "./dev-cadence";
import type { DevHistoryScan } from "./types";

function history(times: Array<number | null>): DevHistoryScan {
  return {
    creator: "creator",
    sampledAt: 1,
    signaturesSampled: 60,
    transactionsParsed: 60,
    oldestSampledBlockTime: 1,
    priorLaunches: times.map((blockTime, index) => ({
      signature: `sig-${index}`,
      slot: index,
      blockTime,
      name: `Token ${index}`,
      symbol: `T${index}`,
      mint: `mint-${index}`,
      isMayhemMode: false,
    })),
  };
}

describe("buildDevCadence", () => {
  it("counts recent prior creates relative to the current launch", () => {
    const current = 1_000_000;
    const cadence = buildDevCadence(
      history([
        current - 600,
        current - 3_000,
        current - 20_000,
        current - 100_000,
      ]),
      current,
    );

    expect(cadence?.within1h).toBe(2);
    expect(cadence?.within24h).toBe(3);
    expect(cadence?.within7d).toBe(4);
    expect(cadence?.newestPriorAgeSeconds).toBe(600);
  });

  it("finds the shortest gap without inventing missing timestamps", () => {
    const cadence = buildDevCadence(
      history([9_900, null, 9_700]),
      10_000,
    );

    expect(cadence?.priorCreatesWithTime).toBe(2);
    expect(cadence?.shortestGapSeconds).toBe(100);
  });

  it("keeps cadence counts empty when current launch time is unavailable", () => {
    const cadence = buildDevCadence(history([100, 200]), null);

    expect(cadence?.within1h).toBe(0);
    expect(cadence?.within24h).toBe(0);
    expect(cadence?.newestPriorAgeSeconds).toBeNull();
  });
});

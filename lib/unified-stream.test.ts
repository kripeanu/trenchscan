import { describe, expect, it } from "vitest";
import {
  combineStreamStatuses,
  mergeLaunchEnvelopes,
} from "./unified-stream";
import type { LaunchEnvelope } from "./launch-source";

function envelope(
  id: string,
  source: LaunchEnvelope["source"],
  seenAt: number,
): LaunchEnvelope {
  return {
    id,
    signature: `${id}-signature`,
    slot: seenAt,
    seenAt,
    source,
    name: id,
    symbol: id.toUpperCase(),
    uri: null,
    mint: `${id}-mint`,
    creator: `${id}-creator`,
    payer: null,
    venue:
      source === "pump.fun"
        ? {
            kind: "pump",
            bondingCurve: `${id}-curve`,
            associatedBondingCurve: `${id}-curve-ata`,
            mayhemMode: false,
            holderReward: null,
          }
        : {
            kind: "raydium-launchlab",
            poolState: `${id}-pool`,
            platformConfig: `${id}-platform`,
            baseVault: `${id}-base-vault`,
            quoteVault: `${id}-quote-vault`,
            quoteMint: `${id}-quote-mint`,
            variant: "initialize_v2",
            rewardMode: false,
          },
  };
}

describe("unified launch stream", () => {
  it("keeps launches from both sources in global newest-first order", () => {
    const pump = envelope("pump", "pump.fun", 10);
    const stonk = envelope("stonk", "stonkfun.xyz", 20);

    expect(mergeLaunchEnvelopes([pump], stonk)).toEqual([stonk, pump]);
  });

  it("replaces duplicate source/id rows instead of growing the feed", () => {
    const first = envelope("same", "pump.fun", 10);
    const refreshed = envelope("same", "pump.fun", 30);

    expect(mergeLaunchEnvelopes([first], refreshed)).toEqual([refreshed]);
  });

  it("stays live when one source is live and the other is retrying", () => {
    const status = combineStreamStatuses({
      "pump.fun": { state: "live" },
      "stonkfun.xyz": { state: "error" },
    });

    expect(status.state).toBe("live");
    expect(status.message).toBe("1/2 launch sources live");
  });
});

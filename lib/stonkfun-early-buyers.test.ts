import bs58 from "bs58";
import {
  PublicKey,
  type PartiallyDecodedInstruction,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  decodeStonkFunBuyInstruction,
  positiveBalanceDeltaForOwner,
} from "./stonkfun-early-buyers";
import {
  RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  STONKFUN_REWARD_PLATFORM_CONFIG,
} from "./stonkfun";

const BUY_EXACT_IN = Uint8Array.from([
  250, 234, 13, 123, 213, 156, 19, 236,
]);
const BUY_EXACT_OUT = Uint8Array.from([
  24, 211, 116, 40, 105, 3, 153, 56,
]);

function key(byte: number) {
  return new PublicKey(
    Uint8Array.from({ length: 32 }, () => byte),
  );
}

const launch = {
  poolState: key(5).toBase58(),
  platformConfig: STONKFUN_REWARD_PLATFORM_CONFIG.toBase58(),
  mint: key(10).toBase58(),
  baseVault: key(8).toBase58(),
};

function buyInstruction(
  discriminator: Uint8Array,
): PartiallyDecodedInstruction {
  const accounts = Array.from(
    { length: 11 },
    (_, index) => key(index + 1),
  );

  accounts[3] = STONKFUN_REWARD_PLATFORM_CONFIG;
  accounts[4] = new PublicKey(launch.poolState);
  accounts[7] = new PublicKey(launch.baseVault);
  accounts[9] = new PublicKey(launch.mint);

  return {
    programId: RAYDIUM_LAUNCHLAB_PROGRAM_ID,
    accounts,
    data: bs58.encode(
      Uint8Array.from([...discriminator, 0, 0, 0]),
    ),
  };
}

describe("decodeStonkFunBuyInstruction", () => {
  it("verifies buy_exact_in against the exact launch accounts", () => {
    const buy = decodeStonkFunBuyInstruction(
      buyInstruction(BUY_EXACT_IN),
      launch,
    );

    expect(buy?.variant).toBe("buy_exact_in");
    expect(buy?.poolState).toBe(launch.poolState);
    expect(buy?.platformConfig).toBe(launch.platformConfig);
    expect(buy?.baseVault).toBe(launch.baseVault);
    expect(buy?.baseMint).toBe(launch.mint);
  });

  it("supports buy_exact_out", () => {
    const buy = decodeStonkFunBuyInstruction(
      buyInstruction(BUY_EXACT_OUT),
      launch,
    );

    expect(buy?.variant).toBe("buy_exact_out");
  });

  it("rejects a buy from another LaunchLab pool", () => {
    const candidate = buyInstruction(BUY_EXACT_IN);
    candidate.accounts[4] = key(99);

    expect(
      decodeStonkFunBuyInstruction(candidate, launch),
    ).toBeNull();
  });

  it("rejects a buy from another LaunchLab platform", () => {
    const candidate = buyInstruction(BUY_EXACT_IN);
    candidate.accounts[3] = key(98);

    expect(
      decodeStonkFunBuyInstruction(candidate, launch),
    ).toBeNull();
  });
});

describe("positiveBalanceDeltaForOwner", () => {
  const mint = key(44).toBase58();
  const owner = key(45).toBase58();

  it("returns only a positive base-token delta for the payer", () => {
    const delta = positiveBalanceDeltaForOwner(
      [{
        mint,
        owner,
        uiTokenAmount: { amount: "100" },
      }],
      [{
        mint,
        owner,
        uiTokenAmount: { amount: "350" },
      }],
      mint,
      owner,
    );

    expect(delta).toBe(250n);
  });

  it("returns null when the payer did not gain the token", () => {
    const delta = positiveBalanceDeltaForOwner(
      [{
        mint,
        owner,
        uiTokenAmount: { amount: "350" },
      }],
      [{
        mint,
        owner,
        uiTokenAmount: { amount: "100" },
      }],
      mint,
      owner,
    );

    expect(delta).toBeNull();
  });

  it("ignores balances from another mint", () => {
    const delta = positiveBalanceDeltaForOwner(
      [],
      [{
        mint: key(46).toBase58(),
        owner,
        uiTokenAmount: { amount: "999" },
      }],
      mint,
      owner,
    );

    expect(delta).toBeNull();
  });
});

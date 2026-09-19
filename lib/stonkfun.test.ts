import bs58 from "bs58";
import { PublicKey, type PartiallyDecodedInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  decodeStonkFunInitializeInstruction,
  RAYDIUM_LAUNCHLAB_PROGRAM_ID,
  STONKFUN_REWARD_PLATFORM_CONFIG,
  STONKFUN_STANDARD_PLATFORM_CONFIG,
  looksLikeStonkFunInitialize,
} from "./stonkfun";

const INIT_V2 = Uint8Array.from([67, 153, 175, 39, 218, 16, 38, 32]);
const INIT_TOKEN_2022 = Uint8Array.from([37, 190, 126, 222, 44, 154, 171, 17]);

function key(byte: number) {
  return new PublicKey(Uint8Array.from({ length: 32 }, () => byte));
}

function borshString(value: string) {
  const encoded = new TextEncoder().encode(value);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, encoded.length, true);
  return Uint8Array.from([...length, ...encoded]);
}

function data(
  discriminator: Uint8Array,
  decimals = 6,
  name = "Stonk Coin",
  symbol = "STONK",
  uri = "https://example.com/meta.json",
) {
  return bs58.encode(
    Uint8Array.from([
      ...discriminator,
      decimals,
      ...borshString(name),
      ...borshString(symbol),
      ...borshString(uri),
      // The decoder intentionally stops after MintParams. Remaining LaunchLab
      // initialize args are source-specific evidence for later adapters.
      0,
    ]),
  );
}

function instruction(
  platformConfig: PublicKey,
  encodedData: string,
): PartiallyDecodedInstruction {
  const accounts = Array.from({ length: 12 }, (_, index) => key(index + 1));
  accounts[3] = platformConfig;

  return {
    programId: RAYDIUM_LAUNCHLAB_PROGRAM_ID,
    accounts,
    data: encodedData,
  };
}

describe("StonkFun LaunchLab adapter", () => {
  it("decodes a standard initialize_v2 launch", () => {
    const row = decodeStonkFunInitializeInstruction(
      instruction(STONKFUN_STANDARD_PLATFORM_CONFIG, data(INIT_V2)),
      "signature",
      123,
      456,
    );

    expect(row).not.toBeNull();
    expect(row?.source).toBe("stonkfun.xyz");
    expect(row?.variant).toBe("initialize_v2");
    expect(row?.rewardMode).toBe(false);
    expect(row?.decimals).toBe(6);
    expect(row?.name).toBe("Stonk Coin");
    expect(row?.symbol).toBe("STONK");
    expect(row?.poolState).toBe(key(6).toBase58());
    expect(row?.mint).toBe(key(7).toBase58());
    expect(row?.quoteMint).toBe(key(8).toBase58());
  });

  it("decodes the Token-2022 reward-launch cohort", () => {
    const row = decodeStonkFunInitializeInstruction(
      instruction(
        STONKFUN_REWARD_PLATFORM_CONFIG,
        data(INIT_TOKEN_2022, 9, "Reward Stonk", "RSTONK"),
      ),
      "signature-2",
      999,
    );

    expect(row?.variant).toBe("initialize_with_token_2022");
    expect(row?.rewardMode).toBe(true);
    expect(row?.decimals).toBe(9);
    expect(row?.symbol).toBe("RSTONK");
  });

  it("does not mislabel another LaunchLab platform as StonkFun", () => {
    const row = decodeStonkFunInitializeInstruction(
      instruction(key(99), data(INIT_V2)),
      "signature-3",
      1,
    );

    expect(row).toBeNull();
  });

  it("rejects unrelated LaunchLab instructions", () => {
    const row = decodeStonkFunInitializeInstruction(
      instruction(
        STONKFUN_STANDARD_PLATFORM_CONFIG,
        data(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])),
      ),
      "signature-4",
      1,
    );

    expect(row).toBeNull();
  });

  it("rejects the right platform config under the wrong program", () => {
    const candidate = instruction(
      STONKFUN_STANDARD_PLATFORM_CONFIG,
      data(INIT_V2),
    );
    candidate.programId = key(77);

    expect(
      decodeStonkFunInitializeInstruction(candidate, "signature-5", 1),
    ).toBeNull();
  });
});


describe("looksLikeStonkFunInitialize", () => {
  it("accepts the two LaunchLab initialize log names", () => {
    expect(
      looksLikeStonkFunInitialize([
        "Program log: Instruction: InitializeV2",
      ]),
    ).toBe(true);
    expect(
      looksLikeStonkFunInitialize([
        "Program log: Instruction: InitializeWithToken2022",
      ]),
    ).toBe(true);
  });

  it("does not wake the decoder for LaunchLab swaps", () => {
    expect(
      looksLikeStonkFunInitialize([
        "Program log: Instruction: BuyExactIn",
        "Program log: Instruction: SellExactIn",
      ]),
    ).toBe(false);
  });
});

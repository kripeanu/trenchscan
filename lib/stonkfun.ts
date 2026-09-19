import bs58 from "bs58";
import {
  PublicKey,
  type PartiallyDecodedInstruction,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";

export const RAYDIUM_LAUNCHLAB_PROGRAM_ID = new PublicKey(
  "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
);

export const STONKFUN_STANDARD_PLATFORM_CONFIG = new PublicKey(
  "4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7",
);

export const STONKFUN_REWARD_PLATFORM_CONFIG = new PublicKey(
  "6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt",
);

const INITIALIZE_V2_DISCRIMINATOR = Uint8Array.from([
  67, 153, 175, 39, 218, 16, 38, 32,
]);

const INITIALIZE_WITH_TOKEN_2022_DISCRIMINATOR = Uint8Array.from([
  37, 190, 126, 222, 44, 154, 171, 17,
]);

export type StonkFunLaunchVariant =
  | "initialize_v2"
  | "initialize_with_token_2022";

export type StonkFunLaunch = {
  id: string;
  signature: string;
  slot: number;
  seenAt: number;
  source: "stonkfun.xyz";
  variant: StonkFunLaunchVariant;
  rewardMode: boolean;
  decimals: number;
  name: string;
  symbol: string;
  uri: string | null;
  payer: string;
  creator: string;
  globalConfig: string;
  platformConfig: string;
  authority: string;
  poolState: string;
  mint: string;
  quoteMint: string;
  baseVault: string;
  quoteVault: string;
  baseTokenProgram: string;
  quoteTokenProgram: string;
};

function isPartiallyDecoded(
  instruction: ParsedInstruction | PartiallyDecodedInstruction,
): instruction is PartiallyDecodedInstruction {
  return "data" in instruction && "accounts" in instruction;
}

function hasDiscriminator(bytes: Uint8Array, discriminator: Uint8Array) {
  if (bytes.length < discriminator.length) return false;

  for (let index = 0; index < discriminator.length; index += 1) {
    if (bytes[index] !== discriminator[index]) return false;
  }

  return true;
}

class Cursor {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  skip(length: number) {
    this.require(length);
    this.offset += length;
  }

  readU8() {
    this.require(1);
    return this.bytes[this.offset++];
  }

  readU32Le() {
    this.require(4);
    const value =
      this.bytes[this.offset] |
      (this.bytes[this.offset + 1] << 8) |
      (this.bytes[this.offset + 2] << 16) |
      (this.bytes[this.offset + 3] << 24);

    this.offset += 4;
    return value >>> 0;
  }

  readString(maxBytes: number) {
    const length = this.readU32Le();

    if (length > maxBytes) {
      throw new Error(
        `LaunchLab string length ${length} exceeds expected maximum`,
      );
    }

    this.require(length);
    const value = new TextDecoder().decode(
      this.bytes.subarray(this.offset, this.offset + length),
    );
    this.offset += length;
    return value;
  }

  private require(length: number) {
    if (this.offset + length > this.bytes.length) {
      throw new Error(
        "LaunchLab initialize instruction ended before MintParams were decoded",
      );
    }
  }
}

function launchVariant(bytes: Uint8Array): StonkFunLaunchVariant | null {
  if (hasDiscriminator(bytes, INITIALIZE_V2_DISCRIMINATOR)) {
    return "initialize_v2";
  }

  if (hasDiscriminator(bytes, INITIALIZE_WITH_TOKEN_2022_DISCRIMINATOR)) {
    return "initialize_with_token_2022";
  }

  return null;
}

function decodeMintParams(bytes: Uint8Array) {
  const variant = launchVariant(bytes);
  if (!variant) return null;

  const cursor = new Cursor(bytes);
  cursor.skip(8);

  // Official Raydium LaunchLab IDL:
  // MintParams { u8 decimals, String name, String symbol, String uri }.
  const decimals = cursor.readU8();
  const name = cursor.readString(128);
  const symbol = cursor.readString(64);
  const uri = cursor.readString(1024);

  return {
    variant,
    decimals,
    name,
    symbol,
    uri,
  };
}

function stonkFunMode(platformConfig: PublicKey) {
  if (platformConfig.equals(STONKFUN_STANDARD_PLATFORM_CONFIG)) {
    return { rewardMode: false };
  }

  if (platformConfig.equals(STONKFUN_REWARD_PLATFORM_CONFIG)) {
    return { rewardMode: true };
  }

  return null;
}

/**
 * Decodes only Raydium LaunchLab initialize instructions whose platform_config
 * is one of StonkFun's known on-chain configs.
 *
 * That second check matters: LaunchLab is shared infrastructure, so a matching
 * LaunchLab program instruction alone is not enough to call a launch StonkFun.
 */
export function decodeStonkFunInitializeInstruction(
  instruction: PartiallyDecodedInstruction,
  signature: string,
  slot: number,
  seenAt = Date.now(),
): StonkFunLaunch | null {
  if (!instruction.programId.equals(RAYDIUM_LAUNCHLAB_PROGRAM_ID)) return null;

  // Both initialize_v2 and initialize_with_token_2022 share these first
  // twelve documented accounts.
  if (instruction.accounts.length < 12) return null;

  const platformConfig = instruction.accounts[3];
  const mode = stonkFunMode(platformConfig);
  if (!mode) return null;

  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(instruction.data);
  } catch {
    return null;
  }

  let mintParams: ReturnType<typeof decodeMintParams>;
  try {
    mintParams = decodeMintParams(bytes);
  } catch {
    return null;
  }

  if (!mintParams) return null;

  return {
    id: signature,
    signature,
    slot,
    seenAt,
    source: "stonkfun.xyz",
    variant: mintParams.variant,
    rewardMode: mode.rewardMode,
    decimals: mintParams.decimals,
    name: mintParams.name || "Unnamed",
    symbol: mintParams.symbol || "???",
    uri: mintParams.uri || null,
    payer: instruction.accounts[0].toBase58(),
    creator: instruction.accounts[1].toBase58(),
    globalConfig: instruction.accounts[2].toBase58(),
    platformConfig: platformConfig.toBase58(),
    authority: instruction.accounts[4].toBase58(),
    poolState: instruction.accounts[5].toBase58(),
    mint: instruction.accounts[6].toBase58(),
    quoteMint: instruction.accounts[7].toBase58(),
    baseVault: instruction.accounts[8].toBase58(),
    quoteVault: instruction.accounts[9].toBase58(),
    baseTokenProgram: instruction.accounts[10].toBase58(),
    quoteTokenProgram: instruction.accounts[11].toBase58(),
  };
}

export function decodeStonkFunLaunchFromTransaction(
  transaction: ParsedTransactionWithMeta,
  signature: string,
  slot: number,
  seenAt = Date.now(),
): StonkFunLaunch | null {
  if (transaction.meta?.err) return null;

  const instructions: Array<ParsedInstruction | PartiallyDecodedInstruction> = [
    ...transaction.transaction.message.instructions,
    ...(transaction.meta?.innerInstructions?.flatMap(
      (group) => group.instructions,
    ) ?? []),
  ];

  for (const instruction of instructions) {
    if (!isPartiallyDecoded(instruction)) continue;

    const launch = decodeStonkFunInitializeInstruction(
      instruction,
      signature,
      slot,
      seenAt,
    );

    if (launch) return launch;
  }

  return null;
}


export function looksLikeStonkFunInitialize(logs: readonly string[]) {
  return logs.some((line) =>
    /Instruction:\s*Initialize(?:V2|WithToken2022)\b/i.test(line),
  );
}

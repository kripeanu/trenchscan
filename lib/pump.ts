import bs58 from "bs58";
import {
  Connection,
  PublicKey,
  type PartiallyDecodedInstruction,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import type { Launch } from "@/lib/types";
import { MAX_SUPPORTED_TRANSACTION_VERSION, withRpcRetry } from "@/lib/rpc";

export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

// Official Pump create_v2 discriminator from pump-public-docs/idl/pump.json.
const CREATE_V2_DISCRIMINATOR = Uint8Array.from([
  214, 144, 76, 236, 95, 139, 49, 180,
]);

export function createSolanaConnection() {
  const endpoint =
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const wsEndpoint = process.env.SOLANA_WS_URL || undefined;

  return new Connection(endpoint, {
    commitment: "confirmed",
    wsEndpoint,
  });
}

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
      throw new Error(`Pump string length ${length} exceeds expected maximum`);
    }

    this.require(length);
    const value = new TextDecoder().decode(
      this.bytes.subarray(this.offset, this.offset + length),
    );
    this.offset += length;
    return value;
  }

  readPublicKey() {
    this.require(32);
    const value = new PublicKey(
      this.bytes.subarray(this.offset, this.offset + 32),
    );
    this.offset += 32;
    return value;
  }

  private require(length: number) {
    if (this.offset + length > this.bytes.length) {
      throw new Error("Pump instruction ended before expected fields were decoded");
    }
  }
}

function decodeCreateV2Data(bytes: Uint8Array) {
  if (!hasDiscriminator(bytes, CREATE_V2_DISCRIMINATOR)) return null;

  const cursor = new Cursor(bytes);
  cursor.skip(CREATE_V2_DISCRIMINATOR.length);

  // Borsh layout documented by Pump:
  // String name, String symbol, String uri, Pubkey creator, bool is_mayhem_mode.
  const name = cursor.readString(128);
  const symbol = cursor.readString(64);
  const uri = cursor.readString(1024);
  const creator = cursor.readPublicKey();
  const isMayhemMode = cursor.readU8() !== 0;

  return { name, symbol, uri, creator, isMayhemMode };
}

/**
 * Decodes only fields TrenchScan can prove from Pump's public create_v2 layout.
 * No heuristics or AI are involved in launch detection.
 */
export function decodeLaunchFromTransaction(
  transaction: ParsedTransactionWithMeta,
  signature: string,
  slot: number,
  seenAt = Date.now(),
): Launch | null {
  if (transaction.meta?.err) return null;

  const instructions: Array<ParsedInstruction | PartiallyDecodedInstruction> = [
    ...transaction.transaction.message.instructions,
    ...(transaction.meta?.innerInstructions?.flatMap(
      (group) => group.instructions,
    ) ?? []),
  ];

  for (const instruction of instructions) {
    if (!isPartiallyDecoded(instruction)) continue;
    if (!instruction.programId.equals(PUMP_PROGRAM_ID)) continue;
    if (instruction.accounts.length < 6) continue;

    let bytes: Uint8Array;
    try {
      bytes = bs58.decode(instruction.data);
    } catch {
      continue;
    }

    let decoded: ReturnType<typeof decodeCreateV2Data>;
    try {
      decoded = decodeCreateV2Data(bytes);
    } catch (error) {
      console.warn(
        "[trenchscan] create_v2 matched but payload could not be decoded",
        signature,
        error,
      );
      continue;
    }

    if (!decoded) continue;

    return {
      id: signature,
      signature,
      slot,
      seenAt,
      name: decoded.name || "Unnamed",
      symbol: decoded.symbol || "???",
      uri: decoded.uri || null,
      mint: instruction.accounts[0].toBase58(),
      creator: decoded.creator.toBase58(),
      payer: instruction.accounts[5].toBase58(),
      bondingCurve: instruction.accounts[2].toBase58(),
      associatedBondingCurve: instruction.accounts[3].toBase58(),
      source: "pump.fun",
      isMayhemMode: decoded.isMayhemMode,
      // Pump's trailing optional holder-reward field is intentionally left
      // unknown until we add a decoder for every optional field before it.
      isHolderReward: null,
    };
  }

  return null;
}

export async function decodeLaunch(
  connection: Connection,
  signature: string,
  slot: number,
): Promise<Launch | null> {
  const transaction = await withRpcRetry(() =>
    connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
    }),
  );

  if (!transaction) return null;
  return decodeLaunchFromTransaction(transaction, signature, slot);
}

export function looksLikeCreate(logs: readonly string[]) {
  return logs.some((line) => /Instruction:\s*CreateV2\b/i.test(line));
}

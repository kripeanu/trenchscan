import { OnlinePumpSdk } from "@pump-fun/pump-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import type { Launch } from "@/lib/types";

export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

export function createSolanaConnection() {
  const endpoint =
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const wsEndpoint = process.env.SOLANA_WS_URL || undefined;

  return new Connection(endpoint, {
    commitment: "confirmed",
    wsEndpoint,
  });
}

export function createPumpSdk(connection: Connection) {
  return new OnlinePumpSdk(connection);
}

function publicKeyString(value: unknown): string | null {
  if (typeof value === "string") return value;

  if (
    value &&
    typeof value === "object" &&
    "toBase58" in value &&
    typeof (value as { toBase58?: unknown }).toBase58 === "function"
  ) {
    return (value as { toBase58: () => string }).toBase58();
  }

  return null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

type PumpEventLike = {
  type?: string;
  data?: Record<string, unknown>;
};

/**
 * Turns a confirmed Pump transaction into the small, boring data model that the
 * UI needs. We intentionally do not invent a score here: if the chain did not
 * tell us something, TrenchScan does not pretend it knows it.
 */
export async function decodeLaunch(
  sdk: OnlinePumpSdk,
  signature: string,
  slot: number,
): Promise<Launch | null> {
  const events = (await sdk.parseTransactionEvents(
    signature,
    "confirmed",
  )) as PumpEventLike[];

  // SDK versions use a discriminated union. Accept both labels so an upstream
  // naming change does not silently kill the feed.
  const event = events.find(
    (candidate) =>
      candidate.type === "create" || candidate.type === "createEvent",
  );

  if (!event?.data) return null;

  const data = event.data;
  const mint = publicKeyString(data.mint);
  const payer = publicKeyString(data.user);
  const creator = publicKeyString(data.creator) ?? payer;

  if (!mint || !creator) return null;

  return {
    id: signature,
    signature,
    slot,
    seenAt: Date.now(),
    name: typeof data.name === "string" ? data.name : "Unnamed",
    symbol: typeof data.symbol === "string" ? data.symbol : "???",
    uri: typeof data.uri === "string" ? data.uri : null,
    mint,
    creator,
    payer,
    source: "pump.fun",
    isMayhemMode: nullableBoolean(data.isMayhemMode ?? data.is_mayhem_mode),
    isHolderReward: nullableBoolean(
      data.isHolderReward ?? data.is_holder_reward,
    ),
  };
}

export function looksLikeCreate(logs: readonly string[]) {
  return logs.some((line) =>
    /Instruction:\s*Create(?:V2|V3)?\b/i.test(line),
  );
}

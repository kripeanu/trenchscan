import { PublicKey } from "@solana/web3.js";
import { buildEarlyRetentionScan } from "@/lib/early-retention";
import { createSolanaConnection } from "@/lib/pump";
import type { EarlyRetentionInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RetentionRequest = {
  mint?: unknown;
  buyers?: unknown;
};

function parseBuyer(value: unknown): EarlyRetentionInput | null {
  if (!value || typeof value !== "object") return null;

  const row = value as Record<string, unknown>;
  if (typeof row.wallet !== "string" || typeof row.rawFirstBuy !== "string") {
    return null;
  }

  try {
    new PublicKey(row.wallet);
    const amount = BigInt(row.rawFirstBuy);
    if (amount <= 0n) return null;
  } catch {
    return null;
  }

  return {
    wallet: row.wallet,
    rawFirstBuy: row.rawFirstBuy,
  };
}

export async function POST(request: Request) {
  let body: RetentionRequest;

  try {
    body = (await request.json()) as RetentionRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.mint !== "string") {
    return Response.json({ error: "Invalid mint" }, { status: 400 });
  }

  try {
    new PublicKey(body.mint);
  } catch {
    return Response.json({ error: "Invalid mint" }, { status: 400 });
  }

  const buyers = Array.isArray(body.buyers)
    ? body.buyers
        .map(parseBuyer)
        .filter((buyer): buyer is EarlyRetentionInput => buyer !== null)
    : [];

  if (!buyers.length || buyers.length > 12) {
    return Response.json(
      { error: "Invalid early-buyer evidence" },
      { status: 400 },
    );
  }

  try {
    const scan = await buildEarlyRetentionScan(
      createSolanaConnection(),
      body.mint,
      buyers,
    );

    return Response.json(scan, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[trenchscan] early retention scan failed", body.mint, error);
    return Response.json(
      { error: "Could not read current early-buyer balances from Solana RPC" },
      { status: 502 },
    );
  }
}

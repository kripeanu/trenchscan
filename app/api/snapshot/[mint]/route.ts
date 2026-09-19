import { PublicKey } from "@solana/web3.js";
import { createSolanaConnection } from "@/lib/pump";
import { buildTokenSnapshot } from "@/lib/snapshot";
import { getEvidenceCache } from "@/lib/evidence-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ mint: string }> },
) {
  const { mint } = await context.params;

  try {
    // Fail fast with a 400 instead of handing malformed user input to RPC.
    new PublicKey(mint);
  } catch {
    return Response.json({ error: "Invalid Solana mint" }, { status: 400 });
  }

  try {
    const cached = await getEvidenceCache().getOrLoad(
      `snapshot:${mint}`,
      5_000,
      () => buildTokenSnapshot(createSolanaConnection(), mint),
    );
    return Response.json(cached.value, {
      headers: {
        "Cache-Control": "public, max-age=2, stale-while-revalidate=8",
        "X-TrenchScan-Cache": cached.status,
      },
    });
  } catch (error) {
    console.error("[trenchscan] snapshot failed", mint, error);
    return Response.json(
      { error: "Could not read token state from Solana RPC" },
      { status: 502 },
    );
  }
}

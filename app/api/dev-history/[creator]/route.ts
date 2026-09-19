import { PublicKey } from "@solana/web3.js";
import { buildDevHistoryScan } from "@/lib/dev-history";
import { createSolanaConnection } from "@/lib/pump";
import { getEvidenceCache } from "@/lib/evidence-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ creator: string }> },
) {
  const { creator } = await context.params;
  const { searchParams } = new URL(request.url);
  const before = searchParams.get("before");

  try {
    new PublicKey(creator);
    if (!before || before.length < 60) {
      throw new Error("bad boundary");
    }
  } catch {
    return Response.json(
      { error: "Invalid creator or launch signature" },
      { status: 400 },
    );
  }

  try {
    const cached = await getEvidenceCache().getOrLoad(
      `dev:${creator}:${before}`,
      60_000,
      () =>
        buildDevHistoryScan(
          createSolanaConnection(),
          creator,
          before,
        ),
    );

    return Response.json(cached.value, {
      headers: {
        "Cache-Control": "public, max-age=10, stale-while-revalidate=30",
        "X-TrenchScan-Cache": cached.status,
      },
    });
  } catch (error) {
    console.error("[trenchscan] dev history scan failed", creator, error);
    return Response.json(
      { error: "Could not sample creator history from Solana RPC" },
      { status: 502 },
    );
  }
}

import { PublicKey } from "@solana/web3.js";
import { buildEarlyBuyerScan } from "@/lib/early-buyers";
import { createSolanaConnection } from "@/lib/pump";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ mint: string }> },
) {
  const { mint } = await context.params;
  const { searchParams } = new URL(request.url);
  const slotParam = searchParams.get("fromSlot");
  const creatorParam = searchParams.get("creator");

  let fromSlot: number;

  try {
    new PublicKey(mint);
    if (creatorParam) new PublicKey(creatorParam);

    fromSlot = Number(slotParam);
    if (!Number.isSafeInteger(fromSlot) || fromSlot <= 0) {
      throw new Error("bad slot");
    }
  } catch {
    return Response.json(
      { error: "Invalid mint, creator, or launch slot" },
      { status: 400 },
    );
  }

  try {
    const scan = await buildEarlyBuyerScan(
      createSolanaConnection(),
      mint,
      fromSlot,
      creatorParam,
    );

    return Response.json(scan, {
      headers: {
        "Cache-Control": "public, max-age=3, stale-while-revalidate=12",
      },
    });
  } catch (error) {
    console.error("[trenchscan] early-buyer scan failed", mint, fromSlot, error);
    return Response.json(
      { error: "Could not replay early curve activity from Solana RPC" },
      { status: 502 },
    );
  }
}

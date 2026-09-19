import bs58 from "bs58";
import { getEvidenceCache } from "@/lib/evidence-cache";
import { createSolanaConnection } from "@/lib/pump";
import { buildStonkFunEarlyBuyerScan } from "@/lib/stonkfun-early-buyers";
import { loadStonkFunReplayBySignature } from "@/lib/stonkfun-replay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validSignature(signature: string) {
  try {
    return bs58.decode(signature).length === 64;
  } catch {
    return false;
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ signature: string }> },
) {
  const { signature } = await context.params;

  if (!validSignature(signature)) {
    return Response.json(
      { error: "Invalid Solana transaction signature" },
      { status: 400 },
    );
  }

  try {
    const cached = await getEvidenceCache().getOrLoad(
      `stonkfun-early:${signature}`,
      8_000,
      async () => {
        const connection = createSolanaConnection();
        const replay = await loadStonkFunReplayBySignature(
          connection,
          signature,
        );

        if (!replay) return null;

        return buildStonkFunEarlyBuyerScan(
          connection,
          replay.launch,
          replay.launchBlockTime,
        );
      },
    );

    if (!cached.value) {
      return Response.json(
        {
          error:
            "Transaction is not a verified StonkFun LaunchLab initialize",
        },
        { status: 404 },
      );
    }

    return Response.json(cached.value, {
      headers: {
        "Cache-Control":
          "public, max-age=3, stale-while-revalidate=12",
        "X-TrenchScan-Cache": cached.status,
        "X-TrenchScan-Window":
          cached.value.historyComplete
            ? "launch-boundary-reached"
            : "partial",
      },
    });
  } catch (error) {
    console.error(
      "[trenchscan] StonkFun early-buyer scan failed",
      signature,
      error,
    );

    return Response.json(
      {
        error:
          "Could not replay the LaunchLab early-buy window from Solana RPC",
      },
      { status: 502 },
    );
  }
}

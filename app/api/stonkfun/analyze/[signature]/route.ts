import bs58 from "bs58";
import { analyzeStonkFunSignature } from "@/lib/stonkfun-analysis";
import { getEvidenceCache } from "@/lib/evidence-cache";
import { createSolanaConnection } from "@/lib/pump";

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
      `stonkfun-analysis:${signature}`,
      8_000,
      () =>
        analyzeStonkFunSignature(
          createSolanaConnection(),
          signature,
        ),
    );
    const analysis = cached.value;

    if (!analysis) {
      return Response.json(
        {
          error:
            "Transaction is not a verified StonkFun LaunchLab initialize",
        },
        { status: 404 },
      );
    }

    return Response.json(analysis, {
      headers: {
        "Cache-Control": "public, max-age=5, stale-while-revalidate=15",
        "X-TrenchScan-Cache": cached.status,
        "X-TrenchScan-Coverage":
          analysis.coverage.complete ? "complete" : "partial",
      },
    });
  } catch (error) {
    console.error(
      "[trenchscan] StonkFun analysis failed",
      signature,
      error,
    );

    return Response.json(
      {
        error:
          "Could not decode the StonkFun launch receipt from Solana RPC",
      },
      { status: 502 },
    );
  }
}

import bs58 from "bs58";
import { analyzeLaunchSignature } from "@/lib/analysis";
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
    const analysis = await analyzeLaunchSignature(
      createSolanaConnection(),
      signature,
    );

    if (!analysis) {
      return Response.json(
        { error: "Transaction is not a decodable Pump create_v2 launch" },
        { status: 404 },
      );
    }

    return Response.json(analysis, {
      headers: {
        "Cache-Control": "public, max-age=15, stale-while-revalidate=45",
        "X-TrenchScan-Coverage": analysis.coverage.complete ? "complete" : "partial",
      },
    });
  } catch (error) {
    console.error("[trenchscan] full analysis failed", signature, error);
    return Response.json(
      {
        error:
          "Could not decode the launch receipt from Solana RPC",
      },
      { status: 502 },
    );
  }
}

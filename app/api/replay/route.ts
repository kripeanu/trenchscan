import {
  findRecentReplayLaunch,
  loadReplayLaunchBySignature,
} from "@/lib/replay";
import { createSolanaConnection } from "@/lib/pump";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const signature = searchParams.get("signature");
  const connection = createSolanaConnection();

  try {
    const replay = signature
      ? await loadReplayLaunchBySignature(connection, signature)
      : await findRecentReplayLaunch(connection);

    if (!replay) {
      return Response.json(
        {
          error: signature
            ? "That transaction is not a decodable Pump create_v2 launch"
            : "No decodable recent Pump create_v2 launch found in the sampled history",
        },
        { status: 404 },
      );
    }

    return Response.json(replay, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[trenchscan] replay lookup failed", signature, error);
    return Response.json(
      { error: "Could not load a real launch from Solana RPC" },
      { status: 502 },
    );
  }
}

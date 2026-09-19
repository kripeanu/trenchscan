import { createSolanaConnection } from "@/lib/pump";
import { getLaunchHub } from "@/lib/launch-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const connection = createSolanaConnection();
  const hub = getLaunchHub();

  try {
    const [slot, blockHeight] = await Promise.all([
      connection.getSlot("confirmed"),
      connection.getBlockHeight("confirmed"),
    ]);

    return Response.json(
      {
        ok: true,
        checkedAt: Date.now(),
        rpcLatencyMs: Math.max(0, Date.now() - started),
        rpc: {
          slot,
          blockHeight,
        },
        listener: hub.diagnostics(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        checkedAt: Date.now(),
        rpcLatencyMs: Math.max(0, Date.now() - started),
        listener: hub.diagnostics(),
        error: error instanceof Error ? error.message : "Unknown RPC error",
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}

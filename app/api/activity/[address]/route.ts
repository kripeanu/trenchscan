import { PublicKey } from "@solana/web3.js";
import { getEvidenceCache } from "@/lib/evidence-cache";
import { createSolanaConnection } from "@/lib/pump";
import { withRpcRetry } from "@/lib/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ address: string }> },
) {
  const { address } = await context.params;

  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(address);
  } catch {
    return Response.json({ error: "Invalid Solana address" }, { status: 400 });
  }

  try {
    const cached = await getEvidenceCache().getOrLoad(
      `activity:${address}`,
      15_000,
      async () => {
        const rows = await withRpcRetry(() =>
          createSolanaConnection().getSignaturesForAddress(
            publicKey,
            { limit: 1 },
            "confirmed",
          ),
        );
        const latest = rows[0] ?? null;

        return {
          address,
          sampledAt: Date.now(),
          latestSignature: latest?.signature ?? null,
          latestSlot: latest?.slot ?? null,
          latestBlockTime: latest?.blockTime ?? null,
          lastActivityAt:
            latest?.blockTime === null || latest?.blockTime === undefined
              ? null
              : latest.blockTime * 1000,
        };
      },
    );

    return Response.json(cached.value, {
      headers: {
        "Cache-Control": "public, max-age=8, stale-while-revalidate=22",
        "X-TrenchScan-Cache": cached.status,
      },
    });
  } catch (error) {
    console.error("[trenchscan] launch activity read failed", address, error);
    return Response.json(
      { error: "Could not read recent pool activity from Solana RPC" },
      { status: 502 },
    );
  }
}

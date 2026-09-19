import { PublicKey } from "@solana/web3.js";
import { getEvidenceCache } from "@/lib/evidence-cache";
import {
  loadHolderCount,
  loadMarketCapUsd,
} from "@/lib/feed-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LaunchSource = "pump.fun" | "stonkfun.xyz";

function validSource(value: string | null): value is LaunchSource {
  return value === "pump.fun" || value === "stonkfun.xyz";
}

function validPublicKey(value: string | null) {
  if (!value) return null;
  try {
    return new PublicKey(value).toBase58();
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ mint: string }> },
) {
  const { mint } = await context.params;
  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  const curve = validPublicKey(url.searchParams.get("curve"));
  const excludeOwner = validPublicKey(url.searchParams.get("excludeOwner"));

  try {
    new PublicKey(mint);
  } catch {
    return Response.json({ error: "Invalid Solana mint" }, { status: 400 });
  }

  if (!validSource(source)) {
    return Response.json({ error: "Invalid launch source" }, { status: 400 });
  }

  const cacheKey = [
    "feed-stats",
    source,
    mint,
    curve ?? "",
    excludeOwner ?? "",
  ].join(":");

  const cached = await getEvidenceCache().getOrLoad(
    cacheKey,
    12_000,
    async () => {
      const [holdersResult, marketCapResult] = await Promise.allSettled([
        loadHolderCount(mint, excludeOwner),
        loadMarketCapUsd({ mint, source, curve }),
      ]);

      const holders =
        holdersResult.status === "fulfilled"
          ? holdersResult.value.holders
          : null;
      const holdersComplete =
        holdersResult.status === "fulfilled"
          ? holdersResult.value.complete
          : false;
      const marketCap =
        marketCapResult.status === "fulfilled"
          ? marketCapResult.value.marketCapUsd
          : null;
      const marketCapSource =
        marketCapResult.status === "fulfilled"
          ? marketCapResult.value.source
          : null;

      return {
        mint,
        sampledAt: Date.now(),
        holders,
        holdersComplete,
        marketCapUsd: marketCap,
        marketCapSource,
        coverage: {
          holders: holders === null ? "unavailable" : "ready",
          marketCap: marketCap === null ? "unavailable" : "ready",
        },
      };
    },
  );

  return Response.json(cached.value, {
    headers: {
      "Cache-Control": "public, max-age=6, stale-while-revalidate=20",
      "X-TrenchScan-Cache": cached.status,
    },
  });
}

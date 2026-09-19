import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { getEvidenceCache } from "@/lib/evidence-cache";
import { createSolanaConnection } from "@/lib/pump";
import {
  findRecentStonkFunReplay,
  findStonkFunReplayForMint,
  loadStonkFunReplayBySignature,
} from "@/lib/stonkfun-replay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validSignature(signature: string) {
  try {
    return bs58.decode(signature).length === 64;
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const signature = searchParams.get("signature");
  const mint = searchParams.get("mint");

  if (signature && !validSignature(signature)) {
    return Response.json(
      { error: "Invalid Solana transaction signature" },
      { status: 400 },
    );
  }

  if (mint) {
    try {
      new PublicKey(mint);
    } catch {
      return Response.json(
        { error: "Invalid Solana mint" },
        { status: 400 },
      );
    }
  }

  try {
    const cache = getEvidenceCache();
    const cached = signature
      ? await cache.getOrLoad(
          `stonkfun-replay:${signature}`,
          60_000,
          () =>
            loadStonkFunReplayBySignature(
              createSolanaConnection(),
              signature,
            ),
        )
      : mint
        ? await cache.getOrLoad(
            `stonkfun-replay-mint:${mint}`,
            5 * 60_000,
            () =>
              findStonkFunReplayForMint(
                createSolanaConnection(),
                mint,
              ),
          )
        : await cache.getOrLoad(
            "stonkfun-replay:recent",
            15_000,
            () => findRecentStonkFunReplay(createSolanaConnection()),
          );

    if (!cached.value) {
      return Response.json(
        {
          error: signature
            ? "Transaction is not a verified StonkFun LaunchLab initialize"
            : mint
              ? "No verified StonkFun LaunchLab initialize found in the bounded mint history"
              : "No verified recent StonkFun LaunchLab initialize found in the bounded search",
        },
        { status: 404 },
      );
    }

    return Response.json(cached.value, {
      headers: {
        "Cache-Control": signature || mint
          ? "public, max-age=30, stale-while-revalidate=90"
          : "public, max-age=5, stale-while-revalidate=15",
        "X-TrenchScan-Cache": cached.status,
      },
    });
  } catch (error) {
    console.error("[trenchscan] StonkFun replay failed", { signature, mint }, error);
    return Response.json(
      {
        error: "Could not inspect StonkFun LaunchLab history from Solana RPC",
      },
      { status: 502 },
    );
  }
}

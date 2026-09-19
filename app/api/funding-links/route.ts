import { PublicKey } from "@solana/web3.js";
import { buildFundingTrace } from "@/lib/funding-links";
import { createSolanaConnection } from "@/lib/pump";
import { getEvidenceCache } from "@/lib/evidence-cache";
import type { FundingBuyerInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FundingRequest = {
  buyers?: unknown;
  launchSlot?: unknown;
};

function parseBuyer(value: unknown): FundingBuyerInput | null {
  if (!value || typeof value !== "object") return null;

  const row = value as Record<string, unknown>;
  if (
    typeof row.wallet !== "string" ||
    typeof row.firstBuySignature !== "string" ||
    (row.firstBuyBlockTime !== null && typeof row.firstBuyBlockTime !== "number")
  ) {
    return null;
  }

  try {
    new PublicKey(row.wallet);
  } catch {
    return null;
  }

  if (row.firstBuySignature.length < 60) return null;

  return {
    wallet: row.wallet,
    firstBuySignature: row.firstBuySignature,
    firstBuyBlockTime:
      typeof row.firstBuyBlockTime === "number" ? row.firstBuyBlockTime : null,
  };
}

export async function POST(request: Request) {
  let body: FundingRequest;

  try {
    body = (await request.json()) as FundingRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const launchSlot = Number(body.launchSlot);
  const buyers = Array.isArray(body.buyers)
    ? body.buyers.map(parseBuyer).filter((buyer): buyer is FundingBuyerInput => buyer !== null)
    : [];

  if (
    !Number.isSafeInteger(launchSlot) ||
    launchSlot <= 0 ||
    !buyers.length ||
    buyers.length > 12
  ) {
    return Response.json(
      { error: "Invalid launch slot or early-buyer evidence" },
      { status: 400 },
    );
  }

  try {
    const identity = buyers
      .map((buyer) => `${buyer.wallet}@${buyer.firstBuySignature}`)
      .join(",");
    const cached = await getEvidenceCache().getOrLoad(
      `funding:${launchSlot}:${identity}`,
      60_000,
      () =>
        buildFundingTrace(
          createSolanaConnection(),
          buyers,
          launchSlot,
        ),
    );

    return Response.json(cached.value, {
      headers: {
        "Cache-Control": "no-store",
        "X-TrenchScan-Cache": cached.status,
      },
    });
  } catch (error) {
    console.error("[trenchscan] funding trace failed", launchSlot, error);
    return Response.json(
      { error: "Could not trace wallet history and funding from Solana RPC" },
      { status: 502 },
    );
  }
}

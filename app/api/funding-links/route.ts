import { PublicKey } from "@solana/web3.js";
import { buildFundingTrace } from "@/lib/funding-links";
import { createSolanaConnection } from "@/lib/pump";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FundingRequest = {
  wallets?: unknown;
  launchSlot?: unknown;
};

export async function POST(request: Request) {
  let body: FundingRequest;

  try {
    body = (await request.json()) as FundingRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const launchSlot = Number(body.launchSlot);
  const wallets = Array.isArray(body.wallets)
    ? body.wallets.filter((wallet): wallet is string => typeof wallet === "string")
    : [];

  try {
    if (!Number.isSafeInteger(launchSlot) || launchSlot <= 0) {
      throw new Error("bad slot");
    }

    if (!wallets.length || wallets.length > 12) {
      throw new Error("bad wallet count");
    }

    for (const wallet of wallets) new PublicKey(wallet);
  } catch {
    return Response.json(
      { error: "Invalid launch slot or wallet list" },
      { status: 400 },
    );
  }

  try {
    const trace = await buildFundingTrace(
      createSolanaConnection(),
      wallets,
      launchSlot,
    );

    return Response.json(trace, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[trenchscan] funding trace failed", launchSlot, error);
    return Response.json(
      { error: "Could not trace direct funding from Solana RPC" },
      { status: 502 },
    );
  }
}

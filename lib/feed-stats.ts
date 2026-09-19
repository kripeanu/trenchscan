import { PublicKey } from "@solana/web3.js";
import { createSolanaConnection } from "@/lib/pump";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code?: number; message?: string };
};

type HeliusTokenAccount = {
  owner: string;
  amount: number | string;
};

type ProgramAccountRow = {
  pubkey: string;
  account: {
    data: [string, string] | string;
  };
};

type JupiterPriceRow = {
  usdPrice?: number;
};

const globalForFeedStats = globalThis as unknown as {
  trenchScanSolPrice?: { value: number; expiresAt: number };
};

function endpoint() {
  return process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
}

async function rpcRequest<T>(
  method: string,
  params: unknown,
  timeoutMs = 2_500,
): Promise<T> {
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "trenchscan-feed",
      method,
      params,
    }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (payload.error || payload.result === undefined) {
    throw new Error(payload.error?.message ?? "RPC method unavailable");
  }

  return payload.result;
}

async function heliusHolderCount(
  mint: string,
  excludeOwner?: string | null,
) {
  const holders = new Set<string>();
  let complete = true;

  for (let page = 1; page <= 5; page += 1) {
    const result = await rpcRequest<{
      token_accounts: HeliusTokenAccount[];
    }>("getTokenAccounts", {
      page,
      limit: 1000,
      displayOptions: {},
      mint,
    });

    const rows = result.token_accounts ?? [];
    for (const row of rows) {
      const amount = Number(row.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (excludeOwner && row.owner === excludeOwner) continue;
      holders.add(row.owner);
    }

    if (rows.length < 1000) {
      return { holders: holders.size, complete };
    }

    if (page === 5) complete = false;
  }

  return { holders: holders.size, complete };
}

async function standardHolderCount(
  mint: string,
  tokenProgram: string,
  excludeOwner?: string | null,
) {
  const rows = await rpcRequest<ProgramAccountRow[]>(
    "getProgramAccounts",
    [
      tokenProgram,
      {
        commitment: "confirmed",
        encoding: "base64",
        filters: [{ memcmp: { offset: 0, bytes: mint } }],
        dataSlice: { offset: 32, length: 40 },
      },
    ],
    3_000,
  );

  const holders = new Set<string>();

  for (const row of rows) {
    const encoded = Array.isArray(row.account.data)
      ? row.account.data[0]
      : row.account.data;
    const data = Buffer.from(encoded, "base64");
    if (data.length < 40) continue;

    const owner = new PublicKey(data.subarray(0, 32)).toBase58();
    const amount = data.readBigUInt64LE(32);
    if (amount === 0n) continue;
    if (excludeOwner && owner === excludeOwner) continue;
    holders.add(owner);
  }

  return { holders: holders.size, complete: true };
}

export async function loadHolderCount(
  mint: string,
  excludeOwner?: string | null,
) {
  const connection = createSolanaConnection();
  const mintInfo = await connection.getAccountInfo(
    new PublicKey(mint),
    "confirmed",
  );

  if (!mintInfo) throw new Error("Mint not found");

  const tokenProgram = mintInfo.owner.toBase58();
  if (
    tokenProgram !== TOKEN_PROGRAM_ID &&
    tokenProgram !== TOKEN_2022_PROGRAM_ID
  ) {
    throw new Error("Unsupported token program");
  }

  if (/helius/i.test(endpoint())) {
    try {
      return await heliusHolderCount(mint, excludeOwner);
    } catch {
      // Fall through to the standard Solana account scan.
    }
  }

  return standardHolderCount(mint, tokenProgram, excludeOwner);
}

async function jupiterPrice(mint: string) {
  const apiKey = process.env.JUPITER_API_KEY?.trim();
  const base = apiKey
    ? "https://api.jup.ag/price/v3"
    : "https://lite-api.jup.ag/price/v3";
  const response = await fetch(
    `${base}?ids=${encodeURIComponent(mint)}`,
    {
      headers: apiKey ? { "x-api-key": apiKey } : undefined,
      signal: AbortSignal.timeout(2_500),
      cache: "no-store",
    },
  );

  if (!response.ok) return null;
  const payload = (await response.json()) as Record<string, JupiterPriceRow>;
  const value = payload[mint]?.usdPrice;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

async function solUsdPrice() {
  const cached = globalForFeedStats.trenchScanSolPrice;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const price = await jupiterPrice(SOL_MINT);
  if (price !== null) {
    globalForFeedStats.trenchScanSolPrice = {
      value: price,
      expiresAt: Date.now() + 30_000,
    };
  }

  return price;
}

function pumpSolMarketCapLamports(data: Buffer) {
  // Anchor discriminator + BondingCurve fields documented by Pump.
  if (data.length < 49) return null;

  const virtualTokenReserves = data.readBigUInt64LE(8);
  const virtualQuoteReserves = data.readBigUInt64LE(16);
  const tokenTotalSupply = data.readBigUInt64LE(40);

  if (virtualTokenReserves === 0n) return null;

  // Newer Pump accounts append quote_mint after creator + mode flags.
  // Missing field means an older SOL-only curve. A non-zero quote mint is not
  // assumed to be SOL; those curves fall back to external token pricing.
  if (data.length >= 115) {
    const quoteMint = data.subarray(83, 115);
    const nonZeroQuote = quoteMint.some((byte) => byte !== 0);
    if (nonZeroQuote) return null;
  }

  return (
    virtualQuoteReserves *
    tokenTotalSupply /
    virtualTokenReserves
  );
}

async function pumpMarketCapUsd(curve: string) {
  const connection = createSolanaConnection();
  const account = await connection.getAccountInfo(
    new PublicKey(curve),
    "confirmed",
  );
  if (!account) return null;

  const lamports = pumpSolMarketCapLamports(account.data);
  if (lamports === null) return null;

  const solUsd = await solUsdPrice();
  if (solUsd === null) return null;

  return (Number(lamports) / 1_000_000_000) * solUsd;
}

async function priceTimesSupplyMarketCap(mint: string) {
  const connection = createSolanaConnection();
  const [price, supply] = await Promise.all([
    jupiterPrice(mint),
    connection.getTokenSupply(new PublicKey(mint), "confirmed").catch(() => null),
  ]);

  if (price === null || !supply?.value.uiAmount) return null;
  return price * supply.value.uiAmount;
}

export async function loadMarketCapUsd(input: {
  mint: string;
  source: "pump.fun" | "stonkfun.xyz";
  curve?: string | null;
}) {
  if (input.source === "pump.fun" && input.curve) {
    try {
      const value = await pumpMarketCapUsd(input.curve);
      if (value !== null) {
        return { marketCapUsd: value, source: "pump-curve" as const };
      }
    } catch {
      // Fall through to token price × supply.
    }
  }

  const value = await priceTimesSupplyMarketCap(input.mint);
  return {
    marketCapUsd: value,
    source: value === null ? null : ("jupiter-price" as const),
  };
}

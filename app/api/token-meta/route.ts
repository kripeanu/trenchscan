import { isIP } from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_METADATA_BYTES = 512_000;
const TIMEOUT_MS = 4_500;

function normalizeContentUri(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith("ipfs://")) {
    const path = trimmed.slice("ipfs://".length).replace(/^ipfs\//, "");
    return `https://ipfs.io/ipfs/${path}`;
  }

  if (trimmed.startsWith("ar://")) {
    return `https://arweave.net/${trimmed.slice("ar://".length)}`;
  }

  return trimmed;
}

function privateIpv4(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

function safePublicUrl(value: string) {
  let url: URL;

  try {
    url = new URL(normalizeContentUri(value));
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    return null;
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4 && privateIpv4(host)) return null;
  if (
    ipVersion === 6 &&
    (host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd") ||
      host.startsWith("fe8") ||
      host.startsWith("fe9") ||
      host.startsWith("fea") ||
      host.startsWith("feb"))
  ) {
    return null;
  }

  return url;
}

async function fetchMetadata(url: URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: {
        Accept: "application/json,text/plain;q=0.8,*/*;q=0.1",
      },
    });

    if (!response.ok) throw new Error("metadata fetch failed");

    const contentLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_METADATA_BYTES
    ) {
      throw new Error("metadata too large");
    }

    const text = await response.text();
    if (text.length > MAX_METADATA_BYTES) {
      throw new Error("metadata too large");
    }

    return JSON.parse(text) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const uri = new URL(request.url).searchParams.get("uri");
  if (!uri) {
    return Response.json({ image: null }, { status: 400 });
  }

  const metadataUrl = safePublicUrl(uri);
  if (!metadataUrl) {
    return Response.json({ image: null }, { status: 400 });
  }

  try {
    const metadata = await fetchMetadata(metadataUrl);
    const rawImage =
      typeof metadata.image === "string"
        ? metadata.image
        : typeof metadata.image_url === "string"
          ? metadata.image_url
          : null;

    const imageUrl = rawImage ? safePublicUrl(rawImage) : null;

    return Response.json(
      {
        image: imageUrl?.toString() ?? null,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        },
      },
    );
  } catch {
    return Response.json(
      { image: null },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  }
}

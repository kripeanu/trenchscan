import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_METADATA_BYTES = 512_000;
const TIMEOUT_MS = 4_500;
const MAX_REDIRECTS = 2;

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

function privateIpv6(host: string) {
  const normalized = host.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function privateIp(host: string) {
  const version = isIP(host);
  if (version === 4) return privateIpv4(host);
  if (version === 6) return privateIpv6(host);
  return false;
}

function parsedPublicUrl(value: string) {
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
    host.endsWith(".local") ||
    privateIp(host)
  ) {
    return null;
  }

  return url;
}

async function publicNetworkUrl(value: string, base?: URL) {
  let url: URL;

  try {
    url = base
      ? new URL(value, base)
      : parsedPublicUrl(value) ?? new URL("about:blank");
  } catch {
    return null;
  }

  if (url.protocol === "about:") return null;

  const parsed = parsedPublicUrl(url.toString());
  if (!parsed) return null;

  if (!isIP(parsed.hostname)) {
    try {
      const addresses = await lookup(parsed.hostname, {
        all: true,
        verbatim: true,
      });

      if (!addresses.length || addresses.some((row) => privateIp(row.address))) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return parsed;
}

async function fetchMetadata(url: URL, redirects = 0): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        Accept: "application/json,text/plain;q=0.8,*/*;q=0.1",
      },
    });

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get("location") &&
      redirects < MAX_REDIRECTS
    ) {
      const next = await publicNetworkUrl(
        response.headers.get("location")!,
        url,
      );
      if (!next) throw new Error("unsafe metadata redirect");
      return fetchMetadata(next, redirects + 1);
    }

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

  const metadataUrl = await publicNetworkUrl(normalizeContentUri(uri));
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

    const imageUrl = rawImage
      ? await publicNetworkUrl(normalizeContentUri(rawImage))
      : null;

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

"use client";

import { useEffect, useState } from "react";

type TokenMetadata = {
  image: string | null;
};

const metadataCache = new Map<string, string | null>();

export function TokenAvatar({
  uri,
  symbol,
  mint,
}: {
  uri: string | null;
  symbol: string;
  mint: string;
}) {
  const [image, setImage] = useState<string | null>(() =>
    uri ? metadataCache.get(uri) ?? null : null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!uri) return;

    const cached = metadataCache.get(uri);
    if (cached !== undefined) {
      setImage(cached);
      return;
    }

    let cancelled = false;

    void fetch(`/api/token-meta?uri=${encodeURIComponent(uri)}`, {
      cache: "force-cache",
    })
      .then(async (response) => {
        if (!response.ok) return { image: null } as TokenMetadata;
        return (await response.json()) as TokenMetadata;
      })
      .then((payload) => {
        metadataCache.set(uri, payload.image);
        if (!cancelled) setImage(payload.image);
      })
      .catch(() => {
        metadataCache.set(uri, null);
      });

    return () => {
      cancelled = true;
    };
  }, [uri]);

  const fallback =
    symbol.trim().replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() ||
    mint.slice(0, 2).toUpperCase();

  return (
    <span className="token-avatar" data-image={Boolean(image && !failed)}>
      {image && !failed ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{fallback}</span>
      )}
    </span>
  );
}

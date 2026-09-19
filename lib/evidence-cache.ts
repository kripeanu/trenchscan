export type EvidenceCacheStatus = "hit" | "miss" | "join";

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

type CacheStats = {
  hits: number;
  misses: number;
  joins: number;
};

const MAX_ENTRIES = 300;

class EvidenceCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly counters: CacheStats = {
    hits: 0,
    misses: 0,
    joins: 0,
  };

  async getOrLoad<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<{ value: T; status: EvidenceCacheStatus }> {
    const now = Date.now();
    const cached = this.entries.get(key);

    if (cached && cached.expiresAt > now) {
      this.counters.hits += 1;
      return {
        value: cached.value as T,
        status: "hit",
      };
    }

    if (cached) this.entries.delete(key);

    const existing = this.inFlight.get(key);
    if (existing) {
      this.counters.joins += 1;
      return {
        value: (await existing) as T,
        status: "join",
      };
    }

    this.counters.misses += 1;

    const promise = loader();
    this.inFlight.set(key, promise);

    try {
      const value = await promise;
      this.entries.set(key, {
        value,
        expiresAt: Date.now() + Math.max(0, ttlMs),
      });
      this.prune();

      return { value, status: "miss" };
    } finally {
      this.inFlight.delete(key);
    }
  }

  stats() {
    this.pruneExpired();

    return {
      entries: this.entries.size,
      inFlight: this.inFlight.size,
      ...this.counters,
    };
  }

  clear() {
    this.entries.clear();
    this.inFlight.clear();
    this.counters.hits = 0;
    this.counters.misses = 0;
    this.counters.joins = 0;
  }

  private pruneExpired() {
    const now = Date.now();

    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private prune() {
    this.pruneExpired();

    if (this.entries.size <= MAX_ENTRIES) return;

    const oldest = [...this.entries.entries()]
      .sort((left, right) => left[1].expiresAt - right[1].expiresAt)
      .slice(0, this.entries.size - MAX_ENTRIES);

    for (const [key] of oldest) this.entries.delete(key);
  }
}

const globalForEvidenceCache = globalThis as unknown as {
  trenchScanEvidenceCache?: EvidenceCache;
};

export function getEvidenceCache() {
  if (!globalForEvidenceCache.trenchScanEvidenceCache) {
    globalForEvidenceCache.trenchScanEvidenceCache = new EvidenceCache();
  }

  return globalForEvidenceCache.trenchScanEvidenceCache;
}

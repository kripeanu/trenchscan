import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEvidenceCache } from "./evidence-cache";

describe("evidence cache", () => {
  beforeEach(() => {
    getEvidenceCache().clear();
    vi.useRealTimers();
  });

  it("reuses a fresh successful value", async () => {
    const cache = getEvidenceCache();
    const loader = vi.fn(async () => ({ value: 1 }));

    const first = await cache.getOrLoad("snapshot:mint", 1_000, loader);
    const second = await cache.getOrLoad("snapshot:mint", 1_000, loader);

    expect(first.status).toBe("miss");
    expect(second.status).toBe("hit");
    expect(second.value).toEqual({ value: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("coalesces simultaneous callers onto one RPC loader", async () => {
    const cache = getEvidenceCache();
    let release!: (value: number) => void;
    const loader = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = resolve;
        }),
    );

    const first = cache.getOrLoad("early:mint", 1_000, loader);
    const second = cache.getOrLoad("early:mint", 1_000, loader);

    release(42);

    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe("miss");
    expect(b.status).toBe("join");
    expect(a.value).toBe(42);
    expect(b.value).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not cache failed RPC calls", async () => {
    const cache = getEvidenceCache();
    const loader = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue("ok");

    await expect(cache.getOrLoad("snapshot:mint", 1_000, loader)).rejects.toThrow("429");
    await expect(cache.getOrLoad("snapshot:mint", 1_000, loader)).resolves.toEqual({
      value: "ok",
      status: "miss",
    });

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("expires old evidence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T16:00:00Z"));

    const cache = getEvidenceCache();
    const loader = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    await cache.getOrLoad("snapshot:mint", 1_000, loader);
    vi.advanceTimersByTime(1_001);

    const fresh = await cache.getOrLoad("snapshot:mint", 1_000, loader);
    expect(fresh.value).toBe(2);
    expect(fresh.status).toBe("miss");
  });
});

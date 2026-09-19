import { describe, expect, it, vi } from "vitest";
import { isRpcRateLimit, withRpcRetry } from "./rpc";

describe("RPC retry helpers", () => {
  it("recognizes Solana 429 errors", () => {
    expect(isRpcRateLimit(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRpcRateLimit(new Error("Too many requests for a specific RPC call"))).toBe(true);
    expect(isRpcRateLimit(new Error("different failure"))).toBe(false);
  });

  it("retries a rate-limited operation", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("429 Too Many Requests"))
      .mockResolvedValue("ok");

    await expect(withRpcRetry(fn, [0])).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated failures", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(new Error("boom"));

    await expect(withRpcRetry(fn, [0, 0])).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

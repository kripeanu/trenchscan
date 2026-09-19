import type { ConfirmedSignatureInfo } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { mergeStonkFunCandidates, oldestSuccessfulCandidates } from "./stonkfun-replay";

function row(
  signature: string,
  slot: number,
  err: ConfirmedSignatureInfo["err"] = null,
): ConfirmedSignatureInfo {
  return {
    signature,
    slot,
    err,
    memo: null,
    blockTime: null,
    confirmationStatus: "confirmed",
  };
}

describe("mergeStonkFunCandidates", () => {
  it("deduplicates the two StonkFun platform histories", () => {
    const merged = mergeStonkFunCandidates([
      [row("a", 10), row("shared", 9)],
      [row("b", 11), row("shared", 9)],
    ]);

    expect(merged.map((item) => item.signature)).toEqual([
      "b",
      "a",
      "shared",
    ]);
  });

  it("drops failed signatures before replay inspection", () => {
    const merged = mergeStonkFunCandidates([
      [row("ok", 10), row("failed", 12, { InstructionError: [0, "Custom"] })],
    ]);

    expect(merged.map((item) => item.signature)).toEqual(["ok"]);
  });
});


describe("oldestSuccessfulCandidates", () => {
  it("checks oldest successful mint-history rows first", () => {
    const rows = [
      row("newest", 30),
      row("middle-failed", 20, { InstructionError: [0, "Custom"] }),
      row("middle", 15),
      row("oldest", 10),
    ];

    expect(
      oldestSuccessfulCandidates(rows, 2).map((item) => item.signature),
    ).toEqual(["oldest", "middle"]);
  });
});

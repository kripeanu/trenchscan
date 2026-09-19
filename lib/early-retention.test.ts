import { describe, expect, it } from "vitest";
import { classifyRetention } from "./early-retention";

describe("classifyRetention", () => {
  it("calls a zero balance jeeted", () => {
    expect(classifyRetention(0n, 100n)).toBe("jeeted");
  });

  it("separates mostly-jeeted, trimmed and holding wallets", () => {
    expect(classifyRetention(10n, 100n)).toBe("mostly-jeeted");
    expect(classifyRetention(50n, 100n)).toBe("trimmed");
    expect(classifyRetention(95n, 100n)).toBe("holding");
  });

  it("flags wallets that hold materially more than the first decoded grab", () => {
    expect(classifyRetention(121n, 100n)).toBe("added");
  });
});

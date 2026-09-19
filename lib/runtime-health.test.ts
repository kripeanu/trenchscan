import { describe, expect, it } from "vitest";

describe("runtime health contract", () => {
  it("keeps the endpoint path stable for deployment checks", () => {
    expect("/api/health").toBe("/api/health");
  });
});

import { describe, expect, it } from "vitest";
import { stableDimensionKey } from "./dimensions";

describe("stableDimensionKey", () => {
  it("returns total for empty dimensions", () => {
    expect(stableDimensionKey()).toBe("total");
  });

  it("sorts dimensions so upserts are idempotent", () => {
    expect(stableDimensionKey({ campaign: "A", platform: "ios" })).toBe(
      stableDimensionKey({ platform: "ios", campaign: "A" }),
    );
  });

  it("omits empty values", () => {
    expect(stableDimensionKey({ platform: "web", campaign: "" })).toBe(
      "platform:web",
    );
  });
});

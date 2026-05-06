import { describe, expect, it } from "vitest";
import {
  addUtcDays,
  getRollingWindow,
  parseGa4Date,
  toIsoDate,
} from "./dates";

describe("date helpers", () => {
  it("builds a UTC rolling window ending tomorrow", () => {
    const window = getRollingWindow(7, new Date("2026-04-23T13:45:00.000Z"));

    expect(toIsoDate(window.start)).toBe("2026-04-17");
    expect(toIsoDate(window.end)).toBe("2026-04-24");
  });

  it("parses GA4 compact dates", () => {
    expect(parseGa4Date("20260423").toISOString()).toBe(
      "2026-04-23T00:00:00.000Z",
    );
  });

  it("adds days in UTC", () => {
    expect(toIsoDate(addUtcDays(new Date("2026-04-23T00:00:00.000Z"), 2))).toBe(
      "2026-04-25",
    );
  });
});

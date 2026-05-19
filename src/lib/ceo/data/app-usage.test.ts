import { describe, expect, it } from "vitest";

import { enumerateBuckets } from "./app-usage";

describe("enumerateBuckets", () => {
  it("returns every day in a 7-day range, inclusive on both ends", () => {
    // 2026-05-13 → 2026-05-19 → 7 buckets
    const start = new Date("2026-05-13T00:00:00.000Z");
    const end = new Date("2026-05-19T23:59:59.000Z");
    const keys = enumerateBuckets(start, end, "day");
    expect(keys).toEqual([
      "20260513",
      "20260514",
      "20260515",
      "20260516", // would have been dropped before this fix
      "20260517", // would have been dropped before this fix
      "20260518",
      "20260519",
    ]);
  });

  it("returns hourly buckets for a sub-day range", () => {
    const start = new Date("2026-05-19T08:00:00.000Z");
    const end = new Date("2026-05-19T11:30:00.000Z");
    const keys = enumerateBuckets(start, end, "hour");
    expect(keys).toEqual([
      "2026051908",
      "2026051909",
      "2026051910",
      "2026051911",
    ]);
  });

  it("steps weekly", () => {
    const start = new Date("2026-05-01T00:00:00.000Z");
    const end = new Date("2026-05-29T00:00:00.000Z");
    const keys = enumerateBuckets(start, end, "week");
    // 5 weekly steps, deduped if same yearWeek
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(keys.length).toBeLessThanOrEqual(5);
  });

  it("steps monthly", () => {
    const start = new Date("2026-01-15T00:00:00.000Z");
    const end = new Date("2026-04-15T00:00:00.000Z");
    expect(enumerateBuckets(start, end, "month")).toEqual([
      "202601",
      "202602",
      "202603",
      "202604",
    ]);
  });

  it("returns [] when start is null (open-ended range)", () => {
    const end = new Date("2026-05-19T00:00:00.000Z");
    expect(enumerateBuckets(null, end, "day")).toEqual([]);
    expect(enumerateBuckets(undefined, end, "day")).toEqual([]);
  });

  it("returns [] when start > end (defensive, no infinite loop)", () => {
    const start = new Date("2026-05-19T00:00:00.000Z");
    const end = new Date("2026-05-13T00:00:00.000Z");
    expect(enumerateBuckets(start, end, "day")).toEqual([]);
  });

  it("returns single bucket when start == end", () => {
    const start = new Date("2026-05-19T00:00:00.000Z");
    const end = new Date("2026-05-19T00:00:00.000Z");
    expect(enumerateBuckets(start, end, "day")).toEqual(["20260519"]);
  });
});

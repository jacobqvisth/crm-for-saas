import { describe, expect, it } from "vitest";

import { bucketKey, enumerateBuckets } from "./app-usage";
import { startOfStockholmDay, startOfStockholmMonth } from "../dates";

// All bucketing is anchored to Stockholm civil time, and ranges are half-open
// [start, end) — `end` is the exclusive start of the day AFTER the range.
describe("enumerateBuckets", () => {
  it("returns every day in a 7-day half-open range", () => {
    const start = startOfStockholmDay(new Date("2026-05-13T12:00:00.000Z"));
    const end = startOfStockholmDay(new Date("2026-05-20T12:00:00.000Z"));
    expect(enumerateBuckets(start, end, "day")).toEqual([
      "20260513",
      "20260514",
      "20260515",
      "20260516",
      "20260517",
      "20260518",
      "20260519",
    ]);
  });

  it("excludes the exclusive end-boundary day (the Jun-1 = 0 / tomorrow-bar bug)", () => {
    // "Last week" Mon May 25 .. exclusive next Mon Jun 1 → must NOT draw Jun 1.
    const start = startOfStockholmDay(new Date("2026-05-25T12:00:00.000Z"));
    const end = startOfStockholmDay(new Date("2026-06-01T12:00:00.000Z"));
    const keys = enumerateBuckets(start, end, "day");
    expect(keys).toEqual([
      "20260525",
      "20260526",
      "20260527",
      "20260528",
      "20260529",
      "20260530",
      "20260531",
    ]);
    expect(keys).not.toContain("20260601");
  });

  it("returns hourly buckets for a sub-day range", () => {
    // 08:00 → 11:30 Stockholm (CEST) = 06:00 → 09:30 UTC.
    const start = new Date("2026-05-19T06:00:00.000Z");
    const end = new Date("2026-05-19T09:30:00.000Z");
    expect(enumerateBuckets(start, end, "hour")).toEqual([
      "2026051908",
      "2026051909",
      "2026051910",
      "2026051911",
    ]);
  });

  it("steps weekly", () => {
    const start = startOfStockholmDay(new Date("2026-05-01T12:00:00.000Z"));
    const end = startOfStockholmDay(new Date("2026-05-29T12:00:00.000Z"));
    const keys = enumerateBuckets(start, end, "week");
    expect(keys.length).toBeGreaterThanOrEqual(4);
    expect(keys.length).toBeLessThanOrEqual(5);
  });

  it("steps monthly and includes the month the range reaches into", () => {
    const start = startOfStockholmDay(new Date("2026-01-15T12:00:00.000Z"));
    const end = startOfStockholmDay(new Date("2026-04-15T12:00:00.000Z"));
    expect(enumerateBuckets(start, end, "month")).toEqual([
      "202601",
      "202602",
      "202603",
      "202604",
    ]);
  });

  it("returns [] when start is null (open-ended range)", () => {
    const end = startOfStockholmDay(new Date("2026-05-19T12:00:00.000Z"));
    expect(enumerateBuckets(null, end, "day")).toEqual([]);
    expect(enumerateBuckets(undefined, end, "day")).toEqual([]);
  });

  it("returns [] when start > end (defensive, no infinite loop)", () => {
    const start = startOfStockholmDay(new Date("2026-05-19T12:00:00.000Z"));
    const end = startOfStockholmDay(new Date("2026-05-13T12:00:00.000Z"));
    expect(enumerateBuckets(start, end, "day")).toEqual([]);
  });

  it("returns a single bucket when start == end (zero-width range)", () => {
    const d = startOfStockholmDay(new Date("2026-05-19T12:00:00.000Z"));
    expect(enumerateBuckets(d, d, "day")).toEqual(["20260519"]);
  });
});

describe("bucketKey (Stockholm civil day)", () => {
  it("buckets a late-evening UTC instant into the next Stockholm day", () => {
    // 23:30 UTC May 31 = 01:30 CEST Jun 1 in Stockholm.
    expect(bucketKey(new Date("2026-05-31T23:30:00.000Z"), "day")).toBe(
      "20260601",
    );
  });

  it("keeps an instant that is still 'yesterday' in UTC on the right Stockholm day", () => {
    // 21:00 UTC May 31 = 23:00 CEST May 31 in Stockholm.
    expect(bucketKey(new Date("2026-05-31T21:00:00.000Z"), "day")).toBe(
      "20260531",
    );
  });

  it("month key uses the Stockholm month boundary", () => {
    // 23:00 UTC May 31 = 01:00 CEST Jun 1 → June bucket.
    expect(bucketKey(new Date("2026-05-31T23:00:00.000Z"), "month")).toBe(
      "202606",
    );
    expect(
      bucketKey(
        startOfStockholmMonth(new Date("2026-06-15T12:00:00.000Z")),
        "month",
      ),
    ).toBe("202606");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_RANGE_KEY,
  formatRangeDateSpan,
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "./time-ranges";
import { toStockholmIsoDate } from "./dates";

describe("dashboard time ranges (Stockholm)", () => {
  // 2026-04-23 13:45 UTC = 15:45 Stockholm (CEST, +2) → civil day Apr 23 (Thu).
  const now = new Date("2026-04-23T13:45:00.000Z");

  it("falls back to last 30 days for invalid range values", () => {
    expect(normalizeDashboardTimeRangeKey("not_real")).toBe(
      DEFAULT_TIME_RANGE_KEY,
    );
    expect(normalizeDashboardTimeRangeKey(undefined)).toBe(
      DEFAULT_TIME_RANGE_KEY,
    );
  });

  it("resolves today as the current Stockholm day", () => {
    const range = resolveDashboardTimeRange("today", now);
    expect(toStockholmIsoDate(range.start!)).toBe("2026-04-23");
    expect(toStockholmIsoDate(range.end)).toBe("2026-04-24");
  });

  it("resolves yesterday as the previous Stockholm day", () => {
    const range = resolveDashboardTimeRange("yesterday", now);
    expect(toStockholmIsoDate(range.start!)).toBe("2026-04-22");
    expect(toStockholmIsoDate(range.end)).toBe("2026-04-23");
  });

  describe("rolling windows end YESTERDAY (N complete days)", () => {
    it("last_7_days: yesterday + 6 back, today excluded", () => {
      const range = resolveDashboardTimeRange("last_7_days", now);
      // Apr 16..Apr 22 inclusive = 7 days; end is exclusive start-of-today.
      expect(toStockholmIsoDate(range.start!)).toBe("2026-04-16");
      expect(toStockholmIsoDate(range.end)).toBe("2026-04-23");
      expect(formatRangeDateSpan(range)).toBe("2026-04-16 to 2026-04-22");
    });

    it("last_30_days ends yesterday", () => {
      const range = resolveDashboardTimeRange("last_30_days", now);
      expect(toStockholmIsoDate(range.start!)).toBe("2026-03-24");
      expect(toStockholmIsoDate(range.end)).toBe("2026-04-23");
      expect(formatRangeDateSpan(range)).toBe("2026-03-24 to 2026-04-22");
    });

    it("last_90_days ends yesterday", () => {
      const range = resolveDashboardTimeRange("last_90_days", now);
      expect(toStockholmIsoDate(range.start!)).toBe("2026-01-23");
      expect(toStockholmIsoDate(range.end)).toBe("2026-04-23");
    });
  });

  it("resolves this month to month-to-date (today included)", () => {
    const range = resolveDashboardTimeRange("this_month", now);
    expect(toStockholmIsoDate(range.start!)).toBe("2026-04-01");
    expect(toStockholmIsoDate(range.end)).toBe("2026-04-24");
  });

  it("resolves last month to the completed previous month", () => {
    const range = resolveDashboardTimeRange("last_month", now);
    expect(toStockholmIsoDate(range.start!)).toBe("2026-03-01");
    expect(toStockholmIsoDate(range.end)).toBe("2026-04-01");
  });

  it("keeps all time open-ended with a friendly first-sync label", () => {
    const range = resolveDashboardTimeRange("all_time", now);
    expect(range.start).toBeNull();
    expect(formatRangeDateSpan(range, "2026-04-20T00:00:00.000Z")).toBe(
      "Since 2026-04-20",
    );
  });

  describe("last_week (ISO Mon-Sun, Stockholm)", () => {
    // Apr 23 2026 is a Thursday → last ISO week is Mon Apr 13..Sun Apr 19.
    it("from a Thursday: returns Mon-Sun of previous ISO week", () => {
      const range = resolveDashboardTimeRange("last_week", now);
      expect(toStockholmIsoDate(range.start!)).toBe("2026-04-13"); // Monday
      expect(toStockholmIsoDate(range.end)).toBe("2026-04-20"); // exclusive next Mon
    });

    // Apr 20 2026 14:00 Stockholm is a Monday.
    it("from a Monday: returns the immediately preceding Mon-Sun", () => {
      const monday = new Date("2026-04-20T12:00:00.000Z");
      const range = resolveDashboardTimeRange("last_week", monday);
      expect(toStockholmIsoDate(range.start!)).toBe("2026-04-13");
      expect(toStockholmIsoDate(range.end)).toBe("2026-04-20");
    });

    // Apr 19 2026 14:00 Stockholm is a Sunday.
    it("from a Sunday: wraps correctly (does not include today)", () => {
      const sunday = new Date("2026-04-19T12:00:00.000Z");
      const range = resolveDashboardTimeRange("last_week", sunday);
      expect(toStockholmIsoDate(range.start!)).toBe("2026-04-06");
      expect(toStockholmIsoDate(range.end)).toBe("2026-04-13");
    });

    it("formatRangeDateSpan renders the inclusive Mon..Sun", () => {
      const range = resolveDashboardTimeRange("last_week", now);
      expect(formatRangeDateSpan(range)).toBe("2026-04-13 to 2026-04-19");
    });
  });
});

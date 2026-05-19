import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_RANGE_KEY,
  formatRangeDateSpan,
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "./time-ranges";
import { toIsoDate } from "./dates";

describe("dashboard time ranges", () => {
  const now = new Date("2026-04-23T13:45:00.000Z");

  it("falls back to last 30 days for invalid range values", () => {
    expect(normalizeDashboardTimeRangeKey("not_real")).toBe(
      DEFAULT_TIME_RANGE_KEY,
    );
    expect(normalizeDashboardTimeRangeKey(undefined)).toBe(
      DEFAULT_TIME_RANGE_KEY,
    );
  });

  it("resolves today as the current UTC day", () => {
    const range = resolveDashboardTimeRange("today", now);

    expect(toIsoDate(range.start!)).toBe("2026-04-23");
    expect(toIsoDate(range.end)).toBe("2026-04-24");
  });

  it("resolves this month to month-to-date", () => {
    const range = resolveDashboardTimeRange("this_month", now);

    expect(toIsoDate(range.start!)).toBe("2026-04-01");
    expect(toIsoDate(range.end)).toBe("2026-04-24");
  });

  it("resolves last month to the completed previous month", () => {
    const range = resolveDashboardTimeRange("last_month", now);

    expect(toIsoDate(range.start!)).toBe("2026-03-01");
    expect(toIsoDate(range.end)).toBe("2026-04-01");
  });

  it("keeps all time open-ended with a friendly first-sync label", () => {
    const range = resolveDashboardTimeRange("all_time", now);

    expect(range.start).toBeNull();
    expect(formatRangeDateSpan(range, "2026-04-20T00:00:00.000Z")).toBe(
      "Since 2026-04-20",
    );
  });

  describe("last_week (ISO Mon-Sun)", () => {
    // 2026-04-23 is a Thursday. ISO week ending Sun 2026-04-19.
    it("from a Thursday: returns Mon-Sun of previous ISO week", () => {
      const range = resolveDashboardTimeRange("last_week", now);
      expect(toIsoDate(range.start!)).toBe("2026-04-13"); // Monday
      expect(toIsoDate(range.end)).toBe("2026-04-20"); // exclusive (Mon of this week)
    });

    // 2026-04-20 was a Monday — this-week-monday = today, last-week-monday = -7
    it("from a Monday: returns the immediately preceding Mon-Sun", () => {
      const monday = new Date("2026-04-20T08:00:00.000Z");
      const range = resolveDashboardTimeRange("last_week", monday);
      expect(toIsoDate(range.start!)).toBe("2026-04-13");
      expect(toIsoDate(range.end)).toBe("2026-04-20");
    });

    // 2026-04-19 was a Sunday — getUTCDay() === 0, daysSinceMonday should be 6
    it("from a Sunday: wraps correctly (does not include today)", () => {
      const sunday = new Date("2026-04-19T23:30:00.000Z");
      const range = resolveDashboardTimeRange("last_week", sunday);
      expect(toIsoDate(range.start!)).toBe("2026-04-06");
      expect(toIsoDate(range.end)).toBe("2026-04-13");
    });

    it("never overlaps with current week (end is exclusive Mon of this week)", () => {
      const range = resolveDashboardTimeRange("last_week", now);
      const today = new Date("2026-04-23T00:00:00.000Z");
      expect(range.end.getTime()).toBeLessThanOrEqual(today.getTime());
    });

    it("formatRangeDateSpan renders the inclusive Mon..Sun", () => {
      const range = resolveDashboardTimeRange("last_week", now);
      expect(formatRangeDateSpan(range)).toBe("2026-04-13 to 2026-04-19");
    });
  });
});

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
});

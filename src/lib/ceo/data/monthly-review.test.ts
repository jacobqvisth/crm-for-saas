import { describe, expect, it } from "vitest";
import {
  defaultMonthKey,
  listMonthOptions,
  monthLabel,
  normalizeMonthKey,
} from "./monthly-review";

describe("defaultMonthKey", () => {
  // The page must never default to the month in progress. Reading a partial
  // month as if it were complete is the exact error this page exists to stop:
  // 12 days of July 2026 read as the whole month and inverted the conclusion.
  it("returns the last COMPLETED month, not the current one", () => {
    expect(defaultMonthKey(new Date("2026-08-03T11:00:00Z"))).toBe("2026-07");
    // Late on the last day of August, Stockholm time, August is still running.
    expect(defaultMonthKey(new Date("2026-08-31T21:00:00Z"))).toBe("2026-07");
  });

  it("rolls back across a year boundary", () => {
    expect(defaultMonthKey(new Date("2026-01-15T12:00:00Z"))).toBe("2025-12");
  });

  // These two pin the timezone boundary, which is easy to get backwards: the
  // month is decided in Stockholm civil time, not UTC, so a late-evening UTC
  // instant can already belong to the next month locally.
  it("uses Stockholm civil time, not UTC, at a summer month boundary", () => {
    // 23:00Z on Aug 31 is 01:00 on Sep 1 in Stockholm (UTC+2), so the last
    // completed month is August, not July.
    expect(defaultMonthKey(new Date("2026-08-31T23:00:00Z"))).toBe("2026-08");
  });

  it("uses Stockholm civil time at a winter month boundary", () => {
    // 00:30Z on Mar 1 is 01:30 on Mar 1 in Stockholm (UTC+1), so February is
    // the last completed month.
    expect(defaultMonthKey(new Date("2026-03-01T00:30:00Z"))).toBe("2026-02");
  });
});

describe("normalizeMonthKey", () => {
  const now = new Date("2026-08-03T11:00:00Z");

  it("accepts a well-formed key", () => {
    expect(normalizeMonthKey("2026-07", now)).toBe("2026-07");
    expect(normalizeMonthKey("2025-12", now)).toBe("2025-12");
  });

  it("takes the first value when the param repeats", () => {
    expect(normalizeMonthKey(["2026-05", "2026-06"], now)).toBe("2026-05");
  });

  it("falls back to the default for junk rather than throwing", () => {
    for (const bad of [
      undefined,
      "",
      "2026",
      "2026-13",
      "2026-00",
      "26-07",
      "2026-7",
      "not-a-month",
      "2026-07-15",
      "../../etc/passwd",
    ]) {
      expect(normalizeMonthKey(bad as string | undefined, now)).toBe("2026-07");
    }
  });
});

describe("listMonthOptions", () => {
  const now = new Date("2026-08-03T11:00:00Z");

  it("lists completed months newest first and excludes the current month", () => {
    const options = listMonthOptions(3, now);

    expect(options.map((o) => o.key)).toEqual(["2026-07", "2026-06", "2026-05"]);
    expect(options.map((o) => o.key)).not.toContain("2026-08");
  });

  it("produces the requested number of options with unique keys", () => {
    const options = listMonthOptions(18, now);

    expect(options).toHaveLength(18);
    expect(new Set(options.map((o) => o.key)).size).toBe(18);
  });

  it("labels every option", () => {
    for (const option of listMonthOptions(6, now)) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.label).not.toBe(option.key);
    }
  });
});

describe("monthLabel", () => {
  it("renders a human month and year", () => {
    expect(monthLabel("2026-07")).toBe("July 2026");
    expect(monthLabel("2025-01")).toBe("January 2025");
  });

  it("returns the raw key when it cannot be parsed", () => {
    expect(monthLabel("nonsense")).toBe("nonsense");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKING_DAYS,
  dayKeyForIsoDate,
  parseWorkingDays,
} from "./profile";

describe("parseWorkingDays", () => {
  it("returns defaults for null/undefined", () => {
    expect(parseWorkingDays(null)).toEqual(DEFAULT_WORKING_DAYS);
    expect(parseWorkingDays(undefined)).toEqual(DEFAULT_WORKING_DAYS);
  });

  it("returns defaults for non-object input", () => {
    expect(parseWorkingDays("nope")).toEqual(DEFAULT_WORKING_DAYS);
    expect(parseWorkingDays(42)).toEqual(DEFAULT_WORKING_DAYS);
    expect(parseWorkingDays([])).toEqual(DEFAULT_WORKING_DAYS);
  });

  it("merges partial input over defaults, ignoring non-boolean fields", () => {
    expect(
      parseWorkingDays({ mon: false, sat: true, junk: 1 }),
    ).toEqual({
      ...DEFAULT_WORKING_DAYS,
      mon: false,
      sat: true,
    });
  });
});

describe("dayKeyForIsoDate", () => {
  // 2026-05-04 was a Monday (UTC). Pick a few anchors to make the test self-checking.
  it.each([
    ["2026-05-04", "mon"],
    ["2026-05-05", "tue"],
    ["2026-05-06", "wed"],
    ["2026-05-07", "thu"],
    ["2026-05-08", "fri"],
    ["2026-05-09", "sat"],
    ["2026-05-10", "sun"],
  ])("returns %s → %s", (iso, expected) => {
    expect(dayKeyForIsoDate(iso)).toBe(expected);
  });
});

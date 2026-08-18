import { describe, it, expect } from "vitest";
import { isWithinOfficeHours, languageForCaller, matchTarget } from "./types";

describe("languageForCaller", () => {
  const both = ["sv", "en"];

  it("greets a Swedish number in Swedish", () => {
    expect(languageForCaller("+46731509080", both)).toBe("sv");
  });

  it("greets everyone else in English", () => {
    expect(languageForCaller("+358454900136", both)).toBe("en"); // Finland
    expect(languageForCaller("+4531234567", both)).toBe("en"); // Denmark
    expect(languageForCaller("+14155550123", both)).toBe("en"); // US
  });

  it("defaults to English when the number is unknown or withheld", () => {
    expect(languageForCaller(null, both)).toBe("en");
    expect(languageForCaller("", both)).toBe("en");
    expect(languageForCaller("anonymous", both)).toBe("en");
  });

  it("tolerates spaces and dashes in the number", () => {
    expect(languageForCaller("+46 73 150 90 80", both)).toBe("sv");
  });

  it("does not mistake a number that merely contains 46 for Swedish", () => {
    // Finland's +358 46… mobile prefix must not read as Sweden.
    expect(languageForCaller("+358461234567", both)).toBe("en");
  });

  it("never returns a language the agent has no greeting for", () => {
    // Swedish caller, but the switchboard only speaks English.
    expect(languageForCaller("+46731509080", ["en"])).toBe("en");
    // English caller, Swedish-only switchboard.
    expect(languageForCaller("+14155550123", ["sv"])).toBe("sv");
  });

  it("falls back to English when nothing is configured", () => {
    expect(languageForCaller("+46731509080", [])).toBe("en");
  });
});

const HOURS = { open_hour: 9, close_hour: 17, open_days: [1, 2, 3, 4, 5] };

// Stockholm is UTC+2 in August (CEST) and UTC+1 in January (CET). The tests use
// explicit UTC instants so a machine in another timezone gets the same result.
describe("isWithinOfficeHours", () => {
  it("is open mid-morning on a weekday", () => {
    // 2026-08-18 is a Monday. 08:00Z = 10:00 Stockholm.
    expect(isWithinOfficeHours(new Date("2026-08-18T08:00:00Z"), HOURS)).toBe(true);
  });

  it("is closed before opening", () => {
    // 05:00Z = 07:00 Stockholm.
    expect(isWithinOfficeHours(new Date("2026-08-18T05:00:00Z"), HOURS)).toBe(false);
  });

  it("treats the closing hour as closed", () => {
    // 15:00Z = 17:00 Stockholm, and the window is half-open.
    expect(isWithinOfficeHours(new Date("2026-08-18T15:00:00Z"), HOURS)).toBe(false);
    // 14:59Z = 16:59 Stockholm, still open.
    expect(isWithinOfficeHours(new Date("2026-08-18T14:59:00Z"), HOURS)).toBe(true);
  });

  it("is closed at the weekend", () => {
    // 2026-08-22 is a Saturday.
    expect(isWithinOfficeHours(new Date("2026-08-22T10:00:00Z"), HOURS)).toBe(false);
  });

  it("respects winter time, not a fixed offset", () => {
    // January: Stockholm is UTC+1, so 08:00Z = 09:00 local, the first open hour.
    expect(isWithinOfficeHours(new Date("2026-01-19T08:00:00Z"), HOURS)).toBe(true);
    // 07:00Z = 08:00 local, still shut.
    expect(isWithinOfficeHours(new Date("2026-01-19T07:00:00Z"), HOURS)).toBe(false);
  });

  it("honours a custom open-days set", () => {
    const weekendOnly = { ...HOURS, open_days: [6, 7] };
    expect(isWithinOfficeHours(new Date("2026-08-22T10:00:00Z"), weekendOnly)).toBe(true);
    expect(isWithinOfficeHours(new Date("2026-08-18T10:00:00Z"), weekendOnly)).toBe(false);
  });
});

const targets = [
  { label: "Jacob", aliases: ["Qvisth", "sales"], enabled: true },
  { label: "Hans", aliases: ["Markebrant"], enabled: true },
  { label: "Valdemar", aliases: ["Eklund"], enabled: false },
];

describe("matchTarget", () => {
  it("matches an exact name regardless of case", () => {
    expect(matchTarget("hans", targets)?.label).toBe("Hans");
    expect(matchTarget("  HANS  ", targets)?.label).toBe("Hans");
  });

  it("matches an alias", () => {
    expect(matchTarget("Markebrant", targets)?.label).toBe("Hans");
    expect(matchTarget("sales", targets)?.label).toBe("Jacob");
  });

  it("finds a name inside a spoken sentence", () => {
    expect(matchTarget("can I speak to Hans please", targets)?.label).toBe("Hans");
  });

  it("ignores disabled targets", () => {
    expect(matchTarget("Valdemar", targets)).toBeNull();
  });

  it("returns null rather than guessing at an unknown name", () => {
    expect(matchTarget("Henrik", targets)).toBeNull();
    expect(matchTarget("", targets)).toBeNull();
    expect(matchTarget(null, targets)).toBeNull();
  });

  it("does not match on a partial word", () => {
    // "Han" must not reach Hans: a wrong transfer is worse than asking again.
    expect(matchTarget("Han", targets)).toBeNull();
  });
});

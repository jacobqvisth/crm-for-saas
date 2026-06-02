import { describe, expect, it } from "vitest";
import {
  addStockholmDays,
  addStockholmMonths,
  addUtcDays,
  getRollingWindow,
  getStockholmParts,
  parseGa4Date,
  startOfStockholmDay,
  startOfStockholmIsoWeek,
  stockholmYearWeek,
  toIsoDate,
  toStockholmIsoDate,
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

describe("Stockholm helpers", () => {
  it("reads civil parts in Stockholm (CEST = UTC+2 in June)", () => {
    const p = getStockholmParts(new Date("2026-05-31T23:30:00.000Z"));
    expect([p.year, p.month, p.day, p.hour]).toEqual([2026, 6, 1, 1]);
  });

  it("startOfStockholmDay returns the civil midnight as a UTC instant", () => {
    // Jun 2 00:00 CEST = Jun 1 22:00 UTC.
    const start = startOfStockholmDay(new Date("2026-06-02T08:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-06-01T22:00:00.000Z");
    expect(toStockholmIsoDate(start)).toBe("2026-06-02");
  });

  it("addStockholmDays crosses a DST spring-forward boundary correctly", () => {
    // DST starts Sun 2026-03-29 in Stockholm; +1 civil day must land on the
    // next civil midnight, not drift by the lost hour.
    const d = startOfStockholmDay(new Date("2026-03-28T12:00:00.000Z"));
    expect(toStockholmIsoDate(addStockholmDays(d, 1))).toBe("2026-03-29");
    expect(toStockholmIsoDate(addStockholmDays(d, 2))).toBe("2026-03-30");
  });

  it("addStockholmMonths handles year + month overflow", () => {
    const d = startOfStockholmDay(new Date("2026-11-15T12:00:00.000Z"));
    expect(toStockholmIsoDate(addStockholmMonths(d, 2))).toBe("2027-01-01");
  });

  it("startOfStockholmIsoWeek snaps to Monday", () => {
    // 2026-06-02 is a Tuesday → ISO week Monday is 2026-06-01.
    const mon = startOfStockholmIsoWeek(new Date("2026-06-02T12:00:00.000Z"));
    expect(toStockholmIsoDate(mon)).toBe("2026-06-01");
  });

  it("stockholmYearWeek matches ISO week numbering", () => {
    // 2026-01-01 is a Thursday → ISO week 1 of 2026.
    expect(stockholmYearWeek(new Date("2026-01-01T12:00:00.000Z"))).toBe(
      "202601",
    );
    // 2026-06-01 (Mon) is ISO week 23.
    expect(stockholmYearWeek(new Date("2026-06-01T12:00:00.000Z"))).toBe(
      "202623",
    );
  });
});

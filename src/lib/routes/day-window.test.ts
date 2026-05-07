import { describe, it, expect } from "vitest";
import {
  PRODUCTIVE_DAY_SECONDS,
  VISIT_MINUTES,
  estimatedDaySeconds,
  exceedsDayWindow,
} from "./day-window";

describe("estimatedDaySeconds", () => {
  it("adds 30 min per stop to the drive total", () => {
    // 8 stops × 30 min = 240 min = 14400s. Plus 1h drive = 3600s. Total = 18000s.
    expect(estimatedDaySeconds(3600, 8)).toBe(18000);
  });

  it("returns drive seconds when there are no stops", () => {
    expect(estimatedDaySeconds(1234, 0)).toBe(1234);
  });
});

describe("exceedsDayWindow boundary", () => {
  // Using a fixed-order recompute, the rejection logic compares estimated day
  // seconds against the 7.5h cap. ≤ 7.5h passes; anything strictly above rejects.

  it("allows exactly the boundary (7.5h day)", () => {
    expect(PRODUCTIVE_DAY_SECONDS).toBe(7.5 * 3600);
    const exactBoundary = PRODUCTIVE_DAY_SECONDS;
    expect(exceedsDayWindow(exactBoundary)).toBe(false);
  });

  it("rejects one second over the boundary", () => {
    expect(exceedsDayWindow(PRODUCTIVE_DAY_SECONDS + 1)).toBe(true);
  });

  it("allows a comfortably short day", () => {
    expect(exceedsDayWindow(estimatedDaySeconds(3600, 5))).toBe(false);
  });

  it("rejects a very long day", () => {
    // 6h drive + 8 stops × 30min visit = 6h + 4h = 10h → over 7.5h cap
    expect(exceedsDayWindow(estimatedDaySeconds(6 * 3600, 8))).toBe(true);
  });

  it("VISIT_MINUTES is 30 (matches generator constant)", () => {
    expect(VISIT_MINUTES).toBe(30);
  });
});

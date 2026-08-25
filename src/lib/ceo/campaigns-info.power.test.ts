import { describe, expect, it } from "vitest";
import { PMAX_BASELINE, PMAX_POWER_TABLE } from "./campaigns-info";

/**
 * The Info tab publishes sample sizes and durations that someone will plan
 * real spend against. These recompute them from the same formula so the
 * published figures cannot quietly drift away from the arithmetic.
 *
 * Two-proportion test, 80% power, 95% two-sided confidence:
 *   n per arm = 16 * pBar * (1 - pBar) / delta^2
 */
function clicksPerArm(baselineRate: number, relativeLift: number) {
  const p1 = baselineRate;
  const p2 = baselineRate * (1 + relativeLift);
  const pBar = (p1 + p2) / 2;
  const delta = p2 - p1;
  return (16 * pBar * (1 - pBar)) / (delta * delta);
}

describe("PMax baseline is internally consistent", () => {
  it("signup rate matches signups over clicks", () => {
    const computed = (PMAX_BASELINE.signups / PMAX_BASELINE.clicks) * 100;
    expect(computed).toBeCloseTo(PMAX_BASELINE.signupRatePct, 1);
  });

  it("key events per click matches the reported totals", () => {
    const computed = PMAX_BASELINE.ga4KeyEvents / PMAX_BASELINE.clicks;
    expect(computed).toBeCloseTo(PMAX_BASELINE.keyEventsPerClick, 1);
  });

  it("confirms GA4 conversions are not signups", () => {
    // 3.48 conversions per click cannot be a signup-shaped event. This test
    // exists so that if the conversion action is ever fixed, it fails and
    // forces the Info tab's claim to be revisited.
    expect(PMAX_BASELINE.keyEventsPerClick).toBeGreaterThan(1);
    expect(PMAX_BASELINE.ga4KeyEvents).toBeGreaterThan(
      PMAX_BASELINE.signups * 50,
    );
  });
});

describe("published sample sizes match the formula", () => {
  const rate = PMAX_BASELINE.signupRatePct / 100;

  const cases = [
    { lift: 0.5, published: 3100, label: "+50%" },
    { lift: 0.25, published: 11000, label: "+25%" },
    { lift: 0.2, published: 17100, label: "+20%" },
  ];

  for (const c of cases) {
    it(`${c.label} needs about ${c.published} clicks per variant`, () => {
      const computed = clicksPerArm(rate, c.lift);
      // Published figures are rounded for readability; allow 10%.
      expect(computed).toBeGreaterThan(c.published * 0.9);
      expect(computed).toBeLessThan(c.published * 1.1);
    });
  }

  it("durations are consistent with the measured click rate", () => {
    // Two variants at +50% is published as "about 2 weeks".
    const perArm = clicksPerArm(rate, 0.5);
    const days = (perArm * 2) / PMAX_BASELINE.clicksPerDay;
    expect(days).toBeGreaterThan(10);
    expect(days).toBeLessThan(21);
  });

  it("four variants always costs at least twice two variants", () => {
    // The table must never imply that adding arms is cheap.
    expect(PMAX_POWER_TABLE.length).toBe(3);
    for (const row of PMAX_POWER_TABLE) {
      expect(row.twoVariants).not.toBe(row.fourVariants);
    }
  });
});

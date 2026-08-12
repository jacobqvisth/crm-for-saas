import { describe, expect, it } from "vitest";
import {
  CAC_LTV_TIERS,
  DEFAULT_ASSUMPTIONS,
  DEFAULT_GROWTH,
  affordableCostPerSignup,
  blendTiers,
  mixEconomics,
  simulateGrowth,
  type GrowthInputs,
  breakEvenMonths,
  cacPerCustomer,
  computeTierEconomics,
  cumulativeGrossProfit,
  maxSurvivableChurnPct,
  requiredConversionPct,
  type CacLtvAssumptions,
} from "./cac-ltv-shared";

const SMALL = CAC_LTV_TIERS.find((tier) => tier.key === "small")!;

function assumptions(overrides: Partial<CacLtvAssumptions> = {}): CacLtvAssumptions {
  return { ...DEFAULT_ASSUMPTIONS, ...overrides };
}

describe("cacPerCustomer", () => {
  it("divides cost per signup by the conversion rate", () => {
    // The whole point of the page: 100 kr per registration at 3.5% conversion
    // is a CAC of ~2,857 kr per payer, not 100 kr.
    expect(cacPerCustomer(100, 3.5)).toBeCloseTo(2857.14, 1);
    expect(cacPerCustomer(100, 100)).toBe(100);
  });

  it("is infinite when nothing converts", () => {
    expect(cacPerCustomer(100, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("cumulativeGrossProfit", () => {
  it("is a plain multiple when churn is zero", () => {
    expect(cumulativeGrossProfit(600, 0, 10)).toBe(6000);
  });

  it("converges on LTV rather than growing without bound", () => {
    // With 5% monthly churn the ceiling is 600 / 0.05 = 12,000.
    expect(cumulativeGrossProfit(600, 5, 1200)).toBeCloseTo(12000, 0);
    expect(cumulativeGrossProfit(600, 5, 10_000)).toBeLessThanOrEqual(12000);
  });

  it("charges the first month in full", () => {
    expect(cumulativeGrossProfit(600, 5, 1)).toBeCloseTo(600, 6);
  });

  it("returns nothing before any month has elapsed", () => {
    expect(cumulativeGrossProfit(600, 5, 0)).toBe(0);
  });
});

describe("breakEvenMonths", () => {
  it("matches the naive payback when nobody churns", () => {
    expect(breakEvenMonths(3000, 600, 0)).toBeCloseTo(5, 6);
  });

  it("takes longer than the naive payback once customers leave", () => {
    const naive = 3000 / 600;
    const real = breakEvenMonths(3000, 600, 5);
    expect(real).not.toBeNull();
    expect(real!).toBeGreaterThan(naive);
  });

  it("inverts cumulativeGrossProfit", () => {
    const months = breakEvenMonths(3000, 600, 5)!;
    expect(cumulativeGrossProfit(600, 5, months)).toBeCloseTo(3000, 4);
  });

  it("returns null when CAC reaches the LTV ceiling", () => {
    // LTV = 600 / 0.05 = 12,000. At or above that, no patience repays it.
    expect(breakEvenMonths(12_000, 600, 5)).toBeNull();
    expect(breakEvenMonths(20_000, 600, 5)).toBeNull();
  });

  it("returns null when there is no gross profit to collect", () => {
    expect(breakEvenMonths(3000, 0, 5)).toBeNull();
    expect(breakEvenMonths(3000, -50, 5)).toBeNull();
  });

  it("is already repaid at a zero CAC", () => {
    expect(breakEvenMonths(0, 600, 5)).toBe(0);
  });

  it("treats an unreachable CAC as never", () => {
    expect(breakEvenMonths(Number.POSITIVE_INFINITY, 600, 5)).toBeNull();
  });
});

describe("computeTierEconomics", () => {
  const observed = { vehiclesPerMonth: 4.2, aiCostPerMonthSek: 0.2, payingNow: 27 };

  it("derives margin from cost rather than taking it as an input", () => {
    const tier = computeTierEconomics(SMALL, assumptions(), observed);
    // 749 net ARPA, minus 4.2 vehicles x 15 kr, 1.5% + 1.8 kr Stripe, 0.2 AI.
    const expectedVariable = 0.2 + 4.2 * 15 + (749 * 1.5) / 100 + 1.8;
    expect(tier.netArpaSek).toBe(749);
    expect(tier.variableCostSek).toBeCloseTo(expectedVariable, 6);
    expect(tier.grossProfitSek).toBeCloseTo(749 - expectedVariable, 6);
    expect(tier.grossMarginPct).toBeCloseTo(((749 - expectedVariable) / 749) * 100, 6);
  });

  it("applies the discount to list price", () => {
    const tier = computeTierEconomics(SMALL, assumptions({ discountPct: 20 }), observed);
    expect(tier.netArpaSek).toBeCloseTo(749 * 0.8, 6);
  });

  it("keeps LTV equal to gross profit over churn", () => {
    const tier = computeTierEconomics(SMALL, assumptions({ monthlyChurnPct: 5 }), observed);
    expect(tier.ltvSek).toBeCloseTo(tier.grossProfitSek / 0.05, 6);
  });

  it("reports a slower break-even than the naive payback it also reports", () => {
    const tier = computeTierEconomics(SMALL, assumptions(), observed);
    expect(tier.naivePaybackMonths).not.toBeNull();
    expect(tier.breakEvenMonths).not.toBeNull();
    expect(tier.breakEvenMonths!).toBeGreaterThan(tier.naivePaybackMonths!);
  });

  it("goes unprofitable when premium data cost eats the price", () => {
    // 4.2 vehicles at 200 kr each is 840 kr against a 749 kr price.
    const tier = computeTierEconomics(
      SMALL,
      assumptions({ perVehicleDataCostSek: 200 }),
      observed,
    );
    expect(tier.grossProfitSek).toBeLessThan(0);
    expect(tier.breakEvenMonths).toBeNull();
  });

  it("never repays a CAC above LTV", () => {
    const tier = computeTierEconomics(
      SMALL,
      assumptions({ cacPerSignupSek: 400, signupToPaidPct: 1, monthlyChurnPct: 20 }),
      observed,
    );
    expect(tier.cacPerCustomerSek).toBeCloseTo(40_000, 6);
    expect(tier.ltvCac).toBeLessThan(1);
    expect(tier.breakEvenMonths).toBeNull();
  });
});

describe("blendTiers", () => {
  const build = (overrides: Partial<CacLtvAssumptions> = {}) =>
    CAC_LTV_TIERS.map((tier) =>
      computeTierEconomics(tier, assumptions(overrides), {
        vehiclesPerMonth: 4,
        aiCostPerMonthSek: 0.2,
        payingNow: tier.key === "small" ? 30 : tier.key === "one" ? 10 : 5,
      }),
    );

  it("weights ARPA by paying customers, not by tier count", () => {
    const tiers = build();
    const blend = blendTiers(tiers, assumptions())!;
    const expected = (179 * 10 + 749 * 30 + 1799 * 5) / 45;
    expect(blend.netArpaSek).toBeCloseTo(expected, 6);
    expect(blend.payingNow).toBe(45);
  });

  it("sits between the cheapest and dearest tier", () => {
    const tiers = build();
    const blend = blendTiers(tiers, assumptions())!;
    expect(blend.netArpaSek).toBeGreaterThan(179);
    expect(blend.netArpaSek).toBeLessThan(1799);
  });

  it("returns null when nobody is paying", () => {
    const tiers = CAC_LTV_TIERS.map((tier) =>
      computeTierEconomics(tier, assumptions(), {
        vehiclesPerMonth: 0,
        aiCostPerMonthSek: 0,
        payingNow: 0,
      }),
    );
    expect(blendTiers(tiers, assumptions())).toBeNull();
  });
});

describe("maxSurvivableChurnPct", () => {
  it("is the churn where LTV exactly equals CAC", () => {
    // 600 gross profit against a 3,000 CAC breaks even for life at 20% churn.
    expect(maxSurvivableChurnPct(3000, 600)).toBeCloseTo(20, 6);
    const atCeiling = breakEvenMonths(3000, 600, 20);
    expect(atCeiling).toBeNull();
    expect(breakEvenMonths(3000, 600, 19.9)).not.toBeNull();
  });

  it("is zero when there is no gross profit", () => {
    expect(maxSurvivableChurnPct(3000, 0)).toBe(0);
  });

  it("caps at 100%", () => {
    expect(maxSurvivableChurnPct(10, 600)).toBe(100);
  });
});

describe("simulateGrowth", () => {
  const vehicles = { one: 1, small: 4.3, large: 8.1 };
  const growth = (overrides: Partial<GrowthInputs> = {}): GrowthInputs => ({
    ...DEFAULT_GROWTH,
    ...overrides,
  });

  it("turns budget into signups via cost per signup", () => {
    const result = simulateGrowth(
      growth({ monthlyBudgetSek: 50_000 }),
      assumptions({ cacPerSignupSek: 100 }),
      vehicles,
      0.35,
    );
    expect(result.signupsPerMonth).toBeCloseTo(500, 6);
  });

  it("dilutes signups into payers by the conversion rate", () => {
    const result = simulateGrowth(
      growth({ monthlyBudgetSek: 50_000 }),
      assumptions({ cacPerSignupSek: 100, signupToPaidPct: 3.4 }),
      vehicles,
      0.35,
    );
    // 500 signups a month buys 17 payers and 483 permanent free accounts.
    expect(result.newPayersPerMonth).toBeCloseTo(17, 6);
    expect(result.rows[0].freeAdded).toBeCloseTo(483, 6);
  });

  it("holds payers back by the conversion lag", () => {
    const result = simulateGrowth(
      growth({ conversionLagMonths: 2, horizonMonths: 6 }),
      assumptions(),
      vehicles,
      0.35,
    );
    expect(result.rows[0].newPayers).toBe(0);
    expect(result.rows[1].newPayers).toBe(0);
    expect(result.rows[2].newPayers).toBeGreaterThan(0);
  });

  it("asymptotes on newPayers/churn instead of growing linearly", () => {
    const churnPct = 5;
    const result = simulateGrowth(
      growth({ horizonMonths: 240, monthlyBudgetSek: 50_000 }),
      assumptions({ cacPerSignupSek: 100, signupToPaidPct: 3.4, monthlyChurnPct: churnPct }),
      vehicles,
      0.35,
    );
    const expectedCeiling = result.newPayersPerMonth / (churnPct / 100);
    expect(result.steadyStatePayers).toBeCloseTo(expectedCeiling, 6);
    // The base converges on the ceiling and never passes it.
    expect(result.endPayers).toBeLessThanOrEqual(expectedCeiling + 1e-6);
    expect(result.endPayers).toBeCloseTo(expectedCeiling, 2);
  });

  it("doubling the horizon past steady state adds almost no payers", () => {
    const base = assumptions({ cacPerSignupSek: 100, signupToPaidPct: 3.4, monthlyChurnPct: 5 });
    const short = simulateGrowth(growth({ horizonMonths: 120 }), base, vehicles, 0.35);
    const long = simulateGrowth(growth({ horizonMonths: 240 }), base, vehicles, 0.35);
    // Doubling 120 months to 240 adds under 1% of the ceiling — that flatness is
    // the whole point, so assert it against the ceiling rather than an absolute.
    const gain = (long.endPayers - short.endPayers) / long.steadyStatePayers;
    expect(gain).toBeLessThan(0.01);
    // But spend keeps accruing, so cost per retained payer gets worse.
    expect(long.costPerRetainedPayerSek).toBeGreaterThan(short.costPerRetainedPayerSek);
  });

  it("never reaches payback when the mix has no gross profit", () => {
    const result = simulateGrowth(
      growth({ horizonMonths: 36 }),
      assumptions({ perVehicleDataCostSek: 500 }),
      vehicles,
      0.35,
    );
    expect(result.newMixGrossProfitSek).toBeLessThan(0);
    expect(result.paybackMonth).toBeNull();
  });

  it("reaches payback and keeps cumulative net rising after it", () => {
    const result = simulateGrowth(
      growth({ horizonMonths: 60, monthlyBudgetSek: 35_000 }),
      assumptions({ cacPerSignupSek: 100, signupToPaidPct: 3.4, monthlyChurnPct: 5 }),
      vehicles,
      0.35,
    );
    expect(result.paybackMonth).not.toBeNull();
    const at = result.rows[result.paybackMonth! - 1];
    expect(at.cumulativeNetSek).toBeGreaterThanOrEqual(0);
    // The month before payback must still be negative.
    expect(result.rows[result.paybackMonth! - 2].cumulativeNetSek).toBeLessThan(0);
  });

  it("scales linearly with budget at fixed cost per signup", () => {
    const base = assumptions({ cacPerSignupSek: 100 });
    const a = simulateGrowth(growth({ monthlyBudgetSek: 20_000 }), base, vehicles, 0.35);
    const b = simulateGrowth(growth({ monthlyBudgetSek: 40_000 }), base, vehicles, 0.35);
    expect(b.steadyStatePayers).toBeCloseTo(a.steadyStatePayers * 2, 6);
  });

  it("a cheaper signup buys proportionally more payers for the same budget", () => {
    const g = growth({ monthlyBudgetSek: 50_000 });
    const dear = simulateGrowth(g, assumptions({ cacPerSignupSek: 120 }), vehicles, 0.35);
    const cheap = simulateGrowth(g, assumptions({ cacPerSignupSek: 60 }), vehicles, 0.35);
    expect(cheap.newPayersPerMonth).toBeCloseTo(dear.newPayersPerMonth * 2, 6);
  });

  it("produces no growth on a zero budget", () => {
    const result = simulateGrowth(growth({ monthlyBudgetSek: 0 }), assumptions(), vehicles, 0.35);
    expect(result.signupsPerMonth).toBe(0);
    expect(result.endPayers).toBe(0);
    expect(result.endMrrSek).toBe(0);
  });
});

describe("mixEconomics", () => {
  const vehicles = { one: 1, small: 4.3, large: 8.1 };

  it("normalises shares that do not sum to 100", () => {
    const a = mixEconomics({ one: 1, small: 1, large: 0 }, assumptions(), vehicles, 0.35);
    const b = mixEconomics({ one: 50, small: 50, large: 0 }, assumptions(), vehicles, 0.35);
    expect(a.arpaSek).toBeCloseTo(b.arpaSek, 6);
  });

  it("weights a One-heavy mix far below a Large-heavy one", () => {
    const oneHeavy = mixEconomics({ one: 90, small: 10, large: 0 }, assumptions(), vehicles, 0.35);
    const largeHeavy = mixEconomics({ one: 0, small: 10, large: 90 }, assumptions(), vehicles, 0.35);
    expect(oneHeavy.grossProfitSek).toBeLessThan(largeHeavy.grossProfitSek);
  });

  it("returns zeros for an empty mix rather than dividing by zero", () => {
    const result = mixEconomics({ one: 0, small: 0, large: 0 }, assumptions(), vehicles, 0.35);
    expect(result.arpaSek).toBe(0);
    expect(result.grossProfitSek).toBe(0);
  });
});

describe("affordableCostPerSignup", () => {
  it("is the cost per signup that lands exactly on the target ratio", () => {
    const affordable = affordableCostPerSignup(600, 5, 3.5, 3)!;
    const cac = cacPerCustomer(affordable, 3.5);
    expect((600 / 0.05) / cac).toBeCloseTo(3, 6);
  });

  it("scales with conversion: doubling conversion doubles what you can bid", () => {
    const low = affordableCostPerSignup(600, 5, 3, 3)!;
    const high = affordableCostPerSignup(600, 5, 6, 3)!;
    expect(high).toBeCloseTo(low * 2, 6);
  });

  it("gives a cheap tier a far smaller budget than a dear one", () => {
    // This is the One-versus-Small spread the page is built to surface.
    const one = affordableCostPerSignup(159, 5, 3.4, 3)!;
    const large = affordableCostPerSignup(1650, 5, 3.4, 3)!;
    expect(one).toBeLessThan(large);
    expect(large / one).toBeCloseTo(1650 / 159, 4);
  });

  it("returns null when there is nothing to spend against", () => {
    expect(affordableCostPerSignup(0, 5, 3.5, 3)).toBeNull();
    expect(affordableCostPerSignup(600, 0, 3.5, 3)).toBeNull();
    expect(affordableCostPerSignup(600, 5, 0, 3)).toBeNull();
  });

  it("is the inverse of requiredConversionPct", () => {
    // Spending exactly the affordable amount should require exactly the
    // conversion we assumed.
    const affordable = affordableCostPerSignup(600, 5, 3.5, 3)!;
    expect(requiredConversionPct(affordable, 600, 5, 3)).toBeCloseTo(3.5, 6);
  });
});

describe("requiredConversionPct", () => {
  it("finds the conversion that hits the target ratio", () => {
    const needed = requiredConversionPct(100, 600, 5, 3)!;
    // At that conversion the resulting LTV:CAC should be exactly 3.
    const cac = cacPerCustomer(100, needed);
    expect((600 / 0.05) / cac).toBeCloseTo(3, 6);
  });

  it("returns null when there is no profit to earn a ratio on", () => {
    expect(requiredConversionPct(100, 0, 5, 3)).toBeNull();
    expect(requiredConversionPct(100, 600, 0, 3)).toBeNull();
  });
});

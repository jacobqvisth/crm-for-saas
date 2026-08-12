// CAC / LTV model (/dashboard/cac-ltv).
//
// Built from the CEO's WrenchLane_Growth_Profitability_Model_v3.xlsx, which is
// an empty template: 6 acquisition channels x 24 months of blank input cells,
// plus an Economics Assumptions sheet and a Channel Economics sheet that
// derive CAC, LTV, LTV:CAC and payback from them.
//
// The question it is built to answer, in the CEO's words:
//   "Om ni har 100kr per reggad kund, när blir den lönsam?"
//   (If you pay 100 SEK per registered customer, when does it turn profitable?)
//
// This module holds the client-safe half: the types, the default assumptions,
// and the model arithmetic as pure functions. Everything that reads the
// warehouse lives in src/lib/ceo/data/cac-ltv.ts, because this file is
// imported by a "use client" component.
//
// ---------------------------------------------------------------------------
// Two things the spreadsheet gets wrong, corrected here
// ---------------------------------------------------------------------------
//
// 1. Rows 9 and 10 of 'Economics Assumptions' have their formulas swapped
//    against their labels. B10 is labelled "Monthly logo churn" but computes
//    =B8/B6 (gross profit / net ARPA), which is the GROSS MARGIN. B9 is
//    labelled "Gross margin" and is a blank manual input. The LTV formula on
//    row 11 (=B6*B10/B9) therefore only produces ARPA x margin / churn if you
//    type the churn rate into the cell labelled "Gross margin". Anyone filling
//    the sheet as labelled gets LTV upside down. Here: gross margin is
//    derived, churn is the input.
//
// 2. 'Channel Economics' column M computes payback as CAC / monthly gross
//    profit. That assumes the customer never leaves, so it always returns a
//    finite payback even when the customer is unprofitable for life. With
//    monthly churn c, a cohort only ever pays back
//    grossProfit / c in total (that IS the LTV), so any CAC at or above that
//    never pays back at all. `breakEvenMonths` below solves the survival-
//    weighted version and returns null for "never". Both are shown on the
//    page, because the gap between them is the entire risk.
//
// ---------------------------------------------------------------------------
// Product model
// ---------------------------------------------------------------------------
//
// Every signup lands on Free — there is no direct paid signup. Upgrading to
// One/Small/Large starts a 14-day card-required trial; cancelling reverts the
// workshop to Free. So the spreadsheet's "ONE Trials" / "Small Trials"
// columns, which model a direct trial funnel running alongside the Free
// funnel, describe a flow WrenchLane does not have. There is one funnel:
//
//   traffic -> signup (Free) -> checkout started -> trial -> paying
//
// "Reggad kund" in the CEO's question is the signup step.

export const CAC_LTV_CURRENCY = "SEK";

// Plan tiers, in ladder order. Prices are the SEK list prices shown on
// app.wrenchlane.com/pricing (ex VAT), cross-checked against the Stripe price
// ids in dashboard_subscriptions. Stripe stores the unit amount in the price's
// default currency (19 / 79 / 195), NOT in the customer's billing currency, so
// dashboard_subscriptions.mrr_amount_cents must never be read as SEK — that is
// why list price is the anchor here.
// `includedVehicles` is the plan's contractual premium-data allowance, used as
// a fallback when too few workshop-months of real usage exist to average (see
// MIN_VEHICLE_SAMPLE). One's allowance is 1 vehicle; Small 20; Large 80.
export const CAC_LTV_TIERS = [
  { key: "one", label: "One", listPriceSek: 179, includedVehicles: 1 },
  { key: "small", label: "Small", listPriceSek: 749, includedVehicles: 20 },
  { key: "large", label: "Large", listPriceSek: 1799, includedVehicles: 80 },
] as const;

/**
 * Workshop-months of premium-data usage a tier needs before its average is
 * allowed to drive the model.
 *
 * On 2026-08-11 the One tier had exactly ONE workshop-month on record, and it
 * was an outlier: 14 vehicle opens on a plan that entitles 1. Averaging that
 * single row put One's variable cost above its 179 kr price, so One rendered as
 * structurally loss-making and dragged the blended gross profit down ~6% — a
 * company-level conclusion resting on one row. Below this threshold the page
 * falls back to the plan's own allowance and labels the figure as estimated.
 */
export const MIN_VEHICLE_SAMPLE = 5;

export type CacLtvTierKey = (typeof CAC_LTV_TIERS)[number]["key"];

// ---------------------------------------------------------------------------
// Assumptions — everything the warehouse cannot tell us
// ---------------------------------------------------------------------------

export type CacLtvAssumptions = {
  /** CAC per registered customer (per signup). The CEO's question sets 100. */
  cacPerSignupSek: number;
  /** Signup -> paying conversion, %. Seeded from mature workshop cohorts. */
  signupToPaidPct: number;
  /** Monthly logo churn of PAYING customers, %. The load-bearing unknown. */
  monthlyChurnPct: number;
  /** Average realized discount off list, %. */
  discountPct: number;
  /**
   * Cost of one premium vehicle data lookup (InfoPro / Motor), SEK. A supplier
   * contract cost that exists in no table we sync. It is the largest single
   * hole in the model: it scales with usage and it sets the gross margin that
   * multiplies LTV.
   */
  perVehicleDataCostSek: number;
  /** Stripe variable fee, % of net ARPA. */
  stripeFeePct: number;
  /** Stripe fixed fee per charge, SEK. */
  stripeFeeFixedSek: number;
  /** SEK per USD. Google Ads spend and AI cost arrive in USD. */
  sekPerUsd: number;
};

export const DEFAULT_ASSUMPTIONS: CacLtvAssumptions = {
  cacPerSignupSek: 100,
  // 2026-05 cohort 3.4%, 2026-06 cohort 3.8%. Later cohorts still have trials
  // in flight so they read lower for age reasons, not quality reasons.
  signupToPaidPct: 3.5,
  // NOT measured — see churnEvidence on the loaded data. 5%/month is the
  // optimistic-but-defensible SMB SaaS placeholder the page argues against.
  monthlyChurnPct: 5,
  discountPct: 0,
  // Unknown. 15 SEK/vehicle is a placeholder chosen only so the margin line
  // is not silently 100%. Replace with the supplier rate.
  perVehicleDataCostSek: 15,
  stripeFeePct: 1.5,
  stripeFeeFixedSek: 1.8,
  sekPerUsd: 9.6,
};

// Bounds for the on-page sliders.
export const ASSUMPTION_BOUNDS: Record<
  keyof CacLtvAssumptions,
  { min: number; max: number; step: number; label: string; unit: string }
> = {
  cacPerSignupSek: { min: 0, max: 500, step: 5, label: "CAC per registered customer", unit: "SEK" },
  signupToPaidPct: { min: 0.5, max: 25, step: 0.1, label: "Signup → paying", unit: "%" },
  monthlyChurnPct: { min: 1, max: 30, step: 0.5, label: "Monthly logo churn", unit: "%" },
  discountPct: { min: 0, max: 50, step: 1, label: "Average discount", unit: "%" },
  perVehicleDataCostSek: { min: 0, max: 120, step: 1, label: "Premium data / vehicle", unit: "SEK" },
  stripeFeePct: { min: 0, max: 5, step: 0.1, label: "Stripe fee", unit: "%" },
  stripeFeeFixedSek: { min: 0, max: 10, step: 0.1, label: "Stripe fixed fee", unit: "SEK" },
  sekPerUsd: { min: 7, max: 13, step: 0.1, label: "SEK per USD", unit: "SEK" },
};

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

export type TierEconomics = {
  key: CacLtvTierKey;
  label: string;
  listPriceSek: number;
  netArpaSek: number;
  /** Observed premium vehicle lookups per paying workshop per month. */
  vehiclesPerMonth: number;
  aiCostSek: number;
  dataCostSek: number;
  paymentFeeSek: number;
  variableCostSek: number;
  grossProfitSek: number;
  grossMarginPct: number;
  /** CAC per PAYING customer = CAC per signup / signup-to-paid rate. */
  cacPerCustomerSek: number;
  /** Gross-profit LTV = monthly gross profit / monthly churn. */
  ltvSek: number;
  ltvCac: number;
  /** CAC / monthly gross profit. Ignores churn — the spreadsheet's number. */
  naivePaybackMonths: number | null;
  /** Survival-weighted break-even. null = never pays back. */
  breakEvenMonths: number | null;
  /** Paying customers on this tier right now. */
  payingNow: number;
};

/**
 * CAC per paying customer implied by a cost per registered customer.
 *
 * This is the step the CEO's question turns on: 100 SEK per signup is not a
 * 100 SEK CAC. At a 3.5% signup-to-paid rate you buy ~29 signups per payer, so
 * the real CAC is ~2,857 SEK.
 */
export function cacPerCustomer(cacPerSignupSek: number, signupToPaidPct: number): number {
  if (signupToPaidPct <= 0) return Number.POSITIVE_INFINITY;
  return cacPerSignupSek / (signupToPaidPct / 100);
}

/**
 * Cumulative expected gross profit per acquired customer after `months`,
 * discounting each month by the chance the customer is still there.
 *
 * With monthly churn c, survival into month t is (1-c)^(t-1), so the sum is a
 * geometric series: grossProfit * (1 - (1-c)^n) / c. As n grows this converges
 * on grossProfit / c, which is the LTV — that convergence is why a CAC above
 * LTV can never be repaid no matter how long you wait.
 */
export function cumulativeGrossProfit(
  monthlyGrossProfitSek: number,
  monthlyChurnPct: number,
  months: number,
): number {
  const churn = monthlyChurnPct / 100;
  if (months <= 0) return 0;
  if (churn <= 0) return monthlyGrossProfitSek * months;
  return (monthlyGrossProfitSek * (1 - Math.pow(1 - churn, months))) / churn;
}

/**
 * Months until cumulative survival-weighted gross profit repays CAC.
 * Returns null when CAC is at or above LTV, i.e. it never repays.
 */
export function breakEvenMonths(
  cacSek: number,
  monthlyGrossProfitSek: number,
  monthlyChurnPct: number,
): number | null {
  if (!Number.isFinite(cacSek)) return null;
  if (cacSek <= 0) return 0;
  if (monthlyGrossProfitSek <= 0) return null;

  const churn = monthlyChurnPct / 100;
  if (churn <= 0) return cacSek / monthlyGrossProfitSek;

  const ltv = monthlyGrossProfitSek / churn;
  if (cacSek >= ltv) return null;

  // Solve grossProfit * (1-(1-c)^n)/c = cac for n.
  return Math.log(1 - (cacSek * churn) / monthlyGrossProfitSek) / Math.log(1 - churn);
}

export function computeTierEconomics(
  tier: (typeof CAC_LTV_TIERS)[number],
  assumptions: CacLtvAssumptions,
  observed: { vehiclesPerMonth: number; aiCostPerMonthSek: number; payingNow: number },
): TierEconomics {
  const netArpaSek = tier.listPriceSek * (1 - assumptions.discountPct / 100);
  const dataCostSek = observed.vehiclesPerMonth * assumptions.perVehicleDataCostSek;
  const paymentFeeSek =
    (netArpaSek * assumptions.stripeFeePct) / 100 + assumptions.stripeFeeFixedSek;
  const variableCostSek = observed.aiCostPerMonthSek + dataCostSek + paymentFeeSek;
  const grossProfitSek = netArpaSek - variableCostSek;
  const grossMarginPct = netArpaSek > 0 ? (grossProfitSek / netArpaSek) * 100 : 0;

  const cacSek = cacPerCustomer(assumptions.cacPerSignupSek, assumptions.signupToPaidPct);
  const churn = assumptions.monthlyChurnPct / 100;
  const ltvSek = churn > 0 ? grossProfitSek / churn : Number.POSITIVE_INFINITY;

  return {
    key: tier.key,
    label: tier.label,
    listPriceSek: tier.listPriceSek,
    netArpaSek,
    vehiclesPerMonth: observed.vehiclesPerMonth,
    aiCostSek: observed.aiCostPerMonthSek,
    dataCostSek,
    paymentFeeSek,
    variableCostSek,
    grossProfitSek,
    grossMarginPct,
    cacPerCustomerSek: cacSek,
    ltvSek,
    ltvCac: cacSek > 0 && Number.isFinite(cacSek) ? ltvSek / cacSek : 0,
    naivePaybackMonths: grossProfitSek > 0 ? cacSek / grossProfitSek : null,
    breakEvenMonths: breakEvenMonths(cacSek, grossProfitSek, assumptions.monthlyChurnPct),
    payingNow: observed.payingNow,
  };
}

/**
 * Plan-mix-weighted blend across tiers, weighted by paying customers today.
 * This is the number to judge "is the company profitable at this CAC", because
 * a CAC is paid per customer acquired, not per tier.
 */
export function blendTiers(
  tiers: TierEconomics[],
  assumptions: CacLtvAssumptions,
): TierEconomics | null {
  const totalPaying = tiers.reduce((sum, tier) => sum + tier.payingNow, 0);
  if (totalPaying <= 0) return null;

  const weighted = (pick: (tier: TierEconomics) => number) =>
    tiers.reduce((sum, tier) => sum + pick(tier) * tier.payingNow, 0) / totalPaying;

  const netArpaSek = weighted((tier) => tier.netArpaSek);
  const variableCostSek = weighted((tier) => tier.variableCostSek);
  const grossProfitSek = netArpaSek - variableCostSek;
  const cacSek = cacPerCustomer(assumptions.cacPerSignupSek, assumptions.signupToPaidPct);
  const churn = assumptions.monthlyChurnPct / 100;
  const ltvSek = churn > 0 ? grossProfitSek / churn : Number.POSITIVE_INFINITY;

  return {
    key: "small",
    label: "Blended",
    listPriceSek: weighted((tier) => tier.listPriceSek),
    netArpaSek,
    vehiclesPerMonth: weighted((tier) => tier.vehiclesPerMonth),
    aiCostSek: weighted((tier) => tier.aiCostSek),
    dataCostSek: weighted((tier) => tier.dataCostSek),
    paymentFeeSek: weighted((tier) => tier.paymentFeeSek),
    variableCostSek,
    grossProfitSek,
    grossMarginPct: netArpaSek > 0 ? (grossProfitSek / netArpaSek) * 100 : 0,
    cacPerCustomerSek: cacSek,
    ltvSek,
    ltvCac: cacSek > 0 && Number.isFinite(cacSek) ? ltvSek / cacSek : 0,
    naivePaybackMonths: grossProfitSek > 0 ? cacSek / grossProfitSek : null,
    breakEvenMonths: breakEvenMonths(cacSek, grossProfitSek, assumptions.monthlyChurnPct),
    payingNow: totalPaying,
  };
}

/**
 * The churn rate at which a given CAC stops ever paying back: the point where
 * LTV equals CAC. Above it the customer is bought at a loss for life.
 * Returned as a percentage.
 */
export function maxSurvivableChurnPct(
  cacSek: number,
  monthlyGrossProfitSek: number,
): number {
  if (cacSek <= 0 || !Number.isFinite(cacSek)) return 100;
  if (monthlyGrossProfitSek <= 0) return 0;
  return Math.min(100, (monthlyGrossProfitSek / cacSek) * 100);
}

/**
 * The signup-to-paid rate a given cost per signup needs in order to hit a
 * target LTV:CAC. The internal-optimisation counterpart to the question:
 * instead of "what CAC can we afford", "what conversion do we have to earn".
 */
export function requiredConversionPct(
  cacPerSignupSek: number,
  monthlyGrossProfitSek: number,
  monthlyChurnPct: number,
  targetLtvCac: number,
): number | null {
  const churn = monthlyChurnPct / 100;
  if (churn <= 0 || monthlyGrossProfitSek <= 0 || targetLtvCac <= 0) return null;
  const ltv = monthlyGrossProfitSek / churn;
  const affordableCac = ltv / targetLtvCac;
  if (affordableCac <= 0) return null;
  return Math.min(100, (cacPerSignupSek / affordableCac) * 100);
}

/**
 * The most a registration may cost for this tier to hit a target LTV:CAC.
 *
 * The counterpart to the CEO's question, asked per product: instead of "is
 * 100 kr affordable", "what is affordable". This is what makes separate
 * campaigns for One and Small a requirement rather than a nicety — One at
 * 179 kr/month and Small at 749 kr can support very different bid levels, and
 * a single blended campaign spends both at the same rate.
 */
export function affordableCostPerSignup(
  monthlyGrossProfitSek: number,
  monthlyChurnPct: number,
  signupToPaidPct: number,
  targetLtvCac: number,
): number | null {
  const churn = monthlyChurnPct / 100;
  if (churn <= 0 || monthlyGrossProfitSek <= 0 || targetLtvCac <= 0) return null;
  if (signupToPaidPct <= 0) return null;
  const ltv = monthlyGrossProfitSek / churn;
  const affordableCac = ltv / targetLtvCac;
  return affordableCac * (signupToPaidPct / 100);
}

/** The LTV:CAC bar this page judges against. */
export const TARGET_LTV_CAC = 3;

// ---------------------------------------------------------------------------
// Spend → growth simulator
// ---------------------------------------------------------------------------
//
// "If we spend X per month at Y per signup, what do we actually get?"
//
// The whole point is that a signup is only a signup. Three things separate ad
// spend from growth, and the simulator makes each visible rather than folding
// them into one number:
//
//  1. DILUTION. Only `signupToPaidPct` of signups ever pay. At 3.4% a budget
//     buying 500 signups buys 17 payers, and 483 permanent free accounts.
//  2. LAG. Upgrading opens a 14-day card trial and the first invoice lands
//     after it, so a signup in month t becomes a payer around month t+1.
//  3. CHURN CAPS IT. This is the one people miss. At CONSTANT spend the payer
//     base does not grow linearly — it asymptotes on newPayersPerMonth ÷ churn.
//     Doubling the horizon past that point adds nothing; only more spend, better
//     conversion, or lower churn moves the ceiling.
//
// The simulation is deliberately INCREMENTAL: it starts from zero payers and
// models only what the ad program itself buys. Mixing in today's payer base
// would let the Large-heavy legacy accounts (which ads did not produce) flatter
// the result, which is the exact error this page exists to avoid.
//
// Non-converting signups are counted but NOT costed. They do consume a little
// premium data (a measured 7-11% of free accounts run diagnostics in a given
// month), but per Jacob that is deliberately out of scope here: this section
// answers what spend buys in paying customers, and loading a free-tail cost
// onto it would blur that. The free count is still shown, because the size of
// the non-converting pool is the whole reason spend ≠ growth.

export type GrowthInputs = {
  /** Ad budget per month, SEK. */
  monthlyBudgetSek: number;
  /** How many months to project. */
  horizonMonths: number;
  /** Months from signup to first payment (14-day trial + first invoice). */
  conversionLagMonths: number;
  /** Plan mix of NEW customers, as shares of 100. */
  newCustomerMix: Record<CacLtvTierKey, number>;
};

export const DEFAULT_GROWTH: GrowthInputs = {
  monthlyBudgetSek: 35_000,
  horizonMonths: 24,
  conversionLagMonths: 1,
  // Overwritten at render time with the observed trial-pipeline mix.
  newCustomerMix: { one: 30, small: 65, large: 5 },
};

export const GROWTH_BOUNDS = {
  monthlyBudgetSek: { min: 0, max: 300_000, step: 5_000, label: "Monthly ad budget", unit: "SEK" },
  horizonMonths: { min: 6, max: 48, step: 1, label: "Horizon", unit: "months" },
  conversionLagMonths: { min: 0, max: 4, step: 1, label: "Signup → payment lag", unit: "months" },
} as const;

export type GrowthMonthRow = {
  month: number;
  spendSek: number;
  signups: number;
  /** Signups that will never pay. They stay on Free permanently. */
  freeAdded: number;
  newPayers: number;
  churnedPayers: number;
  payerBase: number;
  freeBase: number;
  mrrSek: number;
  /** Gross profit from the paying base. */
  grossProfitSek: number;
  /** Gross profit less that month's spend. */
  netContributionSek: number;
  cumulativeSpendSek: number;
  /** Running total of netContribution. Crosses zero at payback. */
  cumulativeNetSek: number;
};

export type GrowthResult = {
  rows: GrowthMonthRow[];
  /** Blended net ARPA of the NEW-customer mix. */
  newMixArpaSek: number;
  /** Blended monthly gross profit per new customer. */
  newMixGrossProfitSek: number;
  signupsPerMonth: number;
  newPayersPerMonth: number;
  /** newPayersPerMonth / churn — the ceiling constant spend converges on. */
  steadyStatePayers: number;
  steadyStateMrrSek: number;
  /** Month cumulativeNet first crosses zero. null = never within horizon. */
  paybackMonth: number | null;
  totalSpendSek: number;
  totalSignups: number;
  /** Payers alive at the end of the horizon. */
  endPayers: number;
  endMrrSek: number;
  endFreeBase: number;
  /** Total spend / payers still alive at the end. */
  costPerRetainedPayerSek: number;
  /** Total spend / every payer ever acquired. */
  costPerAcquiredPayerSek: number;
};

/**
 * Blended economics of an arbitrary new-customer plan mix.
 * Shares need not sum to exactly 100 — they are normalised.
 */
export function mixEconomics(
  mix: Record<CacLtvTierKey, number>,
  assumptions: CacLtvAssumptions,
  vehiclesByTier: Record<CacLtvTierKey, number>,
  aiCostPerMonthSek: number,
): { arpaSek: number; grossProfitSek: number; variableCostSek: number } {
  const total = CAC_LTV_TIERS.reduce((sum, tier) => sum + (mix[tier.key] || 0), 0);
  if (total <= 0) return { arpaSek: 0, grossProfitSek: 0, variableCostSek: 0 };

  let arpaSek = 0;
  let variableCostSek = 0;
  for (const tier of CAC_LTV_TIERS) {
    const weight = (mix[tier.key] || 0) / total;
    const netArpa = tier.listPriceSek * (1 - assumptions.discountPct / 100);
    const variable =
      aiCostPerMonthSek +
      vehiclesByTier[tier.key] * assumptions.perVehicleDataCostSek +
      (netArpa * assumptions.stripeFeePct) / 100 +
      assumptions.stripeFeeFixedSek;
    arpaSek += netArpa * weight;
    variableCostSek += variable * weight;
  }
  return { arpaSek, grossProfitSek: arpaSek - variableCostSek, variableCostSek };
}

/** Project constant monthly ad spend forward. */
export function simulateGrowth(
  growth: GrowthInputs,
  assumptions: CacLtvAssumptions,
  vehiclesByTier: Record<CacLtvTierKey, number>,
  aiCostPerMonthSek: number,
): GrowthResult {
  const mix = mixEconomics(growth.newCustomerMix, assumptions, vehiclesByTier, aiCostPerMonthSek);
  const churn = assumptions.monthlyChurnPct / 100;
  const conversion = assumptions.signupToPaidPct / 100;

  const signupsPerMonth =
    assumptions.cacPerSignupSek > 0
      ? growth.monthlyBudgetSek / assumptions.cacPerSignupSek
      : 0;
  const newPayersPerMonth = signupsPerMonth * conversion;

  const rows: GrowthMonthRow[] = [];
  let payerBase = 0;
  let freeBase = 0;
  let cumulativeSpend = 0;
  let cumulativeNet = 0;
  let paybackMonth: number | null = null;
  let totalPayersAcquired = 0;

  for (let month = 1; month <= growth.horizonMonths; month += 1) {
    const spendSek = growth.monthlyBudgetSek;
    const signups = signupsPerMonth;

    // Payers arriving this month were acquired `lag` months ago.
    const newPayers = month > growth.conversionLagMonths ? newPayersPerMonth : 0;
    // Everyone who signed up this month and will never pay joins Free for good.
    const freeAdded = signups * (1 - conversion);

    const churnedPayers = payerBase * churn;
    payerBase = payerBase + newPayers - churnedPayers;
    freeBase += freeAdded;
    totalPayersAcquired += newPayers;

    const mrrSek = payerBase * mix.arpaSek;
    const grossProfitSek = payerBase * mix.grossProfitSek;
    const netContributionSek = grossProfitSek - spendSek;

    cumulativeSpend += spendSek;
    cumulativeNet += netContributionSek;
    if (paybackMonth === null && cumulativeNet >= 0 && month > growth.conversionLagMonths) {
      paybackMonth = month;
    }

    rows.push({
      month,
      spendSek,
      signups,
      freeAdded,
      newPayers,
      churnedPayers,
      payerBase,
      freeBase,
      mrrSek,
      grossProfitSek,
      netContributionSek,
      cumulativeSpendSek: cumulativeSpend,
      cumulativeNetSek: cumulativeNet,
    });
  }

  const steadyStatePayers = churn > 0 ? newPayersPerMonth / churn : Number.POSITIVE_INFINITY;
  const last = rows[rows.length - 1];

  return {
    rows,
    newMixArpaSek: mix.arpaSek,
    newMixGrossProfitSek: mix.grossProfitSek,
    signupsPerMonth,
    newPayersPerMonth,
    steadyStatePayers,
    steadyStateMrrSek: steadyStatePayers * mix.arpaSek,
    paybackMonth,
    totalSpendSek: last ? last.cumulativeSpendSek : 0,
    totalSignups: signupsPerMonth * growth.horizonMonths,
    endPayers: last ? last.payerBase : 0,
    endMrrSek: last ? last.mrrSek : 0,
    endFreeBase: last ? last.freeBase : 0,
    costPerRetainedPayerSek:
      last && last.payerBase > 0 ? last.cumulativeSpendSek / last.payerBase : Number.POSITIVE_INFINITY,
    costPerAcquiredPayerSek:
      totalPayersAcquired > 0 && last
        ? last.cumulativeSpendSek / totalPayersAcquired
        : Number.POSITIVE_INFINITY,
  };
}

// Axes for the sensitivity grid. Deliberately straddle where the business
// actually sits: blended cost per signup has run 94-135 SEK, and mature-cohort
// signup-to-paid is 3.4-3.8%.
export const SENSITIVITY_CAC_SEK = [50, 100, 150, 200, 300, 400] as const;
export const SENSITIVITY_CONVERSION_PCT = [1, 2, 3.5, 5, 8, 12] as const;
export const SENSITIVITY_CHURN_PCT = [2, 3, 5, 8, 12, 20] as const;

// ---------------------------------------------------------------------------
// Loaded (warehouse) data shape
// ---------------------------------------------------------------------------

/** One month of the acquisition + conversion funnel, from prod. */
export type CacLtvMonthRow = {
  month: string;
  /** GA4 new_users on wrenchlane.com. Traffic proxy. */
  traffic: number;
  /** GA4 sign_up events. */
  ga4Signups: number;
  /** Workshops created in the month (internal-test excluded). The cohort base. */
  workshopSignups: number;
  adSpendUsd: number;
  adClicks: number;
  adImpressions: number;
  /** GA4-linked Google Ads campaign-attributed signups. */
  adSignups: number;
  organicClicks: number;
  /** Cohort progress: reached Stripe checkout. */
  checkoutStarted: number;
  /** Cohort progress: started a card trial. */
  trialStarted: number;
  /** Cohort progress: paying now. */
  payingNow: number;
  /** Cohort progress: ran >= 1 diagnostic ever. */
  activated: number;
  /** Cohort progress: ran >= 2 diagnostics ever. */
  engaged: number;
  /** True when the cohort is too young for its paid rate to be read. */
  cohortImmature: boolean;
};

export type ChannelKey =
  | "paid_ads"
  | "organic"
  | "direct"
  | "mail"
  | "partner"
  | "agent";

/**
 * A channel row. `attribution` is the point of this table: the spreadsheet
 * asks for cost and paid customers per channel, and only one channel can
 * currently supply both.
 */
export type CacLtvChannelRow = {
  key: ChannelKey;
  label: string;
  /** "measured" = spend AND signups are attributed. */
  attribution: "measured" | "spend-only" | "volume-only" | "none";
  spendSek: number | null;
  signups: number | null;
  costPerSignupSek: number | null;
  /** What is missing, and where it would have to come from. */
  gap: string;
};

/** What the data can and cannot say about churn. */
export type ChurnEvidence = {
  /** Subscriptions that got past their trial window. */
  startedPaying: number;
  stillPaying: number;
  /** Cancellations that look like ordinary churn. */
  churnedNormally: number;
  /** Cancellations from the single-day bulk cleanup — excluded from churn. */
  bulkCancelled: number;
  bulkCancelDate: string;
  /** Median months paid before churning, bulk excluded. */
  medianPaidMonthsChurned: number | null;
  /** Median months paid so far by customers still active (survivor-biased). */
  medianPaidMonthsActive: number | null;
  /** Naive churn if you trust canceled_at as-is. Shown to be discarded. */
  naiveMonthlyChurnPct: number | null;
  /** Churn from ordinary cancellations against the average paying base. */
  observedMonthlyChurnPct: number | null;
  observedWindowMonths: number;
};

export type CacLtvData = {
  asOf: string;
  months: CacLtvMonthRow[];
  channels: CacLtvChannelRow[];
  /** Premium vehicle opens per paying workshop per month, by tier. */
  vehiclesPerMonthByTier: Record<CacLtvTierKey, number>;
  /** Workshop-months behind each tier's figure above. */
  vehicleSampleByTier: Record<CacLtvTierKey, number>;
  /** True where the sample was too thin and the plan allowance was substituted. */
  vehicleEstimatedByTier: Record<CacLtvTierKey, boolean>;
  /** Paying = Stripe subscription status active. Excludes past due and trials. */
  payingByTier: Record<CacLtvTierKey, number>;
  trialingByTier: Record<CacLtvTierKey, number>;
  /** On a paid plan with a failing charge — a churn risk, not revenue. */
  pastDueByTier: Record<CacLtvTierKey, number>;
  /** Premium data consumed by FREE workshops, which have a 1-vehicle allowance. */
  freeVehiclesPerMonth: number;
  freeVehicleSample: number;
  freeWorkshops: number;
  totalWorkshops: number;
  /** Lifetime AI cost in USD, read as a cumulative counter (max, not sum). */
  aiCostLifetimeUsd: number;
  aiCostPerDiagnosticUsd: number;
  diagnosticsPerPayingWorkshopPerMonth: number;
  churn: ChurnEvidence;
  /** Mature-cohort signup → paying, used to seed the conversion assumption. */
  matureSignupToPaidPct: number | null;
  /** Blended cost per signup actually paid: ad spend / all signups. */
  blendedCostPerSignupSek: number | null;
  /** Cost per ad-attributed signup: ad spend / ad signups. */
  paidCostPerSignupSek: number | null;
  notes: string[];
};

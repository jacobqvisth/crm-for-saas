import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import {
  CAC_LTV_TIERS,
  MIN_VEHICLE_SAMPLE,
  type CacLtvChannelRow,
  type CacLtvData,
  type CacLtvMonthRow,
  type CacLtvTierKey,
  type ChurnEvidence,
} from "@/lib/ceo/cac-ltv-shared";
import { loadInternalTestSets } from "@/lib/ceo/internal-test/loader";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";

// Server-side loader for the CAC/LTV page. The model arithmetic and every
// assumption live in src/lib/ceo/cac-ltv-shared.ts; this file only measures.
//
// Metric-key traps this loader exists to get right, all verified against prod
// on 2026-08-11:
//
//  * core_ai_total_cost is a CUMULATIVE lifetime counter, not a daily flow.
//    Summing its daily snapshots gives $3,311 of AI cost; the real lifetime
//    figure is max() = $44.44. A page that sums it would report a variable cost
//    ~75x too high and conclude the product has no gross margin.
//  * ad_conversions counts 184,706 against 37,849 ad clicks — it is a GA4
//    all-conversion-events total, not signups. ad_signups (campaign-scoped
//    sign_up events) is the only usable paid-signup number, and it only exists
//    from 2026-05-20.
//  * dashboard_subscriptions.mrr_amount_cents holds the unit amount in the
//    Stripe price's DEFAULT currency (19 / 79 / 195), not the customer's
//    billing currency, so it cannot be read as SEK. SEK list prices are the
//    anchor instead (see CAC_LTV_TIERS).
//  * ga4 active_users sums daily uniques across the month (26,972 for June
//    against 10,545 new_users), so new_users is the traffic proxy here.

const ACQUISITION_METRIC_KEYS = [
  "new_users",
  "sessions",
  "signup",
  "ad_spend",
  "ad_clicks",
  "ad_impressions",
  "ad_signups",
  "core_ai_total_cost",
  "core_diagnostics_created",
  "active_subscriptions",
] as const;

// A cohort needs the 14-day trial plus a first invoice cycle plus dunning
// before its paid rate means anything. Anything younger reads low for age
// reasons, so the page labels it rather than averaging it in.
const COHORT_MATURITY_DAYS = 60;

// Cohorts before this month were hand-sold pilots converting at 30-60%, which
// says nothing about self-serve economics. Paid acquisition scaled from May.
const SELF_SERVE_COHORT_START = "2026-05";

type SnapshotRow = {
  source_key: string;
  metric_key: string;
  period_start: string;
  value: number | null;
};

type OrganicRow = { period_start: string; value: number | null };

type WorkshopRow = {
  workshop_id: string;
  plan_key: string | null;
  core_subscription_status: string | null;
  core_stripe_customer_id: string | null;
  core_stripe_subscription_id: string | null;
  created_at: string | null;
  created_by_agent: boolean | null;
};

type UserRow = { internal_user_id: string; workshop_id: string | null };

type DiagnosticRow = { internal_user_id: string | null; created_at: string | null };

type FeatureRow = {
  internal_user_id: string;
  feature_key: string;
  period_start: string;
  usage_count: number | null;
};

type SubscriptionRow = {
  stripe_subscription_id: string;
  workshop_id: string | null;
  status: string | null;
  trial_end: string | null;
  canceled_at: string | null;
};

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function tierFromPlanKey(planKey: string | null): CacLtvTierKey | null {
  if (!planKey) return null;
  const prefix = planKey.split("_")[0];
  const match = CAC_LTV_TIERS.find((tier) => tier.key === prefix);
  return match ? match.key : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
}

function emptyData(): CacLtvData {
  return {
    asOf: new Date().toISOString(),
    months: [],
    channels: [],
    vehiclesPerMonthByTier: { one: 0, small: 0, large: 0 },
    vehicleSampleByTier: { one: 0, small: 0, large: 0 },
    vehicleEstimatedByTier: { one: true, small: true, large: true },
    payingByTier: { one: 0, small: 0, large: 0 },
    trialingByTier: { one: 0, small: 0, large: 0 },
    pastDueByTier: { one: 0, small: 0, large: 0 },
    freeVehiclesPerMonth: 0,
    freeVehicleSample: 0,
    freeWorkshops: 0,
    totalWorkshops: 0,
    aiCostLifetimeUsd: 0,
    aiCostPerDiagnosticUsd: 0,
    diagnosticsPerPayingWorkshopPerMonth: 0,
    churn: {
      startedPaying: 0,
      stillPaying: 0,
      churnedNormally: 0,
      bulkCancelled: 0,
      bulkCancelDate: "",
      medianPaidMonthsChurned: null,
      medianPaidMonthsActive: null,
      naiveMonthlyChurnPct: null,
      observedMonthlyChurnPct: null,
      observedWindowMonths: 0,
    },
    matureSignupToPaidPct: null,
    blendedCostPerSignupSek: null,
    paidCostPerSignupSek: null,
    notes: ["Supabase is not configured, so no live figures were read."],
  };
}

async function getCacLtvDataUncached(): Promise<CacLtvData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyData();

  const sets = await loadInternalTestSets();
  const now = new Date();

  const [
    snapshotResult,
    organicResult,
    workshopResult,
    userResult,
    diagnosticResult,
    featureResult,
    subscriptionResult,
  ] = await Promise.all([
    pageAll<SnapshotRow>(({ from, to }) =>
      supabase
        .from(TABLES.metricSnapshots)
        .select("source_key, metric_key, period_start, value")
        .in("metric_key", [...ACQUISITION_METRIC_KEYS])
        .order("period_start", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // Search Console rows are per-keyword per-day (~37k rows for clicks
    // alone), so this is deliberately narrowed to one metric and two columns.
    // It is the only channel-volume figure organic can supply — organic has no
    // spend and no signup attribution, so it never reaches the CAC math.
    pageAll<OrganicRow>(({ from, to }) =>
      supabase
        .from(TABLES.metricSnapshots)
        .select("period_start, value")
        .eq("source_key", "search_console")
        .eq("metric_key", "organic_search_clicks")
        .order("period_start", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    pageAll<WorkshopRow>(({ from, to }) =>
      supabase
        .from(TABLES.workshops)
        .select(
          "workshop_id, plan_key, core_subscription_status, core_stripe_customer_id, core_stripe_subscription_id, created_at, created_by_agent",
        )
        .order("workshop_id", { ascending: true })
        .range(from, to),
    ),
    pageAll<UserRow>(({ from, to }) =>
      supabase
        .from(TABLES.users)
        .select("internal_user_id, workshop_id")
        .order("internal_user_id", { ascending: true })
        .range(from, to),
    ),
    pageAll<DiagnosticRow>(({ from, to }) =>
      supabase
        .from(TABLES.diagnostics)
        .select("internal_user_id, created_at")
        .order("diagnostic_id", { ascending: true })
        .range(from, to),
    ),
    pageAll<FeatureRow>(({ from, to }) =>
      supabase
        .from(TABLES.featureUsage)
        .select("internal_user_id, feature_key, period_start, usage_count")
        .eq("granularity", "month")
        .in("feature_key", ["infopro_vehicles", "motor_vehicles"])
        .order("period_start", { ascending: true })
        .order("internal_user_id", { ascending: true })
        .order("feature_key", { ascending: true })
        .range(from, to),
    ),
    pageAll<SubscriptionRow>(({ from, to }) =>
      supabase
        .from(TABLES.subscriptions)
        .select("stripe_subscription_id, workshop_id, status, trial_end, canceled_at")
        .order("stripe_subscription_id", { ascending: true })
        .range(from, to),
    ),
  ]);

  for (const result of [
    snapshotResult,
    organicResult,
    workshopResult,
    userResult,
    diagnosticResult,
    featureResult,
    subscriptionResult,
  ]) {
    if (result.error) throw new Error(result.error.message);
  }

  // ---- Internal-test exclusion ------------------------------------------
  const workshops = workshopResult.data.filter(
    (row) => !sets.workshopIds.has(row.workshop_id),
  );
  const workshopById = new Map(workshops.map((row) => [row.workshop_id, row]));
  const users = userResult.data.filter(
    (row) =>
      !sets.userIds.has(row.internal_user_id) &&
      (!row.workshop_id || !sets.workshopIds.has(row.workshop_id)),
  );
  const workshopByUser = new Map(
    users.map((row) => [row.internal_user_id, row.workshop_id]),
  );

  // ---- Monthly source metrics -------------------------------------------
  type MetricBucket = {
    traffic: number;
    ga4Signups: number;
    adSpendUsd: number;
    adClicks: number;
    adImpressions: number;
    adSignups: number;
    organicClicks: number;
  };
  const metricsByMonth = new Map<string, MetricBucket>();
  const bucketFor = (month: string): MetricBucket => {
    const existing = metricsByMonth.get(month);
    if (existing) return existing;
    const created: MetricBucket = {
      traffic: 0,
      ga4Signups: 0,
      adSpendUsd: 0,
      adClicks: 0,
      adImpressions: 0,
      adSignups: 0,
      organicClicks: 0,
    };
    metricsByMonth.set(month, created);
    return created;
  };

  // Cumulative counters: the lifetime value is the max, never the sum.
  let aiCostLifetimeUsd = 0;
  // Point-in-time daily state, so the monthly read is an average.
  const activeSubsByDay: number[] = [];
  let diagnosticsCreatedTotal = 0;

  for (const row of snapshotResult.data) {
    const value = Number(row.value ?? 0);
    if (!Number.isFinite(value)) continue;

    if (row.metric_key === "core_ai_total_cost") {
      aiCostLifetimeUsd = Math.max(aiCostLifetimeUsd, value);
      continue;
    }
    if (row.metric_key === "active_subscriptions") {
      activeSubsByDay.push(value);
      continue;
    }
    if (row.metric_key === "core_diagnostics_created") {
      diagnosticsCreatedTotal += value;
      continue;
    }

    const bucket = bucketFor(monthKey(row.period_start));
    if (row.source_key === "ga4" && row.metric_key === "new_users") bucket.traffic += value;
    else if (row.source_key === "ga4" && row.metric_key === "signup") bucket.ga4Signups += value;
    else if (row.metric_key === "ad_spend") bucket.adSpendUsd += value;
    else if (row.metric_key === "ad_clicks") bucket.adClicks += value;
    else if (row.metric_key === "ad_impressions") bucket.adImpressions += value;
    else if (row.metric_key === "ad_signups") bucket.adSignups += value;
  }

  for (const row of organicResult.data) {
    const value = Number(row.value ?? 0);
    if (!Number.isFinite(value)) continue;
    bucketFor(monthKey(row.period_start)).organicClicks += value;
  }

  // ---- Diagnostics per workshop (activation + AI cost) -------------------
  const diagCountByWorkshop = new Map<string, number>();
  let diagnosticsLifetime = 0;
  const recentWindowStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const recentDiagsByWorkshop = new Map<string, number>();

  for (const row of diagnosticResult.data) {
    if (!row.internal_user_id) continue;
    const workshopId = workshopByUser.get(row.internal_user_id);
    if (!workshopId || !workshopById.has(workshopId)) continue;
    diagnosticsLifetime += 1;
    diagCountByWorkshop.set(workshopId, (diagCountByWorkshop.get(workshopId) ?? 0) + 1);
    if (row.created_at && new Date(row.created_at) >= recentWindowStart) {
      recentDiagsByWorkshop.set(
        workshopId,
        (recentDiagsByWorkshop.get(workshopId) ?? 0) + 1,
      );
    }
  }

  // ---- Current plan state ------------------------------------------------
  // Paying = subscription status "active" only. past_due is a paid plan whose
  // charge is failing, so counting it as revenue would inflate both the payer
  // count and every per-customer average. It is carried separately as a churn
  // risk. This matches the 60-payer figure the Free Users page reports.
  const payingByTier: Record<CacLtvTierKey, number> = { one: 0, small: 0, large: 0 };
  const trialingByTier: Record<CacLtvTierKey, number> = { one: 0, small: 0, large: 0 };
  const pastDueByTier: Record<CacLtvTierKey, number> = { one: 0, small: 0, large: 0 };
  let freeWorkshops = 0;
  let agentSourced = 0;

  for (const row of workshops) {
    if (row.created_by_agent) agentSourced += 1;
    const tier = tierFromPlanKey(row.plan_key);
    if (!tier) {
      freeWorkshops += 1;
      continue;
    }
    if (row.core_subscription_status === "active") {
      payingByTier[tier] += 1;
    } else if (row.core_subscription_status === "trialing") {
      trialingByTier[tier] += 1;
    } else if (row.core_subscription_status === "past_due") {
      pastDueByTier[tier] += 1;
    }
  }

  const payingWorkshopIds = new Set(
    workshops
      .filter(
        (row) =>
          tierFromPlanKey(row.plan_key) !== null &&
          row.core_subscription_status === "active",
      )
      .map((row) => row.workshop_id),
  );

  // ---- Premium vehicle lookups per paying workshop per month -------------
  // The variable-cost driver. Small allows 20 vehicles/month and Large 80, but
  // observed consumption is a fraction of that, which is what keeps the margin
  // alive even at a high per-vehicle supplier rate.
  const vehicleMonths = new Map<string, Map<string, number>>();
  for (const row of featureResult.data) {
    const workshopId = workshopByUser.get(row.internal_user_id);
    if (!workshopId || !workshopById.has(workshopId)) continue;
    const month = monthKey(row.period_start);
    const perMonth = vehicleMonths.get(month) ?? new Map<string, number>();
    perMonth.set(workshopId, (perMonth.get(workshopId) ?? 0) + Number(row.usage_count ?? 0));
    vehicleMonths.set(month, perMonth);
  }

  const vehicleSamples: Record<CacLtvTierKey, number[]> = { one: [], small: [], large: [] };
  const freeVehicleSamples: number[] = [];
  for (const perMonth of vehicleMonths.values()) {
    for (const [workshopId, vehicles] of perMonth) {
      const planKey = workshopById.get(workshopId)?.plan_key ?? null;
      const tier = tierFromPlanKey(planKey);
      if (tier) vehicleSamples[tier].push(vehicles);
      else freeVehicleSamples.push(vehicles);
    }
  }
  const mean = (values: number[]) =>
    values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  // Thin samples fall back to the plan's contractual allowance rather than
  // letting one outlier workshop-month set a company-level cost. Both the
  // substitution and the sample size are reported so the page can label it.
  const vehiclesPerMonthByTier = {} as Record<CacLtvTierKey, number>;
  const vehicleSampleByTier = {} as Record<CacLtvTierKey, number>;
  const vehicleEstimatedByTier = {} as Record<CacLtvTierKey, boolean>;
  for (const tier of CAC_LTV_TIERS) {
    const samples = vehicleSamples[tier.key];
    const thin = samples.length < MIN_VEHICLE_SAMPLE;
    vehicleSampleByTier[tier.key] = samples.length;
    vehicleEstimatedByTier[tier.key] = thin;
    vehiclesPerMonthByTier[tier.key] = Number(
      (thin ? tier.includedVehicles : mean(samples)).toFixed(1),
    );
  }

  // ---- Cohort funnel by signup month ------------------------------------
  const cohorts = new Map<
    string,
    {
      signups: number;
      checkoutStarted: number;
      trialStarted: number;
      payingNow: number;
      activated: number;
      engaged: number;
    }
  >();
  for (const row of workshops) {
    if (!row.created_at) continue;
    const month = monthKey(row.created_at);
    const cohort =
      cohorts.get(month) ??
      { signups: 0, checkoutStarted: 0, trialStarted: 0, payingNow: 0, activated: 0, engaged: 0 };
    cohort.signups += 1;
    if (row.core_stripe_customer_id) cohort.checkoutStarted += 1;
    if (row.core_stripe_subscription_id) cohort.trialStarted += 1;
    if (payingWorkshopIds.has(row.workshop_id)) cohort.payingNow += 1;
    const diags = diagCountByWorkshop.get(row.workshop_id) ?? 0;
    if (diags >= 1) cohort.activated += 1;
    if (diags >= 2) cohort.engaged += 1;
    cohorts.set(month, cohort);
  }

  const allMonths = Array.from(
    new Set([...metricsByMonth.keys(), ...cohorts.keys()]),
  ).sort();

  const maturityCutoff = new Date(
    now.getTime() - COHORT_MATURITY_DAYS * 24 * 60 * 60 * 1000,
  );
  const months: CacLtvMonthRow[] = allMonths.map((month) => {
    const metrics = metricsByMonth.get(month);
    const cohort = cohorts.get(month);
    // A cohort is mature once its LAST signup has had the full window.
    const monthEnd = new Date(`${month}-01T00:00:00Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    return {
      month,
      traffic: Math.round(metrics?.traffic ?? 0),
      ga4Signups: Math.round(metrics?.ga4Signups ?? 0),
      workshopSignups: cohort?.signups ?? 0,
      adSpendUsd: metrics?.adSpendUsd ?? 0,
      adClicks: Math.round(metrics?.adClicks ?? 0),
      adImpressions: Math.round(metrics?.adImpressions ?? 0),
      adSignups: Math.round(metrics?.adSignups ?? 0),
      organicClicks: Math.round(metrics?.organicClicks ?? 0),
      checkoutStarted: cohort?.checkoutStarted ?? 0,
      trialStarted: cohort?.trialStarted ?? 0,
      payingNow: cohort?.payingNow ?? 0,
      activated: cohort?.activated ?? 0,
      engaged: cohort?.engaged ?? 0,
      cohortImmature: monthEnd > maturityCutoff,
    };
  });

  // ---- Mature self-serve signup -> paying --------------------------------
  const matureSelfServe = months.filter(
    (row) => row.month >= SELF_SERVE_COHORT_START && !row.cohortImmature && row.workshopSignups > 0,
  );
  const matureSignups = matureSelfServe.reduce((sum, row) => sum + row.workshopSignups, 0);
  const maturePaying = matureSelfServe.reduce((sum, row) => sum + row.payingNow, 0);
  const matureSignupToPaidPct =
    matureSignups > 0 ? (maturePaying / matureSignups) * 100 : null;

  // ---- Cost per signup, actual ------------------------------------------
  // Two readings, both worth having. Paid = spend over the signups Google Ads
  // can name, which is the strict paid CAC. Blended = the same spend over ALL
  // signups, which credits paid media for the brand and direct traffic it
  // creates. The CEO's 100 SEK sits between them.
  const spendMonths = months.filter((row) => row.adSpendUsd > 0);
  const totalSpendUsd = spendMonths.reduce((sum, row) => sum + row.adSpendUsd, 0);
  const attributedMonths = months.filter((row) => row.adSignups > 0);
  const totalAdSignups = attributedMonths.reduce((sum, row) => sum + row.adSignups, 0);
  const attributedSpendUsd = attributedMonths.reduce((sum, row) => sum + row.adSpendUsd, 0);
  const totalGa4Signups = spendMonths.reduce((sum, row) => sum + row.ga4Signups, 0);

  // ---- Churn evidence ----------------------------------------------------
  const subscriptions = subscriptionResult.data.filter(
    (row) => !row.workshop_id || !sets.workshopIds.has(row.workshop_id),
  );

  // Find a single-day cancellation pile-up. On 2026-08-11 prod carried 136
  // cancellations stamped 2026-08-03 with NULL current_period_end and an
  // updated_at months EARLIER than the cancel date — a backfill artefact, not
  // 136 customers leaving in a day. Detected rather than hardcoded so the page
  // keeps working when the next one lands.
  const cancelDayCounts = new Map<string, number>();
  for (const row of subscriptions) {
    if (!row.canceled_at) continue;
    const day = row.canceled_at.slice(0, 10);
    cancelDayCounts.set(day, (cancelDayCounts.get(day) ?? 0) + 1);
  }
  const totalCancellations = Array.from(cancelDayCounts.values()).reduce(
    (sum, count) => sum + count,
    0,
  );
  let bulkCancelDate = "";
  let bulkCancelled = 0;
  for (const [day, count] of cancelDayCounts) {
    if (count > bulkCancelled && count >= 20 && count > totalCancellations * 0.3) {
      bulkCancelDate = day;
      bulkCancelled = count;
    }
  }
  if (!bulkCancelDate) bulkCancelled = 0;

  const postTrial = (row: SubscriptionRow): boolean => {
    if (!row.trial_end) return true;
    if (!row.canceled_at) return new Date(row.trial_end) < now;
    // One day of slack: cancelling on the trial-end date is a trial that ended,
    // not a paying customer who churned.
    return (
      new Date(row.canceled_at).getTime() >
      new Date(row.trial_end).getTime() + 24 * 60 * 60 * 1000
    );
  };

  const reachedPaying = subscriptions.filter(
    (row) => row.trial_end !== null && new Date(row.trial_end) < now && postTrial(row),
  );
  const stillPaying = reachedPaying.filter((row) => !row.canceled_at).length;
  const normalChurned = reachedPaying.filter(
    (row) => row.canceled_at && row.canceled_at.slice(0, 10) !== bulkCancelDate,
  );

  const churnedTenures = normalChurned
    .map((row) =>
      row.trial_end && row.canceled_at
        ? monthsBetween(new Date(row.trial_end), new Date(row.canceled_at))
        : null,
    )
    .filter((value): value is number => value !== null && value >= 0);
  const activeTenures = reachedPaying
    .filter((row) => !row.canceled_at && row.trial_end)
    .map((row) => monthsBetween(new Date(row.trial_end as string), now))
    .filter((value) => value >= 0);

  const churnDates = normalChurned
    .map((row) => row.canceled_at as string)
    .sort();
  const observedWindowMonths =
    churnDates.length > 1
      ? Math.max(
          1,
          monthsBetween(new Date(churnDates[0]), new Date(churnDates[churnDates.length - 1])),
        )
      : 0;
  const avgPayingBase =
    activeSubsByDay.length > 0
      ? activeSubsByDay.reduce((sum, value) => sum + value, 0) / activeSubsByDay.length
      : 0;
  const observedMonthlyChurnPct =
    observedWindowMonths > 0 && avgPayingBase > 0
      ? (normalChurned.length / observedWindowMonths / avgPayingBase) * 100
      : null;
  const naiveMonthlyChurnPct =
    observedWindowMonths > 0 && avgPayingBase > 0
      ? ((normalChurned.length + bulkCancelled) / observedWindowMonths / avgPayingBase) * 100
      : null;

  const churn: ChurnEvidence = {
    startedPaying: reachedPaying.length,
    stillPaying,
    churnedNormally: normalChurned.length,
    bulkCancelled,
    bulkCancelDate,
    medianPaidMonthsChurned: median(churnedTenures),
    medianPaidMonthsActive: median(activeTenures),
    naiveMonthlyChurnPct,
    observedMonthlyChurnPct,
    observedWindowMonths,
  };

  // ---- Channel table -----------------------------------------------------
  const spendSek = (usd: number, rate: number) => usd * rate;
  // The rate is an assumption on the client too, but the table needs a number
  // now; the page re-derives the SEK column from the live slider.
  const RATE_FOR_TABLE = 9.6;

  const totalOrganicClicks = months.reduce((sum, row) => sum + row.organicClicks, 0);

  const channels: CacLtvChannelRow[] = [
    {
      key: "paid_ads",
      label: "Paid Ads",
      attribution: "measured",
      spendSek: spendSek(totalSpendUsd, RATE_FOR_TABLE),
      signups: totalAdSignups,
      costPerSignupSek:
        totalAdSignups > 0 ? spendSek(attributedSpendUsd, RATE_FOR_TABLE) / totalAdSignups : null,
      gap:
        "The only channel with both sides. Spend and signups both come from GA4-linked Google Ads, campaign-scoped. ad_signups starts 2026-05-20, so April spend has no signup partner.",
    },
    {
      key: "organic",
      label: "Organic",
      attribution: "volume-only",
      spendSek: null,
      signups: null,
      costPerSignupSek: null,
      gap: `${totalOrganicClicks.toLocaleString("en-US")} Search Console clicks, but no signup carries a source stamp, so organic signups cannot be counted. Content cost is not tracked anywhere either.`,
    },
    {
      key: "direct",
      label: "Direct",
      attribution: "none",
      spendSek: null,
      signups: null,
      costPerSignupSek: null,
      gap:
        "No first-touch source is stored on a signup. Direct can only be inferred as a residual (all signups minus ad-attributed), which double-counts brand demand that paid media created.",
    },
    {
      key: "mail",
      label: "Mail",
      attribution: "volume-only",
      spendSek: null,
      signups: null,
      costPerSignupSek: null,
      gap:
        "Customer.io send/open/click volume is synced and CRM outreach signups are attributed via contacts.attributed_to_sequence_id (see the Conversions page), but neither is joined to the workshop cohort here, and lifecycle cost is not tracked.",
    },
    {
      key: "partner",
      label: "Partner",
      attribution: "none",
      spendSek: null,
      signups: null,
      costPerSignupSek: null,
      gap: "No partner identifier exists on a workshop or a signup. Nothing to measure yet.",
    },
    {
      key: "agent",
      label: "Agent",
      attribution: "none",
      spendSek: null,
      signups: null,
      costPerSignupSek: null,
      gap: `dashboard_workshops.created_by_agent exists but is false on all ${workshops.length.toLocaleString("en-US")} workshops, so agent-sourced customers are indistinguishable from self-serve. Agent commission cost is not tracked either.`,
    },
  ];

  // ---- AI cost per diagnostic, and per paying workshop per month ---------
  const aiCostPerDiagnosticUsd =
    diagnosticsLifetime > 0 ? aiCostLifetimeUsd / diagnosticsLifetime : 0;
  const recentPayingDiags = Array.from(payingWorkshopIds).reduce(
    (sum, workshopId) => sum + (recentDiagsByWorkshop.get(workshopId) ?? 0),
    0,
  );
  const diagnosticsPerPayingWorkshopPerMonth =
    payingWorkshopIds.size > 0 ? recentPayingDiags / payingWorkshopIds.size / 3 : 0;

  const notes: string[] = [
    `Read from prod on ${now.toISOString().slice(0, 10)}. Internal-test accounts excluded everywhere.`,
    "Prices are SEK list prices (ex VAT) from the public pricing page. dashboard_subscriptions.mrr_amount_cents is NOT usable as SEK — it stores the Stripe price's default-currency unit amount (19 / 79 / 195) regardless of the customer's billing currency.",
    "core_ai_total_cost is a cumulative lifetime counter and is read with max(), not sum(). Summing it would overstate AI cost roughly 75-fold.",
    "ad_conversions is ignored: it reports 184,706 conversions against 37,849 clicks because it counts every GA4 conversion event. ad_signups is used instead.",
  ];
  if (agentSourced === 0) {
    notes.push(
      "created_by_agent is false on every workshop, so the Agent channel in the CEO model cannot be populated until the flag is written at signup.",
    );
  }
  const thinTiers = CAC_LTV_TIERS.filter((tier) => vehicleEstimatedByTier[tier.key]);
  if (thinTiers.length > 0) {
    notes.push(
      `Premium-data usage for ${thinTiers
        .map((tier) => `${tier.label} (${vehicleSampleByTier[tier.key]} workshop-month${vehicleSampleByTier[tier.key] === 1 ? "" : "s"} on record)`)
        .join(" and ")} is below the ${MIN_VEHICLE_SAMPLE}-sample floor, so the plan's own vehicle allowance is used instead of the observed average. One's single observed month was 14 vehicle opens on a plan that includes 1 — averaging it would have made One read as structurally loss-making off one row.`,
    );
  }
  if (freeVehicleSamples.length > 0) {
    notes.push(
      `Free workshops average ${mean(freeVehicleSamples).toFixed(1)} premium vehicle opens per month across ${freeVehicleSamples.length} workshop-months, against a Free allowance of 1 demo vehicle. Either the entitlement leaks or the counter measures opens rather than distinct vehicles — worth confirming, because premium data is the variable cost this model is most sensitive to.`,
    );
  }
  if (bulkCancelled > 0) {
    notes.push(
      `${bulkCancelled} subscription cancellations are stamped ${bulkCancelDate} with no billing period — a backfill artefact. They are excluded from churn; including them would read as ${naiveMonthlyChurnPct?.toFixed(0) ?? "?"}% monthly churn and make every LTV on this page collapse.`,
    );
  }

  return {
    asOf: now.toISOString(),
    months,
    channels,
    vehiclesPerMonthByTier,
    vehicleSampleByTier,
    vehicleEstimatedByTier,
    payingByTier,
    trialingByTier,
    pastDueByTier,
    freeVehiclesPerMonth: Number(mean(freeVehicleSamples).toFixed(1)),
    freeVehicleSample: freeVehicleSamples.length,
    freeWorkshops,
    totalWorkshops: workshops.length,
    aiCostLifetimeUsd,
    aiCostPerDiagnosticUsd,
    diagnosticsPerPayingWorkshopPerMonth,
    churn,
    matureSignupToPaidPct,
    blendedCostPerSignupSek:
      totalGa4Signups > 0 ? spendSek(totalSpendUsd, RATE_FOR_TABLE) / totalGa4Signups : null,
    paidCostPerSignupSek:
      totalAdSignups > 0 ? spendSek(attributedSpendUsd, RATE_FOR_TABLE) / totalAdSignups : null,
    notes,
  };
}

export const getCacLtvData = unstable_cache(
  getCacLtvDataUncached,
  ["ceo-cac-ltv"],
  CEO_CACHE_OPTIONS,
);

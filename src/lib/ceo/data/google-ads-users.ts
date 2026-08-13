// Loader for /dashboard/google-ads-users.
//
// Joins dashboard_user_attribution (GA4 first-touch per identified user, see
// the ga4_attribution sync source) against the core_app warehouse tables to
// answer: who did Google Ads actually bring in, what do those users do in
// the product, how many end up paying, on which plans, and what is the
// economics of the channel.
//
// Cohort rules live in google-ads-users-shared.ts. Payer detection mirrors
// /funnel: plan_key is stamped at CHECKOUT during the trial, so "paid
// plan_key" alone contains never-charged trialers. Charge evidence =
// dashboard_subscriptions.metadata.ever_paid / first_paid_at, with the
// trial-converted fallback, minus still-trialing never-charged workshops.
//
// Currency: dashboard_subscriptions.mrr_amount_cents is the Stripe price's
// DEFAULT currency, not SEK (see cac-ltv.ts) - all money here is modelled
// from SEK list prices instead, and ad spend (USD in
// dashboard_metric_snapshots) converts at the same fixed rate the CAC/LTV
// server table uses.

import { unstable_cache } from "next/cache";
import { PAID_PLANS } from "@/lib/calls/scoring";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { CAC_LTV_TIERS, type CacLtvTierKey } from "@/lib/ceo/cac-ltv-shared";
import {
  ADS_ERA_START,
  COHORT_KEYS,
  COHORT_LABELS,
  USD_TO_SEK,
  type CampaignRow,
  type CohortBehavior,
  type CohortKey,
  type CohortMonetization,
  type CountryRow,
  type FeatureAdoptionRow,
  type GoogleAdsEconomics,
  type GoogleAdsUsersData,
  type LtvScenarioRow,
  type MonthlySignupRow,
  type PlanMixRow,
} from "@/lib/ceo/google-ads-users-shared";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";

// Assumed gross margin for the LTV scenario table. The measured full model
// (data costs, AI cost, Stripe fees) lives on /dashboard/cac-ltv; this page
// only needs a defensible constant to turn ARPA into gross profit.
const ASSUMED_GROSS_MARGIN_PCT = 80;
const LTV_CHURN_SCENARIOS_PCT = [3, 5, 8];

const FEATURE_LABELS: Record<string, string> = {
  diagnostics: "Ran a diagnostic",
  chat: "Used diagnostic chat",
  ai_search: "Used AI search",
  vrm_lookups: "Looked up a VRM",
  infopro_vehicles: "Opened InfoPro data",
  motor_vehicles: "Opened Motor data",
};

type AttributionRow = {
  internal_user_id: string;
  first_campaign: string | null;
  google_ads_campaign: string | null;
  channel: string;
};

type UserRow = {
  internal_user_id: string;
  workshop_id: string | null;
  signed_up_at: string | null;
  last_seen_at: string | null;
  churned_at: string | null;
};

type WorkshopRow = {
  workshop_id: string;
  plan_key: string | null;
  country: string | null;
};

type SubscriptionRow = {
  workshop_id: string | null;
  status: string;
  trial_end: string | null;
  current_period_start: string | null;
  metadata: Record<string, unknown> | null;
};

type DiagnosticRow = {
  internal_user_id: string | null;
  created_at: string | null;
  has_chat: boolean;
};

type FeatureUsageRow = {
  internal_user_id: string;
  feature_key: string;
};

type SpendRow = {
  metric_key: string;
  period_start: string;
  value: number;
};

const DAY_MS = 86_400_000;
const AVG_MONTH_DAYS = 30.44;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS;
}

function tierOfPlan(planKey: string | null): CacLtvTierKey | null {
  if (!planKey) return null;
  const prefix = planKey.split("_")[0];
  const tier = CAC_LTV_TIERS.find((t) => t.key === prefix);
  return tier ? tier.key : null;
}

function emptyData(error?: string): GoogleAdsUsersData {
  return {
    generatedAt: new Date().toISOString(),
    totalUsers: 0,
    adsEraUsers: 0,
    adsUsers: 0,
    adsShareOfAdsEraPct: 0,
    adsShareOfAllPct: 0,
    attributedUsers: 0,
    attributionCoveragePct: 0,
    adsPayerWorkshops: 0,
    monthlySignups: [],
    behavior: [],
    featureAdoption: [],
    monetization: [],
    planMix: [],
    campaigns: [],
    countries: [],
    economics: {
      spendUsd: 0,
      spendSek: 0,
      spendSinceDate: "",
      adClicks: 0,
      costPerSignupSek: null,
      cacPerPayerSek: null,
      arpaSekPerPayerMonth: null,
      assumedGrossMarginPct: ASSUMED_GROSS_MARGIN_PCT,
      scenarios: [],
    },
    error,
  };
}

async function getGoogleAdsUsersDataUncached(): Promise<GoogleAdsUsersData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return emptyData("Supabase is not configured.");
  }

  const [attributionRes, usersRes, workshopsRes, subsRes, diagsRes, featuresRes, spendRes] =
    await Promise.all([
      pageAll<AttributionRow>(({ from, to }) =>
        supabase
          .from(TABLES.userAttribution)
          .select("internal_user_id, first_campaign, google_ads_campaign, channel")
          .order("internal_user_id")
          .range(from, to),
      ),
      pageAll<UserRow>(({ from, to }) =>
        supabase
          .from(TABLES.users)
          .select("internal_user_id, workshop_id, signed_up_at, last_seen_at, churned_at")
          .eq("is_internal_test", false)
          .order("internal_user_id")
          .range(from, to),
      ),
      pageAll<WorkshopRow>(({ from, to }) =>
        supabase
          .from(TABLES.workshops)
          .select("workshop_id, plan_key, country")
          .eq("is_internal_test", false)
          .order("workshop_id")
          .range(from, to),
      ),
      pageAll<SubscriptionRow>(({ from, to }) =>
        supabase
          .from(TABLES.subscriptions)
          .select("workshop_id, status, trial_end, current_period_start, metadata")
          .order("stripe_subscription_id")
          .range(from, to),
      ),
      pageAll<DiagnosticRow>(({ from, to }) =>
        supabase
          .from(TABLES.diagnostics)
          .select("internal_user_id, created_at, has_chat")
          .order("diagnostic_id")
          .range(from, to),
      ),
      pageAll<FeatureUsageRow>(({ from, to }) =>
        supabase
          .from(TABLES.featureUsage)
          .select("internal_user_id, feature_key")
          .order("internal_user_id")
          .order("feature_key")
          .order("granularity")
          .order("period_start")
          .range(from, to),
      ),
      pageAll<SpendRow>(({ from, to }) =>
        supabase
          .from(TABLES.metricSnapshots)
          .select("metric_key, period_start, value")
          // Spend/clicks land one row per (campaign, day) with no "total"
          // dimension row - sum across campaigns, do not filter on
          // dimension_key.
          .eq("source_key", "google_ads")
          .in("metric_key", ["ad_spend", "ad_clicks"])
          .order("id")
          .range(from, to),
      ),
    ]);

  const firstError =
    attributionRes.error ??
    usersRes.error ??
    workshopsRes.error ??
    subsRes.error ??
    diagsRes.error ??
    featuresRes.error ??
    spendRes.error;
  if (firstError) {
    return emptyData(firstError.message);
  }

  const nowIso = new Date().toISOString();

  // ---- attribution + cohorts ----------------------------------------------

  const attributionByUser = new Map(
    attributionRes.data.map((row) => [row.internal_user_id, row]),
  );

  const users = usersRes.data.filter((u) => u.signed_up_at !== null);
  const cohortOfUser = new Map<string, CohortKey>();
  for (const user of users) {
    const signedUp = user.signed_up_at!;
    const channel = attributionByUser.get(user.internal_user_id)?.channel ?? null;
    if (signedUp < ADS_ERA_START) {
      cohortOfUser.set(user.internal_user_id, "pre_ads");
    } else if (channel === "google_ads") {
      cohortOfUser.set(user.internal_user_id, "google_ads");
    } else {
      cohortOfUser.set(user.internal_user_id, "ads_era_other");
    }
  }

  const usersByCohort: Record<CohortKey, UserRow[]> = {
    google_ads: [],
    ads_era_other: [],
    pre_ads: [],
  };
  for (const user of users) {
    usersByCohort[cohortOfUser.get(user.internal_user_id)!].push(user);
  }

  // Workshop cohort: a workshop is ad-acquired when ANY of its users is;
  // otherwise it inherits the era of its earliest signup.
  const workshopIds = new Set(workshopsRes.data.map((w) => w.workshop_id));
  const usersByWorkshop = new Map<string, UserRow[]>();
  const signupAtByWorkshop = new Map<string, string>();
  for (const user of users) {
    if (!user.workshop_id || !workshopIds.has(user.workshop_id)) continue;
    const list = usersByWorkshop.get(user.workshop_id) ?? [];
    list.push(user);
    usersByWorkshop.set(user.workshop_id, list);
    const prev = signupAtByWorkshop.get(user.workshop_id);
    if (!prev || user.signed_up_at! < prev) {
      signupAtByWorkshop.set(user.workshop_id, user.signed_up_at!);
    }
  }
  const cohortOfWorkshop = new Map<string, CohortKey>();
  for (const [workshopId, workshopUsers] of usersByWorkshop) {
    const hasAds = workshopUsers.some(
      (u) => cohortOfUser.get(u.internal_user_id) === "google_ads",
    );
    if (hasAds) {
      cohortOfWorkshop.set(workshopId, "google_ads");
    } else {
      const signupAt = signupAtByWorkshop.get(workshopId)!;
      cohortOfWorkshop.set(workshopId, signupAt < ADS_ERA_START ? "pre_ads" : "ads_era_other");
    }
  }

  // ---- subscriptions: trials, payers, first-paid (mirrors /funnel) --------

  const everPaidWorkshops = new Set<string>();
  const trialingWorkshops = new Set<string>();
  const activeOrPastDueWorkshops = new Set<string>();
  const trialedWorkshops = new Set<string>();
  const firstPaidByWorkshop = new Map<string, string>();
  for (const sub of subsRes.data) {
    if (!sub.workshop_id || !workshopIds.has(sub.workshop_id)) continue;
    const meta = sub.metadata ?? {};
    if (sub.status === "trialing") trialingWorkshops.add(sub.workshop_id);
    if (sub.status === "active" || sub.status === "past_due") {
      activeOrPastDueWorkshops.add(sub.workshop_id);
    }
    if (sub.trial_end) trialedWorkshops.add(sub.workshop_id);
    if (String(meta["ever_paid"]) === "true") everPaidWorkshops.add(sub.workshop_id);

    const metaFirstPaid =
      typeof meta["first_paid_at"] === "string" ? (meta["first_paid_at"] as string) : null;
    let paidStart: string | null = metaFirstPaid;
    if (!paidStart && sub.status !== "trialing") {
      paidStart =
        sub.trial_end && sub.current_period_start && sub.trial_end > sub.current_period_start
          ? sub.trial_end
          : sub.current_period_start;
    }
    if (!paidStart) continue;
    const prev = firstPaidByWorkshop.get(sub.workshop_id);
    if (!prev || paidStart < prev) firstPaidByWorkshop.set(sub.workshop_id, paidStart);
  }

  const workshopByIdMap = new Map(workshopsRes.data.map((w) => [w.workshop_id, w]));
  const paidCohortIds = new Set(
    workshopsRes.data
      .filter((w) => w.plan_key != null && PAID_PLANS.has(w.plan_key))
      .map((w) => w.workshop_id),
  );
  for (const id of everPaidWorkshops) paidCohortIds.add(id);
  const payerWorkshopIds = new Set(
    [...paidCohortIds].filter(
      (id) =>
        !(
          trialingWorkshops.has(id) &&
          !everPaidWorkshops.has(id) &&
          !activeOrPastDueWorkshops.has(id)
        ),
    ),
  );

  // ---- product behaviour ----------------------------------------------------

  const firstDiagnosticByUser = new Map<string, string>();
  const diagnosticsCountByUser = new Map<string, number>();
  const chatUsers = new Set<string>();
  for (const diag of diagsRes.data) {
    if (!diag.internal_user_id) continue;
    diagnosticsCountByUser.set(
      diag.internal_user_id,
      (diagnosticsCountByUser.get(diag.internal_user_id) ?? 0) + 1,
    );
    if (diag.has_chat) chatUsers.add(diag.internal_user_id);
    if (!diag.created_at) continue;
    const prev = firstDiagnosticByUser.get(diag.internal_user_id);
    if (!prev || diag.created_at < prev) {
      firstDiagnosticByUser.set(diag.internal_user_id, diag.created_at);
    }
  }

  const featureUsersByKey = new Map<string, Set<string>>();
  for (const row of featuresRes.data) {
    const set = featureUsersByKey.get(row.feature_key) ?? new Set<string>();
    set.add(row.internal_user_id);
    featureUsersByKey.set(row.feature_key, set);
  }

  const behavior: CohortBehavior[] = COHORT_KEYS.map((key) => {
    const cohortUsers = usersByCohort[key];
    const activated = cohortUsers.filter((u) =>
      firstDiagnosticByUser.has(u.internal_user_id),
    );
    const daysToFirst = activated
      .map((u) => daysBetween(u.signed_up_at!, firstDiagnosticByUser.get(u.internal_user_id)!))
      .filter((d) => d >= 0);
    const diagCounts = activated.map(
      (u) => diagnosticsCountByUser.get(u.internal_user_id) ?? 0,
    );
    const withChat = cohortUsers.filter((u) => chatUsers.has(u.internal_user_id)).length;
    const activeLast30d = cohortUsers.filter(
      (u) => u.last_seen_at && daysBetween(u.last_seen_at, nowIso) <= 30,
    ).length;
    const churned = cohortUsers.filter((u) => u.churned_at !== null).length;
    const cohortWorkshops = new Set(
      cohortUsers.map((u) => u.workshop_id).filter((id): id is string => id !== null),
    );

    return {
      key,
      label: COHORT_LABELS[key],
      users: cohortUsers.length,
      workshops: cohortWorkshops.size,
      activatedUsers: activated.length,
      activationPct: pct(activated.length, cohortUsers.length),
      medianDaysToFirstDiagnostic: median(daysToFirst),
      medianDiagnosticsPerActivated: median(diagCounts),
      usersWithChatPct: pct(withChat, cohortUsers.length),
      activeLast30dPct: pct(activeLast30d, cohortUsers.length),
      churnedPct: pct(churned, cohortUsers.length),
    };
  });

  const featureAdoption: FeatureAdoptionRow[] = Object.entries(FEATURE_LABELS).map(
    ([featureKey, label]) => {
      const pctByCohort = {} as Record<CohortKey, number>;
      for (const key of COHORT_KEYS) {
        const cohortUsers = usersByCohort[key];
        const active =
          featureKey === "diagnostics"
            ? cohortUsers.filter((u) => firstDiagnosticByUser.has(u.internal_user_id)).length
            : cohortUsers.filter((u) =>
                featureUsersByKey.get(featureKey)?.has(u.internal_user_id),
              ).length;
        pctByCohort[key] = pct(active, cohortUsers.length);
      }
      return { featureKey, label, pctByCohort };
    },
  );

  // ---- monetization ---------------------------------------------------------

  const tierPriceSek = new Map(CAC_LTV_TIERS.map((t) => [t.key, t.listPriceSek]));

  const monetization: CohortMonetization[] = COHORT_KEYS.map((key) => {
    const cohortWorkshopIds = [...cohortOfWorkshop.entries()]
      .filter(([, cohort]) => cohort === key)
      .map(([id]) => id);
    const trialed = cohortWorkshopIds.filter((id) => trialedWorkshops.has(id));
    const payers = cohortWorkshopIds.filter((id) => payerWorkshopIds.has(id));
    const activeSubs = payers.filter((id) => activeOrPastDueWorkshops.has(id));
    const daysToPaid = payers
      .map((id) => {
        const signupAt = signupAtByWorkshop.get(id);
        const firstPaid = firstPaidByWorkshop.get(id);
        return signupAt && firstPaid ? daysBetween(signupAt, firstPaid) : null;
      })
      .filter((d): d is number => d !== null && d >= 0);

    let estMrrSek = 0;
    let estRevenueToDateSek = 0;
    for (const id of payers) {
      const tier = tierOfPlan(workshopByIdMap.get(id)?.plan_key ?? null);
      const priceSek = tier ? (tierPriceSek.get(tier) ?? 0) : 0;
      if (activeOrPastDueWorkshops.has(id)) estMrrSek += priceSek;
      const firstPaid = firstPaidByWorkshop.get(id);
      if (firstPaid && priceSek > 0) {
        const monthsBilled = Math.max(
          1,
          Math.ceil(daysBetween(firstPaid, nowIso) / AVG_MONTH_DAYS),
        );
        estRevenueToDateSek += monthsBilled * priceSek;
      }
    }

    return {
      key,
      label: COHORT_LABELS[key],
      workshops: cohortWorkshopIds.length,
      trialWorkshops: trialed.length,
      trialPct: pct(trialed.length, cohortWorkshopIds.length),
      payerWorkshops: payers.length,
      payerPct: pct(payers.length, cohortWorkshopIds.length),
      trialToPaidPct: pct(payers.length, trialed.length),
      activeSubWorkshops: activeSubs.length,
      medianDaysToFirstPaid: median(daysToPaid),
      estMrrSek,
      estRevenueToDateSek,
    };
  });

  const planMix: PlanMixRow[] = CAC_LTV_TIERS.map((tier) => {
    let adsPayers = 0;
    let otherPayers = 0;
    for (const id of payerWorkshopIds) {
      if (tierOfPlan(workshopByIdMap.get(id)?.plan_key ?? null) !== tier.key) continue;
      if (cohortOfWorkshop.get(id) === "google_ads") adsPayers += 1;
      else otherPayers += 1;
    }
    return { tierKey: tier.key, tierLabel: tier.label, adsPayers, otherPayers };
  });

  // ---- campaigns ------------------------------------------------------------

  const campaignStats = new Map<
    string,
    { users: number; activated: number; payerWorkshops: Set<string> }
  >();
  for (const user of usersByCohort.google_ads) {
    const attribution = attributionByUser.get(user.internal_user_id);
    const campaign =
      attribution?.google_ads_campaign ||
      attribution?.first_campaign ||
      "(campaign withheld by GA4)";
    const stats =
      campaignStats.get(campaign) ??
      ({ users: 0, activated: 0, payerWorkshops: new Set<string>() } as {
        users: number;
        activated: number;
        payerWorkshops: Set<string>;
      });
    stats.users += 1;
    if (firstDiagnosticByUser.has(user.internal_user_id)) stats.activated += 1;
    if (user.workshop_id && payerWorkshopIds.has(user.workshop_id)) {
      stats.payerWorkshops.add(user.workshop_id);
    }
    campaignStats.set(campaign, stats);
  }
  const campaigns: CampaignRow[] = [...campaignStats.entries()]
    .map(([campaign, stats]) => ({
      campaign,
      users: stats.users,
      activatedUsers: stats.activated,
      payerWorkshops: stats.payerWorkshops.size,
      signupToPaidPct: pct(stats.payerWorkshops.size, stats.users),
    }))
    .sort((a, b) => b.users - a.users);

  // ---- countries ------------------------------------------------------------

  const countryStats = new Map<string, { users: number; payerWorkshops: Set<string> }>();
  for (const user of usersByCohort.google_ads) {
    const country =
      (user.workshop_id ? workshopByIdMap.get(user.workshop_id)?.country : null) ?? "Unknown";
    const stats =
      countryStats.get(country) ?? { users: 0, payerWorkshops: new Set<string>() };
    stats.users += 1;
    if (user.workshop_id && payerWorkshopIds.has(user.workshop_id)) {
      stats.payerWorkshops.add(user.workshop_id);
    }
    countryStats.set(country, stats);
  }
  const countries: CountryRow[] = [...countryStats.entries()]
    .map(([country, stats]) => ({
      country,
      users: stats.users,
      payerWorkshops: stats.payerWorkshops.size,
    }))
    .sort((a, b) => b.users - a.users)
    .slice(0, 10);

  // ---- monthly signups + coverage -------------------------------------------

  const monthly = new Map<string, MonthlySignupRow & { attributed: number; total: number }>();
  for (const user of users) {
    const month = user.signed_up_at!.slice(0, 7);
    const row =
      monthly.get(month) ??
      ({
        month,
        googleAds: 0,
        adsEraOther: 0,
        preAds: 0,
        attributedPct: 0,
        attributed: 0,
        total: 0,
      } as MonthlySignupRow & { attributed: number; total: number });
    const cohort = cohortOfUser.get(user.internal_user_id)!;
    if (cohort === "google_ads") row.googleAds += 1;
    else if (cohort === "ads_era_other") row.adsEraOther += 1;
    else row.preAds += 1;
    if (attributionByUser.has(user.internal_user_id)) row.attributed += 1;
    row.total += 1;
    monthly.set(month, row);
  }
  const monthlySignups: MonthlySignupRow[] = [...monthly.values()]
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map(({ attributed, total, ...row }) => ({
      ...row,
      attributedPct: pct(attributed, total),
    }));

  // ---- economics -------------------------------------------------------------

  let spendUsd = 0;
  let adClicks = 0;
  let spendSinceDate = "";
  for (const row of spendRes.data) {
    if (row.metric_key === "ad_spend") {
      spendUsd += Number(row.value);
      const day = row.period_start.slice(0, 10);
      if (Number(row.value) > 0 && (!spendSinceDate || day < spendSinceDate)) {
        spendSinceDate = day;
      }
    } else if (row.metric_key === "ad_clicks") {
      adClicks += Number(row.value);
    }
  }
  const spendSek = spendUsd * USD_TO_SEK;

  const adsUsers = usersByCohort.google_ads.length;
  const adsPayerIds = [...cohortOfWorkshop.entries()]
    .filter(([id, cohort]) => cohort === "google_ads" && payerWorkshopIds.has(id))
    .map(([id]) => id);

  let adsActivePayerPriceSekTotal = 0;
  let adsActivePayerCount = 0;
  for (const id of adsPayerIds) {
    if (!activeOrPastDueWorkshops.has(id)) continue;
    const tier = tierOfPlan(workshopByIdMap.get(id)?.plan_key ?? null);
    if (!tier) continue;
    adsActivePayerPriceSekTotal += tierPriceSek.get(tier) ?? 0;
    adsActivePayerCount += 1;
  }
  const arpaSekPerPayerMonth =
    adsActivePayerCount > 0 ? adsActivePayerPriceSekTotal / adsActivePayerCount : null;
  const costPerSignupSek = adsUsers > 0 ? spendSek / adsUsers : null;
  const cacPerPayerSek = adsPayerIds.length > 0 ? spendSek / adsPayerIds.length : null;

  const scenarios: LtvScenarioRow[] = LTV_CHURN_SCENARIOS_PCT.map((churnPct) => {
    const grossProfitPerMonth =
      (arpaSekPerPayerMonth ?? 0) * (ASSUMED_GROSS_MARGIN_PCT / 100);
    const ltvSek = churnPct > 0 ? grossProfitPerMonth / (churnPct / 100) : 0;
    return {
      monthlyChurnPct: churnPct,
      ltvSek,
      ltvCacRatio: cacPerPayerSek && cacPerPayerSek > 0 ? ltvSek / cacPerPayerSek : null,
      paybackMonths:
        grossProfitPerMonth > 0 && cacPerPayerSek !== null
          ? cacPerPayerSek / grossProfitPerMonth
          : null,
    };
  });

  const economics: GoogleAdsEconomics = {
    spendUsd,
    spendSek,
    spendSinceDate,
    adClicks,
    costPerSignupSek,
    cacPerPayerSek,
    arpaSekPerPayerMonth,
    assumedGrossMarginPct: ASSUMED_GROSS_MARGIN_PCT,
    scenarios,
  };

  // ---- headline ---------------------------------------------------------------

  const adsEraUsers = usersByCohort.google_ads.length + usersByCohort.ads_era_other.length;
  const attributedUsers = users.filter((u) => attributionByUser.has(u.internal_user_id)).length;
  const adsEraAttributed = users.filter(
    (u) => u.signed_up_at! >= ADS_ERA_START && attributionByUser.has(u.internal_user_id),
  ).length;

  return {
    generatedAt: nowIso,
    totalUsers: users.length,
    adsEraUsers,
    adsUsers,
    adsShareOfAdsEraPct: pct(adsUsers, adsEraUsers),
    adsShareOfAllPct: pct(adsUsers, users.length),
    attributedUsers,
    attributionCoveragePct: pct(adsEraAttributed, adsEraUsers),
    adsPayerWorkshops: adsPayerIds.length,
    monthlySignups,
    behavior,
    featureAdoption,
    monetization,
    planMix,
    campaigns,
    countries,
    economics,
  };
}

export const getGoogleAdsUsersData = unstable_cache(
  getGoogleAdsUsersDataUncached,
  ["ceo-google-ads-users-data"],
  CEO_CACHE_OPTIONS,
);

import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { toStockholmIsoDate } from "@/lib/ceo/dates";
import {
  FEATURE_USAGE_FEATURES,
  type FeatureUsageFeatureKey,
} from "@/lib/ceo/feature-usage-shared";
import {
  FREE_USERS_PAID_TIERS,
  type ActivationStats,
  type ActivityBucketRow,
  type CohortRow,
  type CountryRow,
  type EngagedFreeUserRow,
  type FeatureMixRow,
  type FreeUsersData,
  type FreeUsersKpis,
  type LiveTrialRow,
  type NewPaidTrendRow,
  type PaidTierKey,
  type PaymentFailedRow,
  type RevertedWorkshopRow,
  type TierStatusBreakdown,
  type UpgradeFunnel,
} from "@/lib/ceo/free-users-shared";
import { loadInternalTestSets } from "@/lib/ceo/internal-test/loader";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";

// Free Users (/dashboard/free-users).
//
// The freemium base analysed end-to-end: how many free users actually use the
// product (and how often), and how many workshops have converted onto a paid
// tier (One / Small / Large). All reads are all-history and cheap — every
// table touched here is a few thousand rows at most — so the page ignores the
// time-range pills and uses fixed 7/30-day activity windows plus lifetime
// funnel views.
//
// "Active" is behaviour-based (feature events + diagnostics), NOT login-based:
// logins are a misleading activity signal in this app (long-lived sessions,
// median 1 login event ever — see the Plan Stats page notes). Logins are only
// used as a last-resort "last seen" fallback.

const NOTE =
  "Free = current plan on the workshop (dashboard_workshops.plan_key, Stripe-synced). " +
  "Every signup lands on Free — there is no direct paid signup — so every paid workshop " +
  "is a converted free user. Upgrading starts a 14-day card-required trial; cancelling " +
  "reverts the workshop to Free, which means the free pool also contains reverted " +
  "upgrades (identified by a Stripe subscription id on a free workshop). Activity unions " +
  "per-day feature counters (dashboard_feature_usage, history starts 2026-06-11) with the " +
  "full diagnostics history (dashboard_diagnostics). Internal-test accounts are excluded " +
  "everywhere.";

type WorkshopDbRow = {
  workshop_id: string;
  name: string | null;
  country: string | null;
  plan_key: string | null;
  core_subscription_status: string | null;
  payment_status: string | null;
  trial_end: string | null;
  core_stripe_customer_id: string | null;
  core_stripe_subscription_id: string | null;
  created_at: string | null;
  churned_at: string | null;
};

type UserDbRow = {
  internal_user_id: string;
  workshop_id: string | null;
  name: string | null;
  metadata: Record<string, unknown> | null;
  signed_up_at: string | null;
};

type DiagnosticDbRow = {
  internal_user_id: string | null;
  created_at: string | null;
};

type FeatureUsageDbRow = {
  internal_user_id: string;
  feature_key: string;
  period_start: string;
  usage_count: number;
};

type LoginDbRow = {
  internal_user_id: string;
  logged_in_at: string;
};

type SnapshotDbRow = {
  period_start: string;
  value: number | string | null;
};

type TierKey = "free" | PaidTierKey | "unknown";

const PAID_TIER_KEYS = FREE_USERS_PAID_TIERS.map((tier) => tier.key);

function tierFromPlanKey(planKey: string | null): TierKey {
  if (!planKey) return "unknown";
  if (planKey === "free") return "free";
  const head = planKey.split("_")[0];
  return (PAID_TIER_KEYS as string[]).includes(head)
    ? (head as PaidTierKey)
    : "unknown";
}

function isFeatureKey(value: string): value is FeatureUsageFeatureKey {
  return FEATURE_USAGE_FEATURES.some((feature) => feature.key === value);
}

function metaString(
  metadata: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return round1((numerator / denominator) * 100);
}

function emptyData(): FreeUsersData {
  return {
    note: "Supabase service credentials are not configured in this environment.",
    kpis: {
      freeUsers: 0,
      freeWorkshops: 0,
      active7d: 0,
      active30d: 0,
      everActive: 0,
      everDiagnosed: 0,
      paidWorkshopsNow: 0,
      payingActiveNow: 0,
      trialingNow: 0,
      pastDueNow: 0,
      conversionRatePct: 0,
    },
    tiers: [],
    activityBuckets: [],
    featureMix: [],
    activation: {
      everDiagnosedPct: 0,
      firstDiagDay1Pct: 0,
      medianDaysToFirstDiag: null,
      returnedAfterWeekPct: 0,
      returnedAfterWeekBase: 0,
    },
    cohorts: [],
    countries: [],
    newPaidTrend: [],
    engagedUsers: [],
    funnel: {
      freeNow: 0,
      checkoutStarted: 0,
      trialsStarted: 0,
      paidManualNoStripe: 0,
      trialingNow: 0,
      payingNow: 0,
      pastDueNow: 0,
      revertedToFree: 0,
      revertedNeverUsed: 0,
      abandonedCheckout: 0,
      completedTrials: 0,
      trialSurvivalPct: 0,
      payingSurvivalPct: 0,
    },
    liveTrials: [],
    revertedWorkshops: [],
    paymentFailed: [],
  };
}

async function getFreeUsersDataUncached(): Promise<FreeUsersData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyData();

  const sets = await loadInternalTestSets();

  const [workshopsResult, usersResult, diagnosticsResult, featureResult, loginResult, snapshotResult] =
    await Promise.all([
      pageAll<WorkshopDbRow>(({ from, to }) =>
        supabase
          .from(TABLES.workshops)
          .select("workshop_id, name, country, plan_key, core_subscription_status, payment_status, trial_end, core_stripe_customer_id, core_stripe_subscription_id, created_at, churned_at")
          .order("workshop_id", { ascending: true })
          .range(from, to),
      ),
      pageAll<UserDbRow>(({ from, to }) =>
        supabase
          .from(TABLES.users)
          .select("internal_user_id, workshop_id, name, metadata, signed_up_at")
          .order("internal_user_id", { ascending: true })
          .range(from, to),
      ),
      pageAll<DiagnosticDbRow>(({ from, to }) =>
        supabase
          .from(TABLES.diagnostics)
          .select("internal_user_id, created_at")
          .order("diagnostic_id", { ascending: true })
          .range(from, to),
      ),
      pageAll<FeatureUsageDbRow>(({ from, to }) =>
        supabase
          .from(TABLES.featureUsage)
          .select("internal_user_id, feature_key, period_start, usage_count")
          .eq("granularity", "day")
          .order("period_start", { ascending: true })
          .order("internal_user_id", { ascending: true })
          .order("feature_key", { ascending: true })
          .range(from, to),
      ),
      pageAll<LoginDbRow>(({ from, to }) =>
        supabase
          .from(TABLES.userLogins)
          .select("internal_user_id, logged_in_at")
          .order("logged_in_at", { ascending: true })
          .order("internal_user_id", { ascending: true })
          .range(from, to),
      ),
      pageAll<SnapshotDbRow>(({ from, to }) =>
        supabase
          .from(TABLES.metricSnapshots)
          .select("period_start, value")
          .eq("source_key", "stripe")
          .eq("metric_key", "new_paid_workshops")
          .order("period_start", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);

  if (workshopsResult.error) throw new Error(workshopsResult.error.message);
  if (usersResult.error) throw new Error(usersResult.error.message);
  if (diagnosticsResult.error) throw new Error(diagnosticsResult.error.message);
  if (featureResult.error) throw new Error(featureResult.error.message);
  if (loginResult.error) throw new Error(loginResult.error.message);
  if (snapshotResult.error) throw new Error(snapshotResult.error.message);

  // ---- Internal-test exclusion + identity maps ---------------------------
  const workshops = workshopsResult.data.filter(
    (row) => !sets.workshopIds.has(row.workshop_id),
  );
  const workshopById = new Map(workshops.map((row) => [row.workshop_id, row]));

  const users = usersResult.data.filter(
    (row) =>
      !sets.userIds.has(row.internal_user_id) &&
      (!row.workshop_id || !sets.workshopIds.has(row.workshop_id)),
  );
  const userById = new Map(users.map((row) => [row.internal_user_id, row]));

  const userTier = (userId: string): TierKey => {
    const user = userById.get(userId);
    const workshop = user?.workshop_id
      ? workshopById.get(user.workshop_id)
      : undefined;
    return workshop ? tierFromPlanKey(workshop.plan_key) : "unknown";
  };

  const freeUserIds = new Set(
    users
      .filter((row) => userTier(row.internal_user_id) === "free")
      .map((row) => row.internal_user_id),
  );

  const diagnostics = diagnosticsResult.data.filter(
    (row): row is DiagnosticDbRow & { internal_user_id: string; created_at: string } =>
      Boolean(row.internal_user_id) &&
      Boolean(row.created_at) &&
      userById.has(row.internal_user_id ?? ""),
  );
  const featureRows = featureResult.data.filter(
    (row) => userById.has(row.internal_user_id) && isFeatureKey(row.feature_key),
  );
  const loginRows = loginResult.data.filter((row) =>
    userById.has(row.internal_user_id),
  );

  // ---- Fixed activity windows (Stockholm civil days) ---------------------
  const now = new Date();
  const todayIso = toStockholmIsoDate(now);
  const cutoff7 = toStockholmIsoDate(new Date(now.getTime() - 7 * 86400_000));
  const cutoff30 = toStockholmIsoDate(new Date(now.getTime() - 30 * 86400_000));

  // Per-user activity days: union of feature-counter days and diagnostic days.
  const activityDays = new Map<string, Set<string>>();
  const addActivityDay = (userId: string, day: string) => {
    let days = activityDays.get(userId);
    if (!days) {
      days = new Set();
      activityDays.set(userId, days);
    }
    days.add(day);
  };

  const featureEvents30dByUser = new Map<string, number>();
  for (const row of featureRows) {
    const count = Number(row.usage_count) || 0;
    if (count <= 0) continue;
    addActivityDay(row.internal_user_id, row.period_start);
    if (row.period_start >= cutoff30 && row.period_start <= todayIso) {
      featureEvents30dByUser.set(
        row.internal_user_id,
        (featureEvents30dByUser.get(row.internal_user_id) ?? 0) + count,
      );
    }
  }

  const diagDaysByUser = new Map<string, string[]>();
  for (const row of diagnostics) {
    const day = toStockholmIsoDate(new Date(row.created_at));
    addActivityDay(row.internal_user_id, day);
    const list = diagDaysByUser.get(row.internal_user_id);
    if (list) list.push(day);
    else diagDaysByUser.set(row.internal_user_id, [day]);
  }

  const lastLoginDay = new Map<string, string>();
  for (const row of loginRows) {
    const day = toStockholmIsoDate(new Date(row.logged_in_at));
    const prev = lastLoginDay.get(row.internal_user_id);
    if (!prev || day > prev) lastLoginDay.set(row.internal_user_id, day);
  }

  // ---- KPIs ---------------------------------------------------------------
  let active7d = 0;
  let active30d = 0;
  let everActive = 0;
  const activeDays30dByUser = new Map<string, number>();
  for (const userId of freeUserIds) {
    const days = activityDays.get(userId);
    if (!days || days.size === 0) continue;
    everActive += 1;
    let in7 = false;
    let in30 = 0;
    for (const day of days) {
      if (day > todayIso) continue;
      if (day >= cutoff7) in7 = true;
      if (day >= cutoff30) in30 += 1;
    }
    if (in7) active7d += 1;
    if (in30 > 0) {
      active30d += 1;
      activeDays30dByUser.set(userId, in30);
    }
  }

  let everDiagnosed = 0;
  for (const userId of freeUserIds) {
    if (diagDaysByUser.has(userId)) everDiagnosed += 1;
  }

  const statusOf = (row: WorkshopDbRow) =>
    (row.core_subscription_status ?? "").toLowerCase();
  const paidWorkshops = workshops.filter((row) =>
    (PAID_TIER_KEYS as string[]).includes(tierFromPlanKey(row.plan_key)),
  );
  const freeWorkshops = workshops.filter(
    (row) => tierFromPlanKey(row.plan_key) === "free",
  );

  const kpis: FreeUsersKpis = {
    freeUsers: freeUserIds.size,
    freeWorkshops: freeWorkshops.length,
    active7d,
    active30d,
    everActive,
    everDiagnosed,
    paidWorkshopsNow: paidWorkshops.length,
    payingActiveNow: paidWorkshops.filter((row) => statusOf(row) === "active")
      .length,
    trialingNow: paidWorkshops.filter((row) => statusOf(row) === "trialing")
      .length,
    pastDueNow: paidWorkshops.filter((row) => statusOf(row) === "past_due")
      .length,
    conversionRatePct: pct(paidWorkshops.length, workshops.length),
  };

  // ---- Paid tier breakdown ------------------------------------------------
  const tiers: TierStatusBreakdown[] = FREE_USERS_PAID_TIERS.map((tier) => {
    const rows = paidWorkshops.filter(
      (row) => tierFromPlanKey(row.plan_key) === tier.key,
    );
    const active = rows.filter((row) => statusOf(row) === "active").length;
    const trialing = rows.filter((row) => statusOf(row) === "trialing").length;
    const pastDue = rows.filter((row) => statusOf(row) === "past_due").length;
    const countryCounts = new Map<string, number>();
    for (const row of rows) {
      const key = row.country?.trim().toUpperCase() || "—";
      countryCounts.set(key, (countryCounts.get(key) ?? 0) + 1);
    }
    return {
      tier: tier.key,
      label: tier.label,
      workshops: rows.length,
      active,
      trialing,
      pastDue,
      other: rows.length - active - trialing - pastDue,
      topCountries: [...countryCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([country, count]) => ({ country, workshops: count })),
    };
  });

  // ---- Frequency buckets (last 30 days, free users) ----------------------
  const bucketDefs: Array<{ bucket: string; min: number; max: number }> = [
    { bucket: "0 days (dormant)", min: 0, max: 0 },
    { bucket: "1 day", min: 1, max: 1 },
    { bucket: "2–4 days", min: 2, max: 4 },
    { bucket: "5–9 days", min: 5, max: 9 },
    { bucket: "10+ days", min: 10, max: Number.POSITIVE_INFINITY },
  ];
  const activityBuckets: ActivityBucketRow[] = bucketDefs.map((def) => {
    let count = 0;
    if (def.min === 0) {
      count = freeUserIds.size - active30d;
    } else {
      for (const days of activeDays30dByUser.values()) {
        if (days >= def.min && days <= def.max) count += 1;
      }
    }
    return {
      bucket: def.bucket,
      users: count,
      sharePct: pct(count, freeUserIds.size),
    };
  });

  // ---- Feature mix (free users) -------------------------------------------
  const mixAccumulator = new Map<
    FeatureUsageFeatureKey,
    { users30d: Set<string>; events30d: number; usersAll: Set<string>; eventsAll: number }
  >();
  for (const feature of FEATURE_USAGE_FEATURES) {
    mixAccumulator.set(feature.key, {
      users30d: new Set(),
      events30d: 0,
      usersAll: new Set(),
      eventsAll: 0,
    });
  }
  for (const row of featureRows) {
    if (!freeUserIds.has(row.internal_user_id)) continue;
    const count = Number(row.usage_count) || 0;
    if (count <= 0) continue;
    const acc = mixAccumulator.get(row.feature_key as FeatureUsageFeatureKey);
    if (!acc) continue;
    acc.usersAll.add(row.internal_user_id);
    acc.eventsAll += count;
    if (row.period_start >= cutoff30 && row.period_start <= todayIso) {
      acc.users30d.add(row.internal_user_id);
      acc.events30d += count;
    }
  }
  const featureMix: FeatureMixRow[] = FEATURE_USAGE_FEATURES.map((feature) => {
    const acc = mixAccumulator.get(feature.key);
    return {
      key: feature.key,
      label: feature.label,
      users30d: acc?.users30d.size ?? 0,
      events30d: acc?.events30d ?? 0,
      usersAll: acc?.usersAll.size ?? 0,
      eventsAll: acc?.eventsAll ?? 0,
    };
  }).sort((a, b) => b.users30d - a.users30d || b.usersAll - a.usersAll);

  // ---- Activation + repeat usage (free users, full diagnostics history) ---
  const dayDiffs: number[] = [];
  let firstDiagDay1 = 0;
  let returnedBase = 0;
  let returnedAfterWeek = 0;
  const cutoff14 = toStockholmIsoDate(new Date(now.getTime() - 14 * 86400_000));
  for (const userId of freeUserIds) {
    const days = diagDaysByUser.get(userId);
    if (!days || days.length === 0) continue;
    const sorted = [...days].sort();
    const firstDay = sorted[0];
    const lastDay = sorted[sorted.length - 1];
    const signedUpAt = userById.get(userId)?.signed_up_at;
    if (signedUpAt) {
      const signupDay = toStockholmIsoDate(new Date(signedUpAt));
      const diff = Math.round(
        (Date.parse(firstDay) - Date.parse(signupDay)) / 86400_000,
      );
      if (Number.isFinite(diff) && diff >= 0) {
        dayDiffs.push(diff);
        if (diff <= 1) firstDiagDay1 += 1;
      }
    }
    // Repeat usage: only judge users whose first diagnostic is at least 14
    // days old, so recent first-timers don't drag the return rate down.
    if (firstDay <= cutoff14) {
      returnedBase += 1;
      const weekAfterFirst = Math.round(Date.parse(firstDay) / 86400_000) + 7;
      if (Math.round(Date.parse(lastDay) / 86400_000) >= weekAfterFirst) {
        returnedAfterWeek += 1;
      }
    }
  }
  dayDiffs.sort((a, b) => a - b);
  const activation: ActivationStats = {
    everDiagnosedPct: pct(everDiagnosed, freeUserIds.size),
    firstDiagDay1Pct: pct(firstDiagDay1, dayDiffs.length),
    medianDaysToFirstDiag:
      dayDiffs.length > 0 ? dayDiffs[Math.floor(dayDiffs.length / 2)] : null,
    returnedAfterWeekPct: pct(returnedAfterWeek, returnedBase),
    returnedAfterWeekBase: returnedBase,
  };

  // ---- Signup cohorts (workshops, current plan) ---------------------------
  const cohortAccumulator = new Map<
    string,
    { workshops: number; stillFree: number; paid: number; payingActive: number; trialing: number }
  >();
  const monthOf = (value: string | null) =>
    value ? toStockholmIsoDate(new Date(value)).slice(0, 7) : null;
  const twelveMonthsAgo = toStockholmIsoDate(
    new Date(now.getTime() - 365 * 86400_000),
  ).slice(0, 7);
  for (const row of workshops) {
    const month = monthOf(row.created_at);
    const key = month && month >= twelveMonthsAgo ? month : "Earlier";
    let acc = cohortAccumulator.get(key);
    if (!acc) {
      acc = { workshops: 0, stillFree: 0, paid: 0, payingActive: 0, trialing: 0 };
      cohortAccumulator.set(key, acc);
    }
    acc.workshops += 1;
    const tier = tierFromPlanKey(row.plan_key);
    if (tier === "free") acc.stillFree += 1;
    if ((PAID_TIER_KEYS as string[]).includes(tier)) {
      acc.paid += 1;
      const status = statusOf(row);
      if (status === "active") acc.payingActive += 1;
      if (status === "trialing") acc.trialing += 1;
    }
  }
  const cohorts: CohortRow[] = [...cohortAccumulator.entries()]
    .map(([month, acc]) => ({
      month,
      workshops: acc.workshops,
      stillFree: acc.stillFree,
      paidTierNow: acc.paid,
      payingActive: acc.payingActive,
      trialing: acc.trialing,
      conversionPct: pct(acc.paid, acc.workshops),
    }))
    .sort((a, b) => {
      if (a.month === "Earlier") return 1;
      if (b.month === "Earlier") return -1;
      return b.month.localeCompare(a.month);
    });

  // ---- Country split -------------------------------------------------------
  const countryAccumulator = new Map<
    string,
    { workshops: number; free: number; paid: number; payingActive: number }
  >();
  for (const row of workshops) {
    const key = row.country?.trim().toUpperCase() || "—";
    let acc = countryAccumulator.get(key);
    if (!acc) {
      acc = { workshops: 0, free: 0, paid: 0, payingActive: 0 };
      countryAccumulator.set(key, acc);
    }
    acc.workshops += 1;
    const tier = tierFromPlanKey(row.plan_key);
    if (tier === "free") acc.free += 1;
    if ((PAID_TIER_KEYS as string[]).includes(tier)) {
      acc.paid += 1;
      if (statusOf(row) === "active") acc.payingActive += 1;
    }
  }
  const countries: CountryRow[] = [...countryAccumulator.entries()]
    .map(([country, acc]) => ({
      country,
      workshops: acc.workshops,
      freeWorkshops: acc.free,
      paidNow: acc.paid,
      payingActive: acc.payingActive,
      conversionPct: pct(acc.paid, acc.workshops),
    }))
    .sort((a, b) => b.workshops - a.workshops)
    .slice(0, 15);

  // ---- New-paid trend (Stripe daily counter, summed per month) ------------
  const trendAccumulator = new Map<string, number>();
  for (const row of snapshotResult.data) {
    const month = row.period_start.slice(0, 7);
    const value = Number(row.value) || 0;
    trendAccumulator.set(month, (trendAccumulator.get(month) ?? 0) + value);
  }
  const newPaidTrend: NewPaidTrendRow[] = [...trendAccumulator.entries()]
    .map(([month, newPaid]) => ({ month, newPaid }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // ---- Engaged free users (the upgrade-candidate list) --------------------
  const engaged: EngagedFreeUserRow[] = [];
  for (const userId of freeUserIds) {
    const days30 = activeDays30dByUser.get(userId) ?? 0;
    if (days30 === 0) continue;

    const featureEvents30d = featureEvents30dByUser.get(userId) ?? 0;
    const diagDays = diagDaysByUser.get(userId) ?? [];
    const diags30 = diagDays.filter((day) => day >= cutoff30).length;

    const user = userById.get(userId);
    const workshop = user?.workshop_id
      ? workshopById.get(user.workshop_id)
      : undefined;
    const allDays = [...(activityDays.get(userId) ?? [])];
    const loginDay = lastLoginDay.get(userId);
    if (loginDay) allDays.push(loginDay);
    allDays.sort();

    engaged.push({
      internalUserId: userId,
      name: user?.name ?? null,
      username: metaString(user?.metadata ?? null, "username"),
      company:
        metaString(user?.metadata ?? null, "company_name") ??
        workshop?.name ??
        null,
      workshopId: user?.workshop_id ?? null,
      country: workshop?.country ?? null,
      featureEvents30d,
      activeDays30d: days30,
      diags30d: diags30,
      diagsAll: diagDays.length,
      lastActiveDate: allDays.length > 0 ? allDays[allDays.length - 1] : null,
      signedUpAt: user?.signed_up_at ?? null,
    });
  }
  engaged.sort(
    (a, b) =>
      b.activeDays30d - a.activeDays30d ||
      b.featureEvents30d - a.featureEvents30d ||
      a.internalUserId.localeCompare(b.internalUserId),
  );

  // ---- Upgrade funnel: Free → 14-day card trial → paid --------------------
  // Every signup starts on Free; upgrading requires a card and starts a
  // 14-day trial; cancelling reverts to Free. Historical states are
  // reconstructed from Stripe fingerprints on the workshop row (see the
  // shared-file comment for the full mapping).
  const hasSubId = (row: WorkshopDbRow) =>
    Boolean(row.core_stripe_subscription_id);
  const hasCustId = (row: WorkshopDbRow) =>
    Boolean(row.core_stripe_customer_id);
  const isPaidTier = (row: WorkshopDbRow) =>
    (PAID_TIER_KEYS as string[]).includes(tierFromPlanKey(row.plan_key));

  // Per-workshop activity, aggregated up from its users.
  const workshopDays = new Map<string, Set<string>>();
  const workshopDiagDays = new Map<string, string[]>();
  for (const user of users) {
    if (!user.workshop_id) continue;
    const days = activityDays.get(user.internal_user_id);
    if (days) {
      let acc = workshopDays.get(user.workshop_id);
      if (!acc) {
        acc = new Set();
        workshopDays.set(user.workshop_id, acc);
      }
      for (const day of days) acc.add(day);
    }
    const diagDays = diagDaysByUser.get(user.internal_user_id);
    if (diagDays) {
      const list = workshopDiagDays.get(user.workshop_id);
      if (list) list.push(...diagDays);
      else workshopDiagDays.set(user.workshop_id, [...diagDays]);
    }
  }
  const workshopLastActive = (workshopId: string): string | null => {
    const days = workshopDays.get(workshopId);
    if (!days || days.size === 0) return null;
    let last: string | null = null;
    for (const day of days) {
      if (!last || day > last) last = day;
    }
    return last;
  };

  const revertedRows = freeWorkshops.filter(hasSubId);
  const abandonedRows = freeWorkshops.filter(
    (row) => hasCustId(row) && !hasSubId(row),
  );
  const trialsStarted =
    revertedRows.length + paidWorkshops.filter(hasSubId).length;
  const trialingWithSub = paidWorkshops.filter(
    (row) => statusOf(row) === "trialing" && hasSubId(row),
  ).length;
  const completedTrials = trialsStarted - trialingWithSub;
  const survivedPaying = paidWorkshops.filter(
    (row) => statusOf(row) === "active" && hasSubId(row),
  ).length;
  const survivedTotal = paidWorkshops.filter(
    (row) =>
      (statusOf(row) === "active" || statusOf(row) === "past_due") &&
      hasSubId(row),
  ).length;
  let revertedNeverUsed = 0;
  for (const row of revertedRows) {
    if ((workshopDiagDays.get(row.workshop_id)?.length ?? 0) === 0) {
      revertedNeverUsed += 1;
    }
  }

  const funnel: UpgradeFunnel = {
    freeNow: freeWorkshops.length,
    checkoutStarted:
      abandonedRows.length + revertedRows.length + paidWorkshops.filter(hasCustId).length,
    trialsStarted,
    paidManualNoStripe: paidWorkshops.filter((row) => !hasSubId(row)).length,
    trialingNow: kpis.trialingNow,
    payingNow: kpis.payingActiveNow,
    pastDueNow: kpis.pastDueNow,
    revertedToFree: revertedRows.length,
    revertedNeverUsed,
    abandonedCheckout: abandonedRows.length,
    completedTrials,
    trialSurvivalPct: pct(survivedTotal, completedTrials),
    payingSurvivalPct: pct(survivedPaying, completedTrials),
  };

  // Live trials — the rescue list, soonest deadline first.
  const cutoff14Days = toStockholmIsoDate(
    new Date(now.getTime() - 14 * 86400_000),
  );
  const liveTrials: LiveTrialRow[] = workshops
    .filter((row) => statusOf(row) === "trialing" && isPaidTier(row))
    .map((row) => {
      const days = workshopDays.get(row.workshop_id);
      let activeDays14 = 0;
      if (days) {
        for (const day of days) {
          if (day >= cutoff14Days && day <= todayIso) activeDays14 += 1;
        }
      }
      const diags14 = (workshopDiagDays.get(row.workshop_id) ?? []).filter(
        (day) => day >= cutoff14Days,
      ).length;
      const daysLeft = row.trial_end
        ? Math.ceil((Date.parse(row.trial_end) - now.getTime()) / 86400_000)
        : null;
      return {
        workshopId: row.workshop_id,
        name: row.name,
        tier: tierFromPlanKey(row.plan_key),
        country: row.country,
        trialEnd: row.trial_end,
        daysLeft,
        activeDays14,
        diags14,
        lastActiveDate: workshopLastActive(row.workshop_id),
      };
    })
    .sort((a, b) => {
      const aEnd = a.trialEnd ?? "9999";
      const bEnd = b.trialEnd ?? "9999";
      return aEnd.localeCompare(bEnd) || a.workshopId.localeCompare(b.workshopId);
    });

  // Reverted upgrades — the win-back list. Most recently active first, so
  // "cancelled but still using the product on Free" floats to the top.
  const revertedWorkshops: RevertedWorkshopRow[] = revertedRows
    .map((row) => {
      const days = workshopDays.get(row.workshop_id);
      let activeDays30 = 0;
      if (days) {
        for (const day of days) {
          if (day >= cutoff30 && day <= todayIso) activeDays30 += 1;
        }
      }
      return {
        workshopId: row.workshop_id,
        name: row.name,
        country: row.country,
        signupMonth: row.created_at
          ? toStockholmIsoDate(new Date(row.created_at)).slice(0, 7)
          : null,
        paymentFailed: (row.payment_status ?? "") === "payment_failed",
        diagsLifetime: workshopDiagDays.get(row.workshop_id)?.length ?? 0,
        activeDays30,
        lastActiveDate: workshopLastActive(row.workshop_id),
      };
    })
    .sort((a, b) => {
      const aLast = a.lastActiveDate ?? "";
      const bLast = b.lastActiveDate ?? "";
      return (
        bLast.localeCompare(aLast) ||
        b.diagsLifetime - a.diagsLifetime ||
        a.workshopId.localeCompare(b.workshopId)
      );
    })
    .slice(0, 30);

  // Payment failures — paid tiers past_due plus free workshops whose charge
  // failed (they were demoted to Free by the failure, not by choice).
  const paymentFailed: PaymentFailedRow[] = workshops
    .filter(
      (row) =>
        (isPaidTier(row) && statusOf(row) === "past_due") ||
        (tierFromPlanKey(row.plan_key) === "free" &&
          (row.payment_status ?? "") === "payment_failed"),
    )
    .map((row) => ({
      workshopId: row.workshop_id,
      name: row.name,
      tier: tierFromPlanKey(row.plan_key),
      country: row.country,
      status:
        statusOf(row) === "past_due"
          ? "past due"
          : "payment failed → reverted to Free",
    }))
    .sort(
      (a, b) =>
        (a.tier === "free" ? 1 : 0) - (b.tier === "free" ? 1 : 0) ||
        a.workshopId.localeCompare(b.workshopId),
    );

  return {
    note: NOTE,
    kpis,
    tiers,
    activityBuckets,
    featureMix,
    activation,
    cohorts,
    countries,
    newPaidTrend,
    engagedUsers: engaged.slice(0, 50),
    funnel,
    liveTrials,
    revertedWorkshops,
    paymentFailed,
  };
}

const getFreeUsersDataCached = unstable_cache(
  () => getFreeUsersDataUncached(),
  ["ceo-free-users-data"],
  CEO_CACHE_OPTIONS,
);

export function getFreeUsersData(): Promise<FreeUsersData> {
  return getFreeUsersDataCached();
}

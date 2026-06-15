import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { loadCountryFilterSets } from "@/lib/ceo/countries";
import { toStockholmIsoDate } from "@/lib/ceo/dates";
import { loadInternalTestSets } from "@/lib/ceo/internal-test/loader";
import { getActiveUsersData } from "@/lib/ceo/data/active-users";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";
import {
  FEATURE_USAGE_FEATURES,
  FEATURE_USAGE_FEATURE_KEYS,
  type FeatureUsageFeatureKey,
} from "@/lib/ceo/feature-usage-shared";
import {
  formatRangeDateSpan,
  isDashboardTimeRangeKey,
  resolveDashboardTimeRange,
  DEFAULT_TIME_RANGE_KEY,
  type DashboardTimeRangeKey,
} from "@/lib/ceo/time-ranges";
import {
  PLAN_TIERS,
  planTierFromKey,
  type PlanFeatureStat,
  type PlanStatRow,
  type PlanStatsData,
  type PlanTier,
} from "@/lib/ceo/plan-stats-shared";

// Plan Stats (/dashboard/plan-stats).
//
// Recreates the public pricing page (Free / One / Small / Large) and overlays
// the real first-party usage numbers onto each plan:
//   * how many app users and workshops are on the plan,
//   * how many are ACTIVE in the selected range (see below),
//   * and how many events each tracked feature counter has, per plan.
//
// The plan a user belongs to comes from their workshop's clean plan_key on
// dashboard_workshops ("free" / "one_monthly" / "small_yearly" / ...), which
// planTierFromKey() collapses to one of the four canonical tiers.
//
// "Active" is behaviour-based, NOT login-based. App sessions are long-lived
// (users rarely re-authenticate), so a login event is a poor activity signal:
// ~a third of users who used a feature in a given week had no login that week.
// Instead a user counts as active in the range if they did anything in the
// app: a GA4 engagement event on app.wrenchlane.com OR a diagnostic
// (both via getActiveUsersData) OR any tracked feature counter (which also
// catches mobile-only users that GA4's web-host filter would miss).
//
// Feature counters only exist from 2026-06-11 onward; GA4 engagement and
// diagnostics carry real history, so "Active" is reliable across longer ranges.

const FEATURE_KEYS = FEATURE_USAGE_FEATURE_KEYS;

export const PLAN_STATS_DEFAULT_RANGE_KEY: DashboardTimeRangeKey =
  // 30-day rolling window — the headline "Active" then reads as a 30-day
  // active count (MAU-style), which is the most useful default. Other ranges
  // stay available via the selector. (Earlier this was 90d to dodge the young
  // feature data, but most activity now falls inside 30 days anyway.)
  "last_30_days";

export function normalizePlanStatsRangeKey(
  value: string | string[] | undefined,
): DashboardTimeRangeKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isDashboardTimeRangeKey(candidate)
    ? candidate
    : PLAN_STATS_DEFAULT_RANGE_KEY;
}

function isFeatureKey(value: string): value is FeatureUsageFeatureKey {
  return (FEATURE_KEYS as string[]).includes(value);
}

type FeatureUsageDbRow = {
  internal_user_id: string;
  feature_key: string;
  granularity: string;
  period_start: string;
  usage_count: number;
};

type DashboardUserDbRow = {
  internal_user_id: string;
  workshop_id: string | null;
};

type WorkshopDbRow = {
  workshop_id: string;
  plan_key: string | null;
};

function emptyPlanRow(tier: PlanTier): PlanStatRow {
  return {
    tier,
    users: 0,
    workshops: 0,
    activeUsers: 0,
    featureEvents: 0,
    features: FEATURE_USAGE_FEATURES.map((feature) => ({
      key: feature.key,
      label: feature.label,
      description: feature.description,
      events: 0,
      users: 0,
      avgPerUser: 0,
    })),
  };
}

function emptyData(
  rangeKey: DashboardTimeRangeKey,
  rangeLabel: string,
  rangeSpan: string,
  note: string,
): PlanStatsData {
  return {
    rangeKey,
    rangeLabel,
    rangeSpan,
    note,
    totals: { users: 0, activeUsers: 0, featureEvents: 0 },
    plans: PLAN_TIERS.map(emptyPlanRow),
  };
}

const PLAN_STATS_NOTE =
  "A user's plan comes from their workshop's plan_key on dashboard_workshops " +
  "(Stripe-synced); users with no plan (unassigned workshops) are excluded. " +
  "'Active' is behaviour-based — a user counts as active if they had a GA4 " +
  "engagement event on app.wrenchlane.com, ran a diagnostic, or triggered a " +
  "tracked feature in the range (logins are ignored: sessions are long-lived, " +
  "so a login is a poor activity signal). Feature counters only exist from " +
  "2026-06-11 onward; GA4 and diagnostics carry real history.";

async function getPlanStatsDataUncached(
  rangeKey: DashboardTimeRangeKey,
  country: string | null,
): Promise<PlanStatsData> {
  const range = resolveDashboardTimeRange(rangeKey);
  const rangeSpan = formatRangeDateSpan(range);

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return emptyData(
      rangeKey,
      range.label,
      rangeSpan,
      "Supabase service credentials are not configured in this environment.",
    );
  }

  const [sets, countrySets] = await Promise.all([
    loadInternalTestSets(),
    loadCountryFilterSets(country),
  ]);

  const startDate = range.start ? toStockholmIsoDate(range.start) : null;
  const endDate = toStockholmIsoDate(range.end);

  const [
    dayRowsResult,
    userRowsResult,
    workshopRowsResult,
    activeUsers,
  ] = await Promise.all([
    pageAll<FeatureUsageDbRow>(({ from, to }) => {
      let query = supabase
        .from(TABLES.featureUsage)
        .select(
          "internal_user_id, feature_key, granularity, period_start, usage_count",
        )
        .eq("granularity", "day")
        .lt("period_start", endDate)
        .order("period_start", { ascending: true })
        .order("internal_user_id", { ascending: true })
        .range(from, to);
      if (startDate) query = query.gte("period_start", startDate);
      return query;
    }),
    pageAll<DashboardUserDbRow>(({ from, to }) =>
      supabase
        .from(TABLES.users)
        .select("internal_user_id, workshop_id")
        .order("internal_user_id", { ascending: true })
        .range(from, to),
    ),
    pageAll<WorkshopDbRow>(({ from, to }) =>
      supabase
        .from(TABLES.workshops)
        .select("workshop_id, plan_key")
        .order("workshop_id", { ascending: true })
        .range(from, to),
    ),
    // Behaviour-based active set (GA4 engagement + diagnostics), already
    // range- and country-scoped. Degrade gracefully if GA4 creds are missing
    // (e.g. setup mode): feature counters below still drive a partial "active".
    getActiveUsersData(rangeKey, country).catch(() => null),
  ]);

  if (dayRowsResult.error) throw new Error(dayRowsResult.error.message);
  if (userRowsResult.error) throw new Error(userRowsResult.error.message);
  if (workshopRowsResult.error) throw new Error(workshopRowsResult.error.message);

  // ---- Plan resolution: user -> workshop -> tier -------------------------
  const workshopTier = new Map<string, PlanTier | null>();
  for (const row of workshopRowsResult.data) {
    workshopTier.set(row.workshop_id, planTierFromKey(row.plan_key));
  }

  const passesUser = (userId: string) =>
    !sets.userIds.has(userId) &&
    (!countrySets || countrySets.userIds.has(userId));

  // Tier per user, only for users that survive the internal-test + country
  // filters and whose workshop maps to a known tier.
  const userTier = new Map<string, PlanTier>();
  for (const row of userRowsResult.data) {
    if (!passesUser(row.internal_user_id)) continue;
    if (!row.workshop_id) continue;
    if (sets.workshopIds.has(row.workshop_id)) continue;
    const tier = workshopTier.get(row.workshop_id) ?? null;
    if (!tier) continue;
    userTier.set(row.internal_user_id, tier);
  }

  // ---- Per-plan accumulators ---------------------------------------------
  type Acc = {
    users: Set<string>;
    workshops: Set<string>;
    activeUsers: Set<string>;
    featureEvents: number;
    featureCounts: Map<FeatureUsageFeatureKey, number>;
    featureUsers: Map<FeatureUsageFeatureKey, Set<string>>;
  };
  const accs = new Map<PlanTier, Acc>();
  for (const tier of PLAN_TIERS) {
    accs.set(tier, {
      users: new Set(),
      workshops: new Set(),
      activeUsers: new Set(),
      featureEvents: 0,
      featureCounts: new Map(),
      featureUsers: new Map(),
    });
  }

  // Whole-base user counts per plan.
  for (const [userId, tier] of userTier) {
    accs.get(tier)!.users.add(userId);
  }

  // Workshop counts per plan (respecting internal-test + country filters).
  for (const row of workshopRowsResult.data) {
    if (sets.workshopIds.has(row.workshop_id)) continue;
    if (countrySets && !countrySets.workshopIds.has(row.workshop_id)) continue;
    const tier = workshopTier.get(row.workshop_id) ?? null;
    if (!tier) continue;
    accs.get(tier)!.workshops.add(row.workshop_id);
  }

  // Behaviour-based active users in range: GA4 engagement + diagnostics
  // (from getActiveUsersData, keyed on crmUserId == internal_user_id).
  for (const row of activeUsers?.rows ?? []) {
    const tier = userTier.get(row.crmUserId);
    if (!tier) continue;
    accs.get(tier)!.activeUsers.add(row.crmUserId);
  }

  // Feature events in range, per plan + feature. A feature event also marks
  // the user active (catches mobile users GA4's web-host filter would miss).
  let overallFeatureEvents = 0;
  for (const row of dayRowsResult.data) {
    if (!isFeatureKey(row.feature_key)) continue;
    const tier = userTier.get(row.internal_user_id);
    if (!tier) continue;
    const count = Number(row.usage_count) || 0;
    if (count <= 0) continue;
    const feature = row.feature_key as FeatureUsageFeatureKey;
    const acc = accs.get(tier)!;
    acc.activeUsers.add(row.internal_user_id);
    acc.featureEvents += count;
    overallFeatureEvents += count;
    acc.featureCounts.set(
      feature,
      (acc.featureCounts.get(feature) ?? 0) + count,
    );
    let users = acc.featureUsers.get(feature);
    if (!users) {
      users = new Set();
      acc.featureUsers.set(feature, users);
    }
    users.add(row.internal_user_id);
  }

  // ---- Shape output -------------------------------------------------------
  const plans: PlanStatRow[] = PLAN_TIERS.map((tier) => {
    const acc = accs.get(tier)!;
    const features: PlanFeatureStat[] = FEATURE_USAGE_FEATURES.map((feature) => {
      const events = acc.featureCounts.get(feature.key) ?? 0;
      const users = acc.featureUsers.get(feature.key)?.size ?? 0;
      return {
        key: feature.key,
        label: feature.label,
        description: feature.description,
        events,
        users,
        avgPerUser: users > 0 ? events / users : 0,
      };
    });
    return {
      tier,
      users: acc.users.size,
      workshops: acc.workshops.size,
      activeUsers: acc.activeUsers.size,
      featureEvents: acc.featureEvents,
      features,
    };
  });

  const totalUsers = plans.reduce((sum, plan) => sum + plan.users, 0);
  const totalActive = plans.reduce((sum, plan) => sum + plan.activeUsers, 0);

  return {
    rangeKey,
    rangeLabel: range.label,
    rangeSpan,
    note: PLAN_STATS_NOTE,
    totals: {
      users: totalUsers,
      activeUsers: totalActive,
      featureEvents: overallFeatureEvents,
    },
    plans,
  };
}

const getPlanStatsDataCached = unstable_cache(
  (rangeKey: string, country: string | null) =>
    getPlanStatsDataUncached(rangeKey as DashboardTimeRangeKey, country),
  ["ceo-plan-stats-data"],
  CEO_CACHE_OPTIONS,
);

export function getPlanStatsData(
  rangeParam?: string | string[],
  country: string | null = null,
): Promise<PlanStatsData> {
  return getPlanStatsDataCached(normalizePlanStatsRangeKey(rangeParam), country);
}

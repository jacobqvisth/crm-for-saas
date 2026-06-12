import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { loadCountryFilterSets } from "@/lib/ceo/countries";
import { toStockholmIsoDate } from "@/lib/ceo/dates";
import {
  enumerateBuckets,
  bucketKey,
  formatBucketLabel,
  granularityFromRange,
  type AppUsageGranularity,
} from "@/lib/ceo/data/app-usage";
import { loadInternalTestSets } from "@/lib/ceo/internal-test/loader";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";
import {
  formatRangeDateSpan,
  isDashboardTimeRangeKey,
  resolveDashboardTimeRange,
  DEFAULT_TIME_RANGE_KEY,
  type DashboardTimeRangeKey,
} from "@/lib/ceo/time-ranges";
import {
  FEATURE_USAGE_FEATURES,
  FEATURE_USAGE_FEATURE_KEYS,
  type FeatureTotals,
  type FeatureUsageBucketRow,
  type FeatureUsageData,
  type FeatureUsageFeatureKey,
  type FeatureUsageFeatureSummary,
  type FeatureUsageMonthlyRow,
  type FeatureUsageUserRow,
} from "@/lib/ceo/feature-usage-shared";

// Feature Usage (/dashboard/feature-usage).
//
// Built on the per-user data the codeoc S3 export started shipping
// 2026-06-11:
//   * dashboard_user_logins — real login timestamps per user (the export
//     carries each user's last ~30 logins; the hourly core_app sync
//     accumulates them, with ~14 months of backfill from day one).
//   * dashboard_feature_usage — per-(user, feature, day) activity counts
//     accumulated from the export's snapshot counters. IMPORTANT: the export
//     only carries each user's LAST active day per feature, so a day is
//     only captured if a sync ran after the activity and before the user's
//     next active day. With hourly syncs that is effectively every active
//     day — but only from 2026-06-11 forward. There is no feature-level
//     backfill.

export {
  FEATURE_USAGE_FEATURES,
  type FeatureTotals,
  type FeatureUsageBucketRow,
  type FeatureUsageData,
  type FeatureUsageFeatureKey,
  type FeatureUsageFeatureSummary,
  type FeatureUsageMonthlyRow,
  type FeatureUsageUserRow,
} from "@/lib/ceo/feature-usage-shared";

const FEATURE_KEYS = FEATURE_USAGE_FEATURE_KEYS;

export const FEATURE_USAGE_DEFAULT_RANGE_KEY: DashboardTimeRangeKey =
  DEFAULT_TIME_RANGE_KEY;

export function normalizeFeatureUsageRangeKey(
  value: string | string[] | undefined,
): DashboardTimeRangeKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isDashboardTimeRangeKey(candidate)
    ? candidate
    : FEATURE_USAGE_DEFAULT_RANGE_KEY;
}

function emptyFeatureTotals(): FeatureTotals {
  return {
    diagnostics: 0,
    chat: 0,
    ai_search: 0,
    vrm_lookups: 0,
    infopro_vehicles: 0,
    motor_vehicles: 0,
  };
}

function isFeatureKey(value: string): value is FeatureUsageFeatureKey {
  return (FEATURE_KEYS as string[]).includes(value);
}

// period_start is a plain date ("YYYY-MM-DD") in the app's civil time —
// anchor it at noon UTC so Stockholm bucketing lands on the same day.
function dateOnlyToDate(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

type FeatureUsageDbRow = {
  internal_user_id: string;
  feature_key: string;
  granularity: string;
  period_start: string;
  usage_count: number;
};

type UserLoginDbRow = {
  internal_user_id: string;
  logged_in_at: string;
};

type DashboardUserDbRow = {
  internal_user_id: string;
  workshop_id: string | null;
  name: string | null;
  metadata: Record<string, unknown> | null;
};

type WorkshopDbRow = {
  workshop_id: string;
  name: string | null;
};

function metaString(
  metadata: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function getFeatureUsageDataUncached(
  rangeKey: DashboardTimeRangeKey,
  country: string | null,
): Promise<FeatureUsageData> {
  const range = resolveDashboardTimeRange(rangeKey);
  // Feature counters are daily — hourly buckets would just be empty noise.
  const resolvedGranularity = granularityFromRange(range);
  const granularity: AppUsageGranularity =
    resolvedGranularity === "hour" ? "day" : resolvedGranularity;

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return {
      rangeKey,
      rangeLabel: range.label,
      rangeSpan: formatRangeDateSpan(range),
      granularity,
      note: "Supabase service credentials are not configured in this environment.",
      totals: { loginUsers: 0, logins: 0, featureUsers: 0, featureEvents: 0 },
      features: FEATURE_USAGE_FEATURES.map((feature) => ({
        key: feature.key,
        label: feature.label,
        description: feature.description,
        total: 0,
        users: 0,
        lastActiveDate: null,
      })),
      buckets: [],
      users: [],
      monthly: [],
    };
  }
  const [sets, countrySets] = await Promise.all([
    loadInternalTestSets(),
    loadCountryFilterSets(country),
  ]);

  const startDate = range.start ? toStockholmIsoDate(range.start) : null;
  const endDate = toStockholmIsoDate(range.end);
  const startIso = range.start ? range.start.toISOString() : null;
  const endIso = range.end.toISOString();

  const [dayRowsResult, monthRowsResult, loginRowsResult] = await Promise.all([
    pageAll<FeatureUsageDbRow>(({ from, to }) => {
      let query = supabase
        .from(TABLES.featureUsage)
        .select("internal_user_id, feature_key, granularity, period_start, usage_count")
        .eq("granularity", "day")
        .lt("period_start", endDate)
        .order("period_start", { ascending: true })
        .order("internal_user_id", { ascending: true })
        .order("feature_key", { ascending: true })
        .range(from, to);
      if (startDate) query = query.gte("period_start", startDate);
      return query;
    }),
    pageAll<FeatureUsageDbRow>(({ from, to }) => {
      let query = supabase
        .from(TABLES.featureUsage)
        .select("internal_user_id, feature_key, granularity, period_start, usage_count")
        .eq("granularity", "month")
        .lt("period_start", endDate)
        .order("period_start", { ascending: true })
        .order("internal_user_id", { ascending: true })
        .order("feature_key", { ascending: true })
        .range(from, to);
      if (startDate) query = query.gte("period_start", startDate.slice(0, 8) + "01");
      return query;
    }),
    pageAll<UserLoginDbRow>(({ from, to }) => {
      let query = supabase
        .from(TABLES.userLogins)
        .select("internal_user_id, logged_in_at")
        .lt("logged_in_at", endIso)
        .order("logged_in_at", { ascending: true })
        .order("internal_user_id", { ascending: true })
        .range(from, to);
      if (startIso) query = query.gte("logged_in_at", startIso);
      return query;
    }),
  ]);

  if (dayRowsResult.error) throw new Error(dayRowsResult.error.message);
  if (monthRowsResult.error) throw new Error(monthRowsResult.error.message);
  if (loginRowsResult.error) throw new Error(loginRowsResult.error.message);

  const isFlaggedUser = (userId: string) => sets.userIds.has(userId);

  let dayRows = dayRowsResult.data.filter(
    (row) =>
      !isFlaggedUser(row.internal_user_id) && isFeatureKey(row.feature_key),
  );
  let monthRows = monthRowsResult.data.filter(
    (row) =>
      !isFlaggedUser(row.internal_user_id) && isFeatureKey(row.feature_key),
  );
  let loginRows = loginRowsResult.data.filter(
    (row) => !isFlaggedUser(row.internal_user_id),
  );

  // Country filter: user-keyed rows are scoped via the workshop-country map.
  if (countrySets) {
    const inCountry = (userId: string) => countrySets.userIds.has(userId);
    dayRows = dayRows.filter((row) => inCountry(row.internal_user_id));
    monthRows = monthRows.filter((row) => inCountry(row.internal_user_id));
    loginRows = loginRows.filter((row) => inCountry(row.internal_user_id));
  }

  // ---- Identity enrichment for every user we're about to show ------------
  const userIds = [
    ...new Set([
      ...dayRows.map((row) => row.internal_user_id),
      ...loginRows.map((row) => row.internal_user_id),
    ]),
  ];

  const identities = new Map<string, DashboardUserDbRow>();
  const workshopNames = new Map<string, string | null>();
  if (userIds.length > 0) {
    for (let index = 0; index < userIds.length; index += 200) {
      const slice = userIds.slice(index, index + 200);
      const { data, error } = await supabase
        .from(TABLES.users)
        .select("internal_user_id, workshop_id, name, metadata")
        .in("internal_user_id", slice);
      if (error) throw error;
      for (const row of (data ?? []) as DashboardUserDbRow[]) {
        identities.set(row.internal_user_id, row);
      }
    }

    const workshopIds = [
      ...new Set(
        [...identities.values()]
          .map((row) => row.workshop_id)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    for (let index = 0; index < workshopIds.length; index += 200) {
      const slice = workshopIds.slice(index, index + 200);
      const { data, error } = await supabase
        .from(TABLES.workshops)
        .select("workshop_id, name")
        .in("workshop_id", slice);
      if (error) throw error;
      for (const row of (data ?? []) as WorkshopDbRow[]) {
        workshopNames.set(row.workshop_id, row.name);
      }
    }
  }

  // Second exclusion pass: drop users whose workshop is on the internal-test
  // list (mirrors isInternalTestUserOrWorkshopWith, which needs the workshop
  // id we only have after the identity lookup).
  const internalByWorkshop = new Set(
    [...identities.values()]
      .filter(
        (row) => row.workshop_id && sets.workshopIds.has(row.workshop_id),
      )
      .map((row) => row.internal_user_id),
  );
  if (internalByWorkshop.size > 0) {
    dayRows = dayRows.filter(
      (row) => !internalByWorkshop.has(row.internal_user_id),
    );
    monthRows = monthRows.filter(
      (row) => !internalByWorkshop.has(row.internal_user_id),
    );
    loginRows = loginRows.filter(
      (row) => !internalByWorkshop.has(row.internal_user_id),
    );
  }

  // ---- Buckets (seeded from the range so zero days still render) --------
  const seededBuckets = enumerateBuckets(range.start, range.end, granularity);
  const bucketSet = new Set(seededBuckets);
  const bucketOrder = [...seededBuckets];
  const ensureBucket = (key: string) => {
    if (!bucketSet.has(key)) {
      bucketSet.add(key);
      bucketOrder.push(key);
    }
  };

  type BucketAccumulator = {
    logins: number;
    loginUsers: Set<string>;
    features: FeatureTotals;
  };
  const bucketData = new Map<string, BucketAccumulator>();
  const bucketAccumulator = (key: string): BucketAccumulator => {
    let acc = bucketData.get(key);
    if (!acc) {
      acc = { logins: 0, loginUsers: new Set(), features: emptyFeatureTotals() };
      bucketData.set(key, acc);
    }
    return acc;
  };

  // ---- Feature aggregation ----------------------------------------------
  const featureTotals = emptyFeatureTotals();
  const featureUsers = new Map<FeatureUsageFeatureKey, Set<string>>();
  const featureLastActive = new Map<FeatureUsageFeatureKey, string>();
  const allFeatureUsers = new Set<string>();
  let featureEvents = 0;

  type UserAccumulator = {
    logins: number;
    lastLoginAt: string | null;
    features: FeatureTotals;
  };
  const userData = new Map<string, UserAccumulator>();
  const userAccumulator = (userId: string): UserAccumulator => {
    let acc = userData.get(userId);
    if (!acc) {
      acc = { logins: 0, lastLoginAt: null, features: emptyFeatureTotals() };
      userData.set(userId, acc);
    }
    return acc;
  };

  for (const row of dayRows) {
    const feature = row.feature_key as FeatureUsageFeatureKey;
    const count = Number(row.usage_count) || 0;
    if (count <= 0) continue;

    featureTotals[feature] += count;
    featureEvents += count;
    allFeatureUsers.add(row.internal_user_id);
    let users = featureUsers.get(feature);
    if (!users) {
      users = new Set();
      featureUsers.set(feature, users);
    }
    users.add(row.internal_user_id);
    const lastActive = featureLastActive.get(feature);
    if (!lastActive || row.period_start > lastActive) {
      featureLastActive.set(feature, row.period_start);
    }

    const key = bucketKey(dateOnlyToDate(row.period_start), granularity);
    ensureBucket(key);
    bucketAccumulator(key).features[feature] += count;

    userAccumulator(row.internal_user_id).features[feature] += count;
  }

  // ---- Login aggregation --------------------------------------------------
  const loginUsers = new Set<string>();
  for (const row of loginRows) {
    loginUsers.add(row.internal_user_id);

    const key = bucketKey(new Date(row.logged_in_at), granularity);
    ensureBucket(key);
    const bucket = bucketAccumulator(key);
    bucket.logins += 1;
    bucket.loginUsers.add(row.internal_user_id);

    const user = userAccumulator(row.internal_user_id);
    user.logins += 1;
    if (!user.lastLoginAt || row.logged_in_at > user.lastLoginAt) {
      user.lastLoginAt = row.logged_in_at;
    }
  }

  // ---- Shape output -------------------------------------------------------
  bucketOrder.sort();
  const buckets: FeatureUsageBucketRow[] = bucketOrder.map((key) => {
    const labels = formatBucketLabel(key, granularity);
    const acc = bucketData.get(key);
    const features = acc?.features ?? emptyFeatureTotals();
    return {
      bucket: key,
      bucketLabel: labels.label,
      bucketShortLabel: labels.shortLabel,
      logins: acc?.logins ?? 0,
      loginUsers: acc?.loginUsers.size ?? 0,
      features,
      featureTotal: FEATURE_KEYS.reduce(
        (sum, feature) => sum + features[feature],
        0,
      ),
    };
  });

  const features: FeatureUsageFeatureSummary[] = FEATURE_USAGE_FEATURES.map(
    (feature) => ({
      key: feature.key,
      label: feature.label,
      description: feature.description,
      total: featureTotals[feature.key],
      users: featureUsers.get(feature.key)?.size ?? 0,
      lastActiveDate: featureLastActive.get(feature.key) ?? null,
    }),
  );

  const users: FeatureUsageUserRow[] = [...userData.entries()]
    .map(([internalUserId, acc]) => {
      const identity = identities.get(internalUserId);
      const featureTotal = FEATURE_KEYS.reduce(
        (sum, feature) => sum + acc.features[feature],
        0,
      );
      return {
        internalUserId,
        username: metaString(identity?.metadata ?? null, "username"),
        name: identity?.name ?? null,
        company:
          metaString(identity?.metadata ?? null, "company_name") ??
          (identity?.workshop_id
            ? (workshopNames.get(identity.workshop_id) ?? null)
            : null),
        role: metaString(identity?.metadata ?? null, "user_role"),
        workshopId: identity?.workshop_id ?? null,
        logins: acc.logins,
        lastLoginAt: acc.lastLoginAt,
        features: acc.features,
        featureTotal,
      };
    })
    .sort(
      (a, b) =>
        b.featureTotal - a.featureTotal ||
        b.logins - a.logins ||
        a.internalUserId.localeCompare(b.internalUserId),
    );

  const monthlyAccumulator = new Map<
    string,
    { month: string; feature: FeatureUsageFeatureKey; total: number; users: Set<string> }
  >();
  for (const row of monthRows) {
    const feature = row.feature_key as FeatureUsageFeatureKey;
    const count = Number(row.usage_count) || 0;
    if (count <= 0) continue;
    const month = row.period_start.slice(0, 7);
    const key = `${month} ${feature}`;
    let acc = monthlyAccumulator.get(key);
    if (!acc) {
      acc = { month, feature, total: 0, users: new Set() };
      monthlyAccumulator.set(key, acc);
    }
    acc.total += count;
    acc.users.add(row.internal_user_id);
  }
  const monthly: FeatureUsageMonthlyRow[] = [...monthlyAccumulator.values()]
    .map((acc) => ({
      month: acc.month,
      feature: acc.feature,
      label:
        FEATURE_USAGE_FEATURES.find((feature) => feature.key === acc.feature)
          ?.label ?? acc.feature,
      total: acc.total,
      users: acc.users.size,
    }))
    .sort((a, b) => b.month.localeCompare(a.month) || b.total - a.total);

  return {
    rangeKey,
    rangeLabel: range.label,
    rangeSpan: formatRangeDateSpan(range),
    granularity,
    note:
      "Login history backfills ~14 months (each user's last 30 logins, accumulated hourly). " +
      "Feature counters only exist from 2026-06-11 onward — the codeoc export ships each " +
      "user's last active day per feature and the hourly sync accumulates those snapshots " +
      "into a time series, so earlier days show zero feature activity by construction.",
    totals: {
      loginUsers: loginUsers.size,
      logins: loginRows.length,
      featureUsers: allFeatureUsers.size,
      featureEvents,
    },
    features,
    buckets,
    users,
    monthly,
  };
}

const getFeatureUsageDataCached = unstable_cache(
  (rangeKey: string, country: string | null) =>
    getFeatureUsageDataUncached(rangeKey as DashboardTimeRangeKey, country),
  ["ceo-feature-usage-data"],
  CEO_CACHE_OPTIONS,
);

export function getFeatureUsageData(
  rangeParam?: string | string[],
  country: string | null = null,
): Promise<FeatureUsageData> {
  return getFeatureUsageDataCached(
    normalizeFeatureUsageRangeKey(rangeParam),
    country,
  );
}

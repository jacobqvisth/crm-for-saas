import {
  inCountryWith,
  loadCountryFilterSets,
} from "@/lib/ceo/countries";
import {
  isInternalTestUserOrWorkshopWith,
  loadInternalTestSets,
} from "@/lib/ceo/internal-test/loader";
import {
  type AppUsageGranularity,
  bucketKey,
  enumerateBuckets,
  formatBucketLabel,
  granularityFromRange,
} from "@/lib/ceo/data/app-usage";
import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { hasSupabaseConfig } from "@/lib/ceo/env";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { pageAll } from "@/lib/supabase-paging";
import { TABLES } from "@/lib/ceo/tables";
import {
  type ResolvedDashboardRange,
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "@/lib/ceo/time-ranges";

export type NewUsersGranularity = AppUsageGranularity;

/**
 * Activation is measured in a FIXED WINDOW from each user's own signup, not as
 * "has this user ever run a diagnostic".
 *
 * The "ever" form silently understates every young cohort, because a user who
 * signed up yesterday has had one day to act while a user from March has had
 * months. On 2026-08-03 that made July read 25% and look like a collapse. It
 * also cuts the other way: measured on the truncated data left by the core_app
 * outage, the same cohort read 44.4% and looked like a recovery. The real
 * fully-observed figure was 21.2%. A metric that can move 20 points in either
 * direction depending on when you ask is not measuring the product.
 */
export const ACTIVATION_WINDOW_DAYS = 7;

/**
 * The stickier companion metric. One diagnostic is curiosity; coming back for a
 * second is the first sign of adoption. Worth tracking separately because the
 * two diverge sharply: July 2026 was 21.2% activated but only 4.8% retained.
 */
export const RETENTION_WINDOW_DAYS = 14;
export const RETENTION_MIN_DIAGNOSTICS = 2;

export type UserWindowVerdict = {
  /** The user's activation window has fully elapsed, so they count in the rate. */
  activationEligible: boolean;
  /** Ran >= 1 diagnosis inside the activation window. */
  activated: boolean;
  /** Days from signup to first in-window diagnosis; null when not activated. */
  daysToActivate: number | null;
  retentionEligible: boolean;
  retained: boolean;
};

/**
 * The whole fixed-window judgement for one user, kept pure so it can be tested
 * without a database. This is the logic that produced three different answers
 * for July 2026 (25%, 44.4%, 21.2%) before it was pinned down, so it is worth
 * having under direct test rather than only reachable through the loader.
 *
 * `nowMs` is injected rather than read from the clock so tests are deterministic.
 */
export function evaluateUserWindows(
  signupMs: number,
  diagnosticTimesMs: readonly number[],
  nowMs: number,
): UserWindowVerdict {
  const activationEnd = signupMs + ACTIVATION_WINDOW_DAYS * 86_400_000;
  const retentionEnd = signupMs + RETENTION_WINDOW_DAYS * 86_400_000;

  const activationEligible = activationEnd <= nowMs;
  const retentionEligible = retentionEnd <= nowMs;

  let firstInWindow: number | null = null;
  let countInRetentionWindow = 0;
  for (const ms of diagnosticTimesMs) {
    // A diagnosis before signup is data noise (re-keyed identity, clock skew),
    // never evidence that the user activated instantly.
    if (ms < signupMs) continue;
    if (ms < activationEnd && (firstInWindow === null || ms < firstInWindow)) {
      firstInWindow = ms;
    }
    if (ms < retentionEnd) countInRetentionWindow += 1;
  }

  const activated = activationEligible && firstInWindow !== null;

  return {
    activationEligible,
    activated,
    daysToActivate:
      activated && firstInWindow !== null
        ? (firstInWindow - signupMs) / 86_400_000
        : null,
    retentionEligible,
    retained:
      retentionEligible && countInRetentionWindow >= RETENTION_MIN_DIAGNOSTICS,
  };
}

export type NewUsersRow = {
  bucket: string;
  bucketLabel: string;
  bucketShortLabel: string;
  // Store/GA4 aggregates have no per-user identity, so they go null (shown as
  // "—") while a country filter is active rather than lying with the global
  // number. iOS is also null when App Store Connect isn't configured.
  iosDownloads: number | null;
  androidDownloads: number | null;
  webFirstVisits: number | null;
  signUps: number;
  /**
   * Signups in this bucket whose full activation window has already elapsed, so
   * they could actually have activated. The denominator for `activatedRate` —
   * never use `signUps`, which is what produced the misleading numbers above.
   */
  activationEligible: number;
  /** Of `activationEligible`, how many ran a diagnostic inside the window. */
  activated: number;
  activatedRate: number | null;
  retentionEligible: number;
  retained: number;
  retainedRate: number | null;
  /**
   * False while some signups in this bucket are still inside their window, i.e.
   * the bucket's rate is computed on a partial cohort and will keep moving.
   * The UI marks these rather than presenting them as settled.
   */
  activationWindowComplete: boolean;
  retentionWindowComplete: boolean;
  /** Mean days from signup to first diagnostic, among those who activated. */
  avgDaysToActivate: number | null;
};

export type NewUsersData = {
  generatedAt: string;
  granularity: NewUsersGranularity;
  rows: NewUsersRow[];
  androidConfigured: boolean;
  signUpCoverage: {
    totalUsers: number;
    fromCoreAppUser: number;
    fromCoreAppWorkshop: number;
    fromCustomerIo: number;
    fromStripe: number;
    missing: number;
  };
  error?: string;
};

type UserRow = {
  internal_user_id: string | null;
  workshop_id: string | null;
  signed_up_at: string | null;
  metadata: Record<string, unknown> | null;
};

type DiagnosticRow = {
  internal_user_id: string | null;
  workshop_id: string | null;
  created_at: string | null;
};

type MetricSnapshotRow = {
  period_start: string | null;
  value: number | string | null;
  dimension_key: string | null;
};

function emptyData(
  granularity: NewUsersGranularity,
  error?: string,
): NewUsersData {
  return {
    generatedAt: new Date().toISOString(),
    granularity,
    rows: [],
    androidConfigured: false,
    signUpCoverage: {
      totalUsers: 0,
      fromCoreAppUser: 0,
      fromCoreAppWorkshop: 0,
      fromCustomerIo: 0,
      fromStripe: 0,
      missing: 0,
    },
    error,
  };
}

// Cache by the range's stable key string (resolving a fresh range inside the
// cached fn) so the cache key stays a clean primitive and the public
// signature is unchanged. Tagged ceo-data so the Update button busts it.
const getNewUsersDataCached = unstable_cache(
  (rangeKey: string, country: string | null) =>
    getNewUsersDataUncached(
      resolveDashboardTimeRange(normalizeDashboardTimeRangeKey(rangeKey)),
      country,
    ),
  ["ceo-new-users"],
  CEO_CACHE_OPTIONS,
);

export function getNewUsersData(
  range: ResolvedDashboardRange,
  country: string | null = null,
): Promise<NewUsersData> {
  return getNewUsersDataCached(range.key, country);
}

async function getNewUsersDataUncached(
  range: ResolvedDashboardRange,
  country: string | null,
): Promise<NewUsersData> {
  const granularity = granularityFromRange(range);

  if (!hasSupabaseConfig()) return emptyData(granularity);
  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyData(granularity);

  const endIso = range.end.toISOString();
  const startIso = range.start?.toISOString();

  const allUsersQuery = pageAll<UserRow>(({ from, to }) =>
    supabase
      .from(TABLES.users)
      .select("internal_user_id, workshop_id, signed_up_at, metadata")
      .order("internal_user_id", { ascending: true })
      .range(from, to),
  );

  const allDiagnosticsQuery = pageAll<DiagnosticRow>(({ from, to }) =>
    supabase
      .from(TABLES.diagnostics)
      .select("internal_user_id, workshop_id, created_at")
      .order("diagnostic_id", { ascending: true })
      .range(from, to),
  );

  // Apple's modern analytics for this app emits a "Platform App Installs"
  // report (installs column) but no "App Store Downloads" report, so the
  // app_store_downloads metric_key is never populated. app_store_installations
  // is the correct source for the iOS column on /dashboard/new-users.
  const iosQuery = pageAll<MetricSnapshotRow>(({ from, to }) => {
    let q = supabase
      .from(TABLES.metricSnapshots)
      .select("period_start, value, dimension_key")
      .eq("source_key", "app_store_connect")
      .eq("metric_key", "app_store_installations")
      .lt("period_start", endIso)
      .order("period_start", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (startIso) q = q.gte("period_start", startIso);
    return q;
  });

  const androidQuery = pageAll<MetricSnapshotRow>(({ from, to }) => {
    let q = supabase
      .from(TABLES.metricSnapshots)
      .select("period_start, value, dimension_key")
      .eq("source_key", "ga4")
      .eq("metric_key", "android_first_opens")
      .lt("period_start", endIso)
      .order("period_start", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (startIso) q = q.gte("period_start", startIso);
    return q;
  });

  const webQuery = pageAll<MetricSnapshotRow>(({ from, to }) => {
    let q = supabase
      .from(TABLES.metricSnapshots)
      .select("period_start, value, dimension_key")
      .eq("source_key", "ga4")
      .eq("metric_key", "app_first_visits")
      .lt("period_start", endIso)
      .order("period_start", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (startIso) q = q.gte("period_start", startIso);
    return q;
  });

  const [
    allUsersResult,
    allDiagnosticsResult,
    iosResult,
    androidResult,
    webResult,
  ] = await Promise.all([
    allUsersQuery,
    allDiagnosticsQuery,
    iosQuery,
    androidQuery,
    webQuery,
  ]);

  if (allUsersResult.error || allDiagnosticsResult.error) {
    return emptyData(
      granularity,
      allUsersResult.error?.message ??
        allDiagnosticsResult.error?.message,
    );
  }

  const allUsersRaw = allUsersResult.data;
  const allDiagnosticsRaw = allDiagnosticsResult.data;
  const iosSnapshots = iosResult.data;
  const androidSnapshots = androidResult.data;
  const androidConfigured = !androidResult.error;
  const webSnapshots = webResult.data;
  const webConfigured = !webResult.error;

  // Drop internal-test users + workshops before any per-user math. Sign-ups,
  // Activated, and Avg-days-to-activate all flow from these arrays. iOS /
  // Android / Web columns come from store + GA4 aggregates with no user
  // identity, so they're left alone.
  const [internalTestSets, countrySets] = await Promise.all([
    loadInternalTestSets(),
    loadCountryFilterSets(country),
  ]);
  const allUsers = allUsersRaw.filter(
    (u) =>
      !isInternalTestUserOrWorkshopWith(
        internalTestSets,
        u.internal_user_id,
        u.workshop_id,
      ) &&
      (!countrySets ||
        inCountryWith(countrySets, u.internal_user_id, u.workshop_id)),
  );
  const allDiagnostics = allDiagnosticsRaw.filter(
    (d) =>
      !isInternalTestUserOrWorkshopWith(
        internalTestSets,
        d.internal_user_id,
        d.workshop_id,
      ) &&
      (!countrySets ||
        inCountryWith(countrySets, d.internal_user_id, d.workshop_id)),
  );

  const coverage = {
    totalUsers: allUsers.length,
    fromCoreAppUser: 0,
    fromCoreAppWorkshop: 0,
    fromCustomerIo: 0,
    fromStripe: 0,
    missing: 0,
  };
  const signupAtByUser = new Map<string, Date>();
  for (const u of allUsers) {
    const source =
      (u.metadata && typeof u.metadata === "object"
        ? (u.metadata as Record<string, unknown>).signed_up_at_source
        : null) ?? null;
    if (source === "core_app_user") coverage.fromCoreAppUser += 1;
    else if (source === "core_app_workshop") coverage.fromCoreAppWorkshop += 1;
    else if (source === "customer_io") coverage.fromCustomerIo += 1;
    else if (source === "stripe") coverage.fromStripe += 1;
    else coverage.missing += 1;

    if (u.internal_user_id && u.signed_up_at) {
      const t = new Date(u.signed_up_at);
      if (!Number.isNaN(t.getTime())) {
        signupAtByUser.set(u.internal_user_id, t);
      }
    }
  }

  // Keep every diagnostic timestamp per user, not just the first: the retention
  // metric needs to count how many landed inside a window, which a first-only
  // map can't answer.
  const diagTimesByUser = new Map<string, Date[]>();
  for (const d of allDiagnostics) {
    if (!d.internal_user_id || !d.created_at) continue;
    const t = new Date(d.created_at);
    if (Number.isNaN(t.getTime())) continue;
    const list = diagTimesByUser.get(d.internal_user_id);
    if (list) list.push(t);
    else diagTimesByUser.set(d.internal_user_id, [t]);
  }

  // `range.end` is exclusive (start of the day after the range), so use a
  // strict `<` — a signup at exactly midnight belongs to the next day.
  const inRange = (date: Date) =>
    date < range.end && (!range.start || date >= range.start);

  const signUpsByBucket = new Map<string, number>();
  for (const [, signupAt] of signupAtByUser) {
    if (!inRange(signupAt)) continue;
    const key = bucketKey(signupAt, granularity);
    signUpsByBucket.set(key, (signUpsByBucket.get(key) ?? 0) + 1);
  }

  // Cohort metric, fixed-window. Users are bucketed by signup, then judged only
  // on what they did inside a window measured from their OWN signup instant.
  //
  // Maturity is tracked per user rather than per bucket: a user is "eligible"
  // once their window has fully elapsed. Deriving that from bucket boundaries
  // instead would mean reconstructing Stockholm civil period ends from bucket
  // key strings for four different granularities, which is both fiddly and
  // wrong at DST edges. The per-user test is exact and granularity-agnostic.
  const activatedByBucket = new Map<string, number>();
  const activationEligibleByBucket = new Map<string, number>();
  const retainedByBucket = new Map<string, number>();
  const retentionEligibleByBucket = new Map<string, number>();
  const daysByBucket = new Map<string, { sum: number; count: number }>();

  const nowMs = Date.now();
  const bump = (m: Map<string, number>, key: string) =>
    m.set(key, (m.get(key) ?? 0) + 1);

  for (const [userId, signupAt] of signupAtByUser) {
    if (!inRange(signupAt)) continue;
    const key = bucketKey(signupAt, granularity);
    const times = (diagTimesByUser.get(userId) ?? []).map((t) => t.getTime());
    const verdict = evaluateUserWindows(signupAt.getTime(), times, nowMs);

    if (verdict.activationEligible) bump(activationEligibleByBucket, key);
    if (verdict.activated) {
      bump(activatedByBucket, key);
      if (verdict.daysToActivate !== null) {
        const stat = daysByBucket.get(key) ?? { sum: 0, count: 0 };
        stat.sum += verdict.daysToActivate;
        stat.count += 1;
        daysByBucket.set(key, stat);
      }
    }
    if (verdict.retentionEligible) bump(retentionEligibleByBucket, key);
    if (verdict.retained) bump(retainedByBucket, key);
  }

  const iosByBucket = new Map<string, number>();
  for (const s of iosSnapshots) {
    if (!s.period_start) continue;
    // Apple's Platform App Installs report breaks the daily total down by
    // territory, install_type, source_type, etc. — every row has a non-empty
    // dimension_key. Sum across all dimensions to recover the daily total.
    const t = new Date(s.period_start);
    if (Number.isNaN(t.getTime()) || !inRange(t)) continue;
    const key = bucketKey(t, granularity);
    const v = typeof s.value === "string" ? Number(s.value) : (s.value ?? 0);
    iosByBucket.set(key, (iosByBucket.get(key) ?? 0) + (Number.isFinite(v) ? v : 0));
  }

  const androidByBucket = new Map<string, number>();
  for (const s of androidSnapshots) {
    if (!s.period_start) continue;
    const dim = s.dimension_key ?? "";
    if (dim !== "" && dim !== "total") continue;
    const t = new Date(s.period_start);
    if (Number.isNaN(t.getTime()) || !inRange(t)) continue;
    const key = bucketKey(t, granularity);
    const v = typeof s.value === "string" ? Number(s.value) : (s.value ?? 0);
    androidByBucket.set(
      key,
      (androidByBucket.get(key) ?? 0) + (Number.isFinite(v) ? v : 0),
    );
  }

  const webByBucket = new Map<string, number>();
  for (const s of webSnapshots) {
    if (!s.period_start) continue;
    const dim = s.dimension_key ?? "";
    if (dim !== "" && dim !== "total") continue;
    const t = new Date(s.period_start);
    if (Number.isNaN(t.getTime()) || !inRange(t)) continue;
    const key = bucketKey(t, granularity);
    const v = typeof s.value === "string" ? Number(s.value) : (s.value ?? 0);
    webByBucket.set(
      key,
      (webByBucket.get(key) ?? 0) + (Number.isFinite(v) ? v : 0),
    );
  }

  // Seed bucket set with every interval in the requested range so zero-
  // signal days/weeks/months still render. Empty array for open-ended
  // ranges (range.start is null) → fall back to union-of-data.
  const allBuckets = new Set<string>(
    enumerateBuckets(range.start, range.end, granularity),
  );
  for (const m of [
    signUpsByBucket,
    activatedByBucket,
    activationEligibleByBucket,
    retainedByBucket,
    retentionEligibleByBucket,
    iosByBucket,
    androidByBucket,
    webByBucket,
  ]) {
    for (const k of m.keys()) allBuckets.add(k);
  }

  // Download/first-visit columns are store + GA4 aggregates with no user
  // identity — they can't be scoped to a workshop country, so they read "—"
  // while a country filter is active instead of showing the global number.
  const aggregatesApply = !countrySets;

  const rows: NewUsersRow[] = [...allBuckets]
    .sort()
    .map((bucket) => {
      const labels = formatBucketLabel(bucket, granularity);
      const days = daysByBucket.get(bucket);
      const signUps = signUpsByBucket.get(bucket) ?? 0;
      const activationEligible = activationEligibleByBucket.get(bucket) ?? 0;
      const activated = activatedByBucket.get(bucket) ?? 0;
      const retentionEligible = retentionEligibleByBucket.get(bucket) ?? 0;
      const retained = retainedByBucket.get(bucket) ?? 0;
      return {
        bucket,
        bucketLabel: labels.label,
        bucketShortLabel: labels.shortLabel,
        iosDownloads: aggregatesApply ? (iosByBucket.get(bucket) ?? 0) : null,
        androidDownloads:
          aggregatesApply && androidConfigured
            ? (androidByBucket.get(bucket) ?? 0)
            : null,
        webFirstVisits:
          aggregatesApply && webConfigured
            ? (webByBucket.get(bucket) ?? 0)
            : null,
        signUps,
        activationEligible,
        activated,
        // Rate is against the eligible cohort, and null (not 0) when nothing is
        // eligible yet, so the UI can render "—" instead of an alarming 0%.
        activatedRate:
          activationEligible > 0 ? (activated / activationEligible) * 100 : null,
        retentionEligible,
        retained,
        retainedRate:
          retentionEligible > 0 ? (retained / retentionEligible) * 100 : null,
        activationWindowComplete: activationEligible >= signUps,
        retentionWindowComplete: retentionEligible >= signUps,
        avgDaysToActivate: days ? days.sum / days.count : null,
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    granularity,
    rows,
    androidConfigured,
    signUpCoverage: coverage,
  };
}

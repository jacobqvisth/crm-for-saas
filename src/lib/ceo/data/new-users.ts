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
import { hasSupabaseConfig } from "@/lib/ceo/env";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import type { ResolvedDashboardRange } from "@/lib/ceo/time-ranges";

const FETCH_LIMIT = 50000;

export type NewUsersGranularity = AppUsageGranularity;

export type NewUsersRow = {
  bucket: string;
  bucketLabel: string;
  bucketShortLabel: string;
  iosDownloads: number;
  androidDownloads: number | null;
  webFirstVisits: number | null;
  signUps: number;
  activated: number;
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

export async function getNewUsersData(
  range: ResolvedDashboardRange,
): Promise<NewUsersData> {
  const granularity = granularityFromRange(range);

  if (!hasSupabaseConfig()) return emptyData(granularity);
  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyData(granularity);

  const endIso = range.end.toISOString();
  const startIso = range.start?.toISOString();

  const allUsersQuery = supabase
    .from(TABLES.users)
    .select("internal_user_id, workshop_id, signed_up_at, metadata")
    .limit(FETCH_LIMIT);

  const allDiagnosticsQuery = supabase
    .from(TABLES.diagnostics)
    .select("internal_user_id, workshop_id, created_at")
    .limit(FETCH_LIMIT);

  // Apple's modern analytics for this app emits a "Platform App Installs"
  // report (installs column) but no "App Store Downloads" report, so the
  // app_store_downloads metric_key is never populated. app_store_installations
  // is the correct source for the iOS column on /dashboard/new-users.
  let iosQuery = supabase
    .from(TABLES.metricSnapshots)
    .select("period_start, value, dimension_key")
    .eq("source_key", "app_store_connect")
    .eq("metric_key", "app_store_installations")
    .lt("period_start", endIso)
    .limit(FETCH_LIMIT);
  if (startIso) {
    iosQuery = iosQuery.gte("period_start", startIso);
  }

  let androidQuery = supabase
    .from(TABLES.metricSnapshots)
    .select("period_start, value, dimension_key")
    .eq("source_key", "ga4")
    .eq("metric_key", "android_first_opens")
    .lt("period_start", endIso)
    .limit(FETCH_LIMIT);
  if (startIso) {
    androidQuery = androidQuery.gte("period_start", startIso);
  }

  let webQuery = supabase
    .from(TABLES.metricSnapshots)
    .select("period_start, value, dimension_key")
    .eq("source_key", "ga4")
    .eq("metric_key", "app_first_visits")
    .lt("period_start", endIso)
    .limit(FETCH_LIMIT);
  if (startIso) {
    webQuery = webQuery.gte("period_start", startIso);
  }

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

  const allUsersRaw = (allUsersResult.data ?? []) as UserRow[];
  const allDiagnosticsRaw = (allDiagnosticsResult.data ?? []) as DiagnosticRow[];
  const iosSnapshots = (iosResult.data ?? []) as MetricSnapshotRow[];
  const androidSnapshots = (androidResult.data ?? []) as MetricSnapshotRow[];
  const androidConfigured = !androidResult.error;
  const webSnapshots = (webResult.data ?? []) as MetricSnapshotRow[];
  const webConfigured = !webResult.error;

  // Drop internal-test users + workshops before any per-user math. Sign-ups,
  // Activated, and Avg-days-to-activate all flow from these arrays. iOS /
  // Android / Web columns come from store + GA4 aggregates with no user
  // identity, so they're left alone.
  const internalTestSets = await loadInternalTestSets();
  const allUsers = allUsersRaw.filter(
    (u) =>
      !isInternalTestUserOrWorkshopWith(
        internalTestSets,
        u.internal_user_id,
        u.workshop_id,
      ),
  );
  const allDiagnostics = allDiagnosticsRaw.filter(
    (d) =>
      !isInternalTestUserOrWorkshopWith(
        internalTestSets,
        d.internal_user_id,
        d.workshop_id,
      ),
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

  const firstDiagByUser = new Map<string, Date>();
  for (const d of allDiagnostics) {
    if (!d.internal_user_id || !d.created_at) continue;
    const t = new Date(d.created_at);
    if (Number.isNaN(t.getTime())) continue;
    const cur = firstDiagByUser.get(d.internal_user_id);
    if (!cur || t < cur) firstDiagByUser.set(d.internal_user_id, t);
  }

  const inRange = (date: Date) =>
    date <= range.end && (!range.start || date >= range.start);

  const signUpsByBucket = new Map<string, number>();
  for (const [, signupAt] of signupAtByUser) {
    if (!inRange(signupAt)) continue;
    const key = bucketKey(signupAt, granularity);
    signUpsByBucket.set(key, (signUpsByBucket.get(key) ?? 0) + 1);
  }

  // Cohort metric: bucket users by signup month, then count how many of that
  // cohort have ever made a first diagnosis (activated) and the avg time it
  // took them. This is a "for users who signed up in month X, how did they
  // activate" view, not "users whose first diagnosis happened in month X".
  const activatedByBucket = new Map<string, number>();
  const daysByBucket = new Map<string, { sum: number; count: number }>();
  for (const [userId, signupAt] of signupAtByUser) {
    if (!inRange(signupAt)) continue;
    const firstAt = firstDiagByUser.get(userId);
    if (!firstAt) continue;
    const key = bucketKey(signupAt, granularity);
    activatedByBucket.set(key, (activatedByBucket.get(key) ?? 0) + 1);
    const days = (firstAt.getTime() - signupAt.getTime()) / 86_400_000;
    if (days >= 0) {
      const stat = daysByBucket.get(key) ?? { sum: 0, count: 0 };
      stat.sum += days;
      stat.count += 1;
      daysByBucket.set(key, stat);
    }
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
    iosByBucket,
    androidByBucket,
    webByBucket,
  ]) {
    for (const k of m.keys()) allBuckets.add(k);
  }

  const rows: NewUsersRow[] = [...allBuckets]
    .sort()
    .map((bucket) => {
      const labels = formatBucketLabel(bucket, granularity);
      const days = daysByBucket.get(bucket);
      return {
        bucket,
        bucketLabel: labels.label,
        bucketShortLabel: labels.shortLabel,
        iosDownloads: iosByBucket.get(bucket) ?? 0,
        androidDownloads: androidConfigured
          ? (androidByBucket.get(bucket) ?? 0)
          : null,
        webFirstVisits: webConfigured
          ? (webByBucket.get(bucket) ?? 0)
          : null,
        signUps: signUpsByBucket.get(bucket) ?? 0,
        activated: activatedByBucket.get(bucket) ?? 0,
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

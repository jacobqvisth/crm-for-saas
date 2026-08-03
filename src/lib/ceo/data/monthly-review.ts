import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { inCountryWith, loadCountryFilterSets } from "@/lib/ceo/countries";
import {
  ACTIVATION_WINDOW_DAYS,
  RETENTION_MIN_DIAGNOSTICS,
  RETENTION_WINDOW_DAYS,
  evaluateUserWindows,
} from "@/lib/ceo/data/new-users";
import {
  addStockholmMonths,
  getStockholmParts,
  startOfStockholmMonth,
} from "@/lib/ceo/dates";
import { hasSupabaseConfig } from "@/lib/ceo/env";
import {
  isInternalTestUserOrWorkshopWith,
  loadInternalTestSets,
} from "@/lib/ceo/internal-test/loader";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";

export {
  ACTIVATION_WINDOW_DAYS,
  RETENTION_MIN_DIAGNOSTICS,
  RETENTION_WINDOW_DAYS,
};

/**
 * A completed calendar month, keyed `YYYY-MM` in Stockholm civil time.
 *
 * The page deliberately defaults to the last COMPLETED month rather than the
 * month in progress: a partial month invites exactly the comparison error this
 * whole page exists to prevent (reading 12 days of July as if it were July).
 */
export type MonthKey = string;

export type MonthOption = {
  key: MonthKey;
  label: string;
};

export type WeekActivationRow = {
  label: string;
  rangeLabel: string;
  signUps: number;
  activationEligible: number;
  activated: number;
  activatedRate: number | null;
  windowComplete: boolean;
};

export type PlanMixRow = {
  plan: string;
  status: string;
  users: number;
  share: number;
};

export type FeatureDepthRow = {
  feature: string;
  users: number;
  events: number;
  perUser: number;
};

export type MonthlyReviewData = {
  generatedAt: string;
  month: MonthKey;
  monthLabel: string;
  previousMonth: MonthKey;
  previousMonthLabel: string;
  isCompleteMonth: boolean;

  newUsers: number;
  newUsersPrev: number;
  newWorkshops: number;
  newWorkshopsPrev: number;

  /** Cohort-level fixed-window activation for the whole month. */
  activationEligible: number;
  activated: number;
  activatedRate: number | null;
  retentionEligible: number;
  retained: number;
  retainedRate: number | null;
  avgDaysToActivate: number | null;

  /**
   * The signal a rate alone hides: activated users per week in ABSOLUTE terms
   * next to sign-ups. July 2026 held flat at 16-17 activations while sign-ups
   * went 39 -> 85 -> 87 -> 100.
   */
  weeks: WeekActivationRow[];

  planMix: PlanMixRow[];
  paidActive: number;
  pastDue: number;
  onFree: number;

  featureDepth: FeatureDepthRow[];

  adSpend: number | null;
  adSignups: number | null;
  ga4Signups: number | null;
  costPerSignup: number | null;
  costPerPaidUser: number | null;

  coverage: {
    coreAppLastSuccessAt: string | null;
    coreAppFailuresInMonth: number;
    latestUserSignupAt: string | null;
    latestDiagnosticAt: string | null;
    /** True when the month's window closed before the newest data we hold. */
    dataCoversMonth: boolean;
  };

  error?: string;
};

type UserRow = {
  internal_user_id: string | null;
  workshop_id: string | null;
  signed_up_at: string | null;
};

type WorkshopRow = {
  workshop_id: string | null;
  created_at: string | null;
  plan_key: string | null;
  core_subscription_status: string | null;
  is_internal_test: boolean | null;
};

type DiagnosticRow = {
  internal_user_id: string | null;
  workshop_id: string | null;
  created_at: string | null;
};

type FeatureUsageRow = {
  internal_user_id: string | null;
  feature_key: string | null;
  granularity: string | null;
  period_start: string | null;
  usage_count: number | string | null;
};

type MetricRow = {
  metric_key: string | null;
  dimension_key: string | null;
  value: number | string | null;
};

function monthKeyOf(date: Date): MonthKey {
  const p = getStockholmParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function monthLabel(key: MonthKey): string {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month) return key;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Start instant of a `YYYY-MM` key, in Stockholm civil time. */
function monthStart(key: MonthKey): Date | null {
  const [year, month] = key.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) return null;
  // Anchor mid-month at noon UTC then snap, so DST never shifts us into the
  // neighbouring month before startOfStockholmMonth runs.
  return startOfStockholmMonth(new Date(Date.UTC(year, month - 1, 15, 12)));
}

/** The most recent month that has fully ended. */
export function defaultMonthKey(now = new Date()): MonthKey {
  return monthKeyOf(addStockholmMonths(startOfStockholmMonth(now), -1));
}

export function normalizeMonthKey(
  value: string | string[] | undefined,
  now = new Date(),
): MonthKey {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && /^\d{4}-\d{2}$/.test(raw) && monthStart(raw)) {
    return raw;
  }
  return defaultMonthKey(now);
}

/** Completed months, newest first, for the picker. */
export function listMonthOptions(count = 18, now = new Date()): MonthOption[] {
  const firstOfThis = startOfStockholmMonth(now);
  const options: MonthOption[] = [];
  for (let i = 1; i <= count; i += 1) {
    const key = monthKeyOf(addStockholmMonths(firstOfThis, -i));
    options.push({ key, label: monthLabel(key) });
  }
  return options;
}

function emptyData(month: MonthKey, error?: string): MonthlyReviewData {
  const prev = monthKeyOf(
    addStockholmMonths(monthStart(month) ?? new Date(), -1),
  );
  return {
    generatedAt: new Date().toISOString(),
    month,
    monthLabel: monthLabel(month),
    previousMonth: prev,
    previousMonthLabel: monthLabel(prev),
    isCompleteMonth: true,
    newUsers: 0,
    newUsersPrev: 0,
    newWorkshops: 0,
    newWorkshopsPrev: 0,
    activationEligible: 0,
    activated: 0,
    activatedRate: null,
    retentionEligible: 0,
    retained: 0,
    retainedRate: null,
    avgDaysToActivate: null,
    weeks: [],
    planMix: [],
    paidActive: 0,
    pastDue: 0,
    onFree: 0,
    featureDepth: [],
    adSpend: null,
    adSignups: null,
    ga4Signups: null,
    costPerSignup: null,
    costPerPaidUser: null,
    coverage: {
      coreAppLastSuccessAt: null,
      coreAppFailuresInMonth: 0,
      latestUserSignupAt: null,
      latestDiagnosticAt: null,
      dataCoversMonth: false,
    },
    error,
  };
}

const getMonthlyReviewDataCached = unstable_cache(
  (month: string, country: string | null) =>
    getMonthlyReviewDataUncached(month, country),
  ["ceo-monthly-review"],
  CEO_CACHE_OPTIONS,
);

export function getMonthlyReviewData(
  month: MonthKey,
  country: string | null = null,
): Promise<MonthlyReviewData> {
  return getMonthlyReviewDataCached(month, country);
}

function numeric(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function getMonthlyReviewDataUncached(
  month: MonthKey,
  country: string | null,
): Promise<MonthlyReviewData> {
  const start = monthStart(month);
  if (!start) return emptyData(month, `Unrecognised month "${month}".`);
  const end = addStockholmMonths(start, 1);
  const prevStart = addStockholmMonths(start, -1);
  const prevKey = monthKeyOf(prevStart);

  if (!hasSupabaseConfig()) return emptyData(month);
  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyData(month);

  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const prevStartIso = prevStart.toISOString();

  const usersQuery = pageAll<UserRow>(({ from, to }) =>
    supabase
      .from(TABLES.users)
      .select("internal_user_id, workshop_id, signed_up_at")
      .gte("signed_up_at", prevStartIso)
      .lt("signed_up_at", endIso)
      .order("internal_user_id", { ascending: true })
      .range(from, to),
  );

  const workshopsQuery = pageAll<WorkshopRow>(({ from, to }) =>
    supabase
      .from(TABLES.workshops)
      .select(
        "workshop_id, created_at, plan_key, core_subscription_status, is_internal_test",
      )
      .gte("created_at", prevStartIso)
      .lt("created_at", endIso)
      .order("workshop_id", { ascending: true })
      .range(from, to),
  );

  // Diagnostics must extend past the month end by the retention window,
  // otherwise a user who signs up on the 31st has their window truncated and
  // reads as a non-activation. That truncation is precisely the bug this page
  // is built to avoid.
  const diagEndIso = new Date(
    end.getTime() + RETENTION_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const diagnosticsQuery = pageAll<DiagnosticRow>(({ from, to }) =>
    supabase
      .from(TABLES.diagnostics)
      .select("internal_user_id, workshop_id, created_at")
      .gte("created_at", prevStartIso)
      .lt("created_at", diagEndIso)
      .order("diagnostic_id", { ascending: true })
      .range(from, to),
  );

  const featureQuery = pageAll<FeatureUsageRow>(({ from, to }) =>
    supabase
      .from(TABLES.featureUsage)
      .select("internal_user_id, feature_key, granularity, period_start, usage_count")
      .eq("granularity", "day")
      .gte("period_start", startIso.slice(0, 10))
      .lt("period_start", endIso.slice(0, 10))
      .order("internal_user_id", { ascending: true })
      .range(from, to),
  );

  const metricsQuery = pageAll<MetricRow>(({ from, to }) =>
    supabase
      .from(TABLES.metricSnapshots)
      .select("metric_key, dimension_key, value")
      .in("metric_key", ["ad_spend", "ad_signups", "signup"])
      .gte("period_start", startIso)
      .lt("period_start", endIso)
      .order("id", { ascending: true })
      .range(from, to),
  );

  const [
    usersResult,
    workshopsResult,
    diagnosticsResult,
    featureResult,
    metricsResult,
    internalTestSets,
    countrySets,
  ] = await Promise.all([
    usersQuery,
    workshopsQuery,
    diagnosticsQuery,
    featureQuery,
    metricsQuery,
    loadInternalTestSets(),
    loadCountryFilterSets(country),
  ]);

  if (usersResult.error || workshopsResult.error || diagnosticsResult.error) {
    return emptyData(
      month,
      usersResult.error?.message ??
        workshopsResult.error?.message ??
        diagnosticsResult.error?.message,
    );
  }

  const keep = (userId: string | null, workshopId: string | null) =>
    !isInternalTestUserOrWorkshopWith(internalTestSets, userId, workshopId) &&
    (!countrySets || inCountryWith(countrySets, userId, workshopId));

  const users = usersResult.data.filter((u) =>
    keep(u.internal_user_id, u.workshop_id),
  );
  const workshops = workshopsResult.data.filter(
    (w) => !w.is_internal_test && keep(null, w.workshop_id),
  );
  const diagnostics = diagnosticsResult.data.filter((d) =>
    keep(d.internal_user_id, d.workshop_id),
  );

  const diagTimesByUser = new Map<string, number[]>();
  for (const d of diagnostics) {
    if (!d.internal_user_id || !d.created_at) continue;
    const ms = new Date(d.created_at).getTime();
    if (Number.isNaN(ms)) continue;
    const list = diagTimesByUser.get(d.internal_user_id);
    if (list) list.push(ms);
    else diagTimesByUser.set(d.internal_user_id, [ms]);
  }

  const startMs = start.getTime();
  const endMs = end.getTime();
  const prevStartMs = prevStart.getTime();
  const nowMs = Date.now();

  const cohort: Array<{ userId: string; signupMs: number; workshopId: string | null }> =
    [];
  let newUsersPrev = 0;
  let latestUserSignupMs = 0;

  for (const u of users) {
    if (!u.signed_up_at) continue;
    const ms = new Date(u.signed_up_at).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms > latestUserSignupMs) latestUserSignupMs = ms;
    if (ms >= startMs && ms < endMs) {
      if (u.internal_user_id) {
        cohort.push({
          userId: u.internal_user_id,
          signupMs: ms,
          workshopId: u.workshop_id,
        });
      }
    } else if (ms >= prevStartMs && ms < startMs) {
      newUsersPrev += 1;
    }
  }

  let newWorkshops = 0;
  let newWorkshopsPrev = 0;
  const cohortWorkshopIds = new Set<string>();
  for (const w of workshops) {
    if (!w.created_at) continue;
    const ms = new Date(w.created_at).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms >= startMs && ms < endMs) {
      newWorkshops += 1;
      if (w.workshop_id) cohortWorkshopIds.add(w.workshop_id);
    } else if (ms >= prevStartMs && ms < startMs) {
      newWorkshopsPrev += 1;
    }
  }

  // --- fixed-window activation, whole month + per ISO-ish week of the month ---
  let activationEligible = 0;
  let activated = 0;
  let retentionEligible = 0;
  let retained = 0;
  let daysSum = 0;
  let daysCount = 0;

  // Weeks are day-of-month blocks (1-7, 8-14, 15-21, 22-end) rather than ISO
  // weeks, so every row belongs to exactly one month and the table always has
  // four comparable rows.
  const weekBuckets = [
    { label: "Days 1-7", from: 1, to: 7 },
    { label: "Days 8-14", from: 8, to: 14 },
    { label: "Days 15-21", from: 15, to: 21 },
    { label: "Days 22-end", from: 22, to: 31 },
  ].map((w) => ({
    ...w,
    signUps: 0,
    activationEligible: 0,
    activated: 0,
  }));

  for (const member of cohort) {
    const verdict = evaluateUserWindows(
      member.signupMs,
      diagTimesByUser.get(member.userId) ?? [],
      nowMs,
    );

    if (verdict.activationEligible) activationEligible += 1;
    if (verdict.activated) {
      activated += 1;
      if (verdict.daysToActivate !== null) {
        daysSum += verdict.daysToActivate;
        daysCount += 1;
      }
    }
    if (verdict.retentionEligible) retentionEligible += 1;
    if (verdict.retained) retained += 1;

    const day = getStockholmParts(new Date(member.signupMs)).day;
    const bucket = weekBuckets.find((w) => day >= w.from && day <= w.to);
    if (bucket) {
      bucket.signUps += 1;
      if (verdict.activationEligible) bucket.activationEligible += 1;
      if (verdict.activated) bucket.activated += 1;
    }
  }

  const weeks: WeekActivationRow[] = weekBuckets.map((w) => ({
    label: w.label,
    rangeLabel: `${month}-${String(w.from).padStart(2, "0")} onward`,
    signUps: w.signUps,
    activationEligible: w.activationEligible,
    activated: w.activated,
    activatedRate:
      w.activationEligible > 0 ? (w.activated / w.activationEligible) * 100 : null,
    windowComplete: w.activationEligible >= w.signUps,
  }));

  // --- plan mix of the cohort's workshops ---
  const planCounts = new Map<string, number>();
  let paidActive = 0;
  let pastDue = 0;
  let onFree = 0;
  const cohortWorkshopRows = workshops.filter(
    (w) => w.workshop_id && cohortWorkshopIds.has(w.workshop_id),
  );
  for (const w of cohortWorkshopRows) {
    const plan = w.plan_key ?? "(no plan)";
    const status = w.core_subscription_status ?? "(none)";
    const key = `${plan} ${status}`;
    planCounts.set(key, (planCounts.get(key) ?? 0) + 1);
    const isFree = plan === "free";
    if (status === "past_due") pastDue += 1;
    else if (isFree) onFree += 1;
    else if (status === "active") paidActive += 1;
  }
  const planTotal = cohortWorkshopRows.length;
  const planMix: PlanMixRow[] = [...planCounts.entries()]
    .map(([key, users]) => {
      const [plan, status] = key.split(" ");
      return {
        plan,
        status,
        users,
        share: planTotal > 0 ? (users / planTotal) * 100 : 0,
      };
    })
    .sort((a, b) => b.users - a.users);

  // --- feature depth ---
  const featureUsers = new Map<string, Set<string>>();
  const featureEvents = new Map<string, number>();
  for (const f of featureResult.data) {
    if (!f.feature_key || !f.internal_user_id) continue;
    if (!keep(f.internal_user_id, null)) continue;
    const set = featureUsers.get(f.feature_key) ?? new Set<string>();
    set.add(f.internal_user_id);
    featureUsers.set(f.feature_key, set);
    featureEvents.set(
      f.feature_key,
      (featureEvents.get(f.feature_key) ?? 0) + numeric(f.usage_count),
    );
  }
  const featureDepth: FeatureDepthRow[] = [...featureUsers.entries()]
    .map(([feature, set]) => {
      const events = featureEvents.get(feature) ?? 0;
      return {
        feature,
        users: set.size,
        events,
        perUser: set.size > 0 ? events / set.size : 0,
      };
    })
    .sort((a, b) => b.events - a.events);

  // --- acquisition ---
  let adSpend = 0;
  let adSignups = 0;
  let ga4Signups = 0;
  let sawSpend = false;
  let sawAdSignups = false;
  let sawGa4 = false;
  for (const m of metricsResult.data) {
    const v = numeric(m.value);
    if (m.metric_key === "ad_spend") {
      adSpend += v;
      sawSpend = true;
    } else if (m.metric_key === "ad_signups") {
      adSignups += v;
      sawAdSignups = true;
    } else if (m.metric_key === "signup") {
      ga4Signups += v;
      sawGa4 = true;
    }
  }

  // --- coverage ---
  const [coreRuns, latestDiag] = await Promise.all([
    supabase
      .from(TABLES.syncRuns)
      .select("status, completed_at, started_at")
      .eq("source_key", "core_app")
      .gte("started_at", startIso)
      .order("started_at", { ascending: false })
      .limit(1000),
    supabase
      .from(TABLES.diagnostics)
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  let coreAppFailuresInMonth = 0;
  let coreAppLastSuccessAt: string | null = null;
  for (const run of coreRuns.data ?? []) {
    const r = run as { status?: string | null; completed_at?: string | null };
    if (r.status === "failed") coreAppFailuresInMonth += 1;
    if (r.status === "success" && r.completed_at && !coreAppLastSuccessAt) {
      coreAppLastSuccessAt = r.completed_at;
    }
  }
  const latestDiagnosticAt =
    (latestDiag.data?.[0] as { created_at?: string | null } | undefined)
      ?.created_at ?? null;

  const latestUserSignupAt =
    latestUserSignupMs > 0 ? new Date(latestUserSignupMs).toISOString() : null;

  // The month is only properly covered if the newest row-level data we hold is
  // at or past the month's end. Otherwise part of the month was never ingested.
  const newestDataMs = Math.max(
    latestUserSignupMs,
    latestDiagnosticAt ? new Date(latestDiagnosticAt).getTime() : 0,
  );
  const dataCoversMonth = newestDataMs >= endMs;

  const newUsers = cohort.length;
  const costPerSignup =
    sawSpend && newUsers > 0 ? adSpend / newUsers : null;
  const costPerPaidUser =
    sawSpend && paidActive > 0 ? adSpend / paidActive : null;

  return {
    generatedAt: new Date().toISOString(),
    month,
    monthLabel: monthLabel(month),
    previousMonth: prevKey,
    previousMonthLabel: monthLabel(prevKey),
    isCompleteMonth: endMs <= nowMs,

    newUsers,
    newUsersPrev,
    newWorkshops,
    newWorkshopsPrev,

    activationEligible,
    activated,
    activatedRate:
      activationEligible > 0 ? (activated / activationEligible) * 100 : null,
    retentionEligible,
    retained,
    retainedRate:
      retentionEligible > 0 ? (retained / retentionEligible) * 100 : null,
    avgDaysToActivate: daysCount > 0 ? daysSum / daysCount : null,

    weeks,
    planMix,
    paidActive,
    pastDue,
    onFree,
    featureDepth,

    adSpend: sawSpend ? adSpend : null,
    adSignups: sawAdSignups ? adSignups : null,
    ga4Signups: sawGa4 ? ga4Signups : null,
    costPerSignup,
    costPerPaidUser,

    coverage: {
      coreAppLastSuccessAt,
      coreAppFailuresInMonth,
      latestUserSignupAt,
      latestDiagnosticAt,
      dataCoversMonth,
    },
  };
}

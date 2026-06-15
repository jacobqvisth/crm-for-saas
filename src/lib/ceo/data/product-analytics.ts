// Live PostHog product-analytics loader for /dashboard/product-analytics.
//
// Unlike most dashboard pages (which read the pre-synced dashboard_* tables),
// this one queries PostHog's HogQL API at render time and caches for 5 minutes
// (CEO_CACHE_OPTIONS). Funnels / retention / per-workshop breakdowns are too
// dimensional to flatten into the flat metric table, and the page runs on
// Vercel where POSTHOG_API_KEY already lives.
//
// Every event is keyed on the Cognito sub (= contacts.wl_user_id) and grouped
// by workshop_id ($group_0), with person properties (plan/country/privilege)
// set at login — so we can segment, exclude staff, and roll up per account in
// ways GA4 (anonymous) and the core_app export (outcomes only) never allowed.
import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { getEnv } from "@/lib/ceo/env";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { formatHogqlDateTime, runPostHogQuery } from "@/lib/ceo/sync/sources/posthog";
import { TABLES } from "@/lib/ceo/tables";
import {
  DEFAULT_TIME_RANGE_KEY,
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
  type DashboardTimeRangeKey,
  type ResolvedDashboardRange,
} from "@/lib/ceo/time-ranges";

export type ProductOverview = {
  events: number;
  activeUsers: number;
  sessions: number;
  pageviews: number;
  avgDau: number;
  stickiness: number;
};

export type ProductTrendPoint = {
  day: string;
  events: number;
  users: number;
  pageviews: number;
  sessions: number;
};

export type ProductFunnelStep = {
  key: string;
  label: string;
  users: number;
  conversionFromPrevious: number;
};

export type ProductEventRow = {
  key: string;
  label: string;
  count: number;
  users: number;
};

export type ProductErrorRow = {
  type: string;
  count: number;
  users: number;
  lastSeen: string | null;
};

export type ProductWorkshopRow = {
  workshopId: string;
  name: string | null;
  events: number;
  users: number;
  lastSeen: string | null;
};

export type ProductSegmentRow = {
  key: string;
  users: number;
  events: number;
};

export type ProductAnalyticsData = {
  rangeKey: DashboardTimeRangeKey;
  rangeLabel: string;
  available: boolean;
  note: string | null;
  overview: ProductOverview;
  trend: ProductTrendPoint[];
  diagnosticFunnel: ProductFunnelStep[];
  monetization: ProductEventRow[];
  topEvents: ProductEventRow[];
  errors: ProductErrorRow[];
  workshops: ProductWorkshopRow[];
  byPlan: ProductSegmentRow[];
  byCountry: ProductSegmentRow[];
};

// Exclude internal staff/admin. `privilege` is null for real users, so a bare
// NOT IN would drop everyone (null NOT IN (...) → null → filtered). coalesce
// to '' keeps the real users in.
const STAFF_FILTER =
  "coalesce(person.properties.privilege, '') NOT IN ('admin', 'staff')";

const DIAGNOSTIC_STEPS: Array<{ event: string; label: string }> = [
  { event: "vehicle_selected", label: "Vehicle selected" },
  { event: "diagnostic_started", label: "Diagnostic started" },
  { event: "diagnostic_run", label: "Diagnostic run" },
  { event: "diagnostic_analyzed", label: "Diagnostic analyzed" },
  { event: "diagnostic_completed", label: "Diagnostic completed" },
];

const MONETIZATION_EVENTS: Array<{ event: string; label: string }> = [
  { event: "feature_paywall_hit", label: "Hit a paywall" },
  { event: "billing_page_opened", label: "Opened billing" },
  { event: "upgrade_started", label: "Started upgrade" },
  { event: "card_added", label: "Added a card" },
  { event: "plan_changed", label: "Changed plan" },
  { event: "subscription_started", label: "Started subscription" },
];

function windowClause(range: ResolvedDashboardRange): string {
  const parts: string[] = [];
  if (range.start) {
    parts.push(`timestamp >= toDateTime('${formatHogqlDateTime(range.start)}')`);
  }
  parts.push(`timestamp < toDateTime('${formatHogqlDateTime(range.end)}')`);
  return parts.join(" AND ");
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

type Row = Array<string | number | null>;

// Run a query, returning rows or [] on any failure so one broken widget never
// blanks the whole page.
async function rows(query: string): Promise<Row[]> {
  try {
    const res = await runPostHogQuery(query);
    return (res.results ?? []) as Row[];
  } catch (error) {
    console.error("PostHog product-analytics query failed", error);
    return null as unknown as Row[];
  }
}

function emptyData(
  rangeKey: DashboardTimeRangeKey,
  rangeLabel: string,
  note: string,
): ProductAnalyticsData {
  return {
    rangeKey,
    rangeLabel,
    available: false,
    note,
    overview: {
      events: 0,
      activeUsers: 0,
      sessions: 0,
      pageviews: 0,
      avgDau: 0,
      stickiness: 0,
    },
    trend: [],
    diagnosticFunnel: [],
    monetization: [],
    topEvents: [],
    errors: [],
    workshops: [],
    byPlan: [],
    byCountry: [],
  };
}

async function getProductAnalyticsUncached(
  range: ResolvedDashboardRange,
): Promise<ProductAnalyticsData> {
  if (!getEnv("POSTHOG_API_KEY") || !getEnv("POSTHOG_PROJECT_ID")) {
    return emptyData(
      range.key,
      range.label,
      "PostHog is not configured (POSTHOG_API_KEY / POSTHOG_PROJECT_ID).",
    );
  }

  const w = windowClause(range);
  const base = `FROM events WHERE ${w} AND ${STAFF_FILTER}`;

  const diagSelect = DIAGNOSTIC_STEPS.map(
    (s, i) => `uniqIf(person_id, event = '${s.event}') AS s${i}`,
  ).join(", ");
  const monSelect = MONETIZATION_EVENTS.map(
    (s, i) => `uniqIf(person_id, event = '${s.event}') AS m${i}`,
  ).join(", ");

  const [
    overviewRows,
    trendRows,
    diagRows,
    monRows,
    topRows,
    errorRows,
    workshopRows,
    planRows,
    countryRows,
  ] = await Promise.all([
    rows(
      `SELECT count() AS events, count(DISTINCT person_id) AS users, ` +
        `count(DISTINCT properties.$session_id) AS sessions, ` +
        `countIf(event = '$pageview') AS pageviews ${base}`,
    ),
    rows(
      `SELECT toDate(timestamp) AS day, count() AS events, ` +
        `count(DISTINCT person_id) AS users, ` +
        `countIf(event = '$pageview') AS pageviews, ` +
        `count(DISTINCT properties.$session_id) AS sessions ` +
        `${base} GROUP BY day ORDER BY day`,
    ),
    rows(`SELECT ${diagSelect} ${base}`),
    rows(`SELECT ${monSelect} ${base}`),
    rows(
      `SELECT event, count() AS c, count(DISTINCT person_id) AS u ` +
        `${base} GROUP BY event ORDER BY c DESC LIMIT 20`,
    ),
    rows(
      `SELECT coalesce(properties.$exception_type, 'Error') AS type, ` +
        `count() AS c, count(DISTINCT person_id) AS u, max(timestamp) AS last_seen ` +
        `FROM events WHERE event = '$exception' AND ${w} AND ${STAFF_FILTER} ` +
        `GROUP BY type ORDER BY c DESC LIMIT 15`,
    ),
    rows(
      `SELECT $group_0 AS w, count() AS c, count(DISTINCT person_id) AS u, ` +
        `max(timestamp) AS last_seen ${base} AND $group_0 != '' ` +
        `GROUP BY w ORDER BY c DESC LIMIT 25`,
    ),
    rows(
      `SELECT coalesce(person.properties.plan, '(unknown)') AS k, ` +
        `count(DISTINCT person_id) AS users, count() AS events ` +
        `${base} GROUP BY k ORDER BY users DESC LIMIT 20`,
    ),
    rows(
      `SELECT coalesce(person.properties.country, '(unknown)') AS k, ` +
        `count(DISTINCT person_id) AS users, count() AS events ` +
        `${base} GROUP BY k ORDER BY users DESC LIMIT 20`,
    ),
  ]);

  // If every query failed, surface a single error state rather than a page of
  // zeros that looks like "no activity".
  if (
    [
      overviewRows,
      trendRows,
      diagRows,
      monRows,
      topRows,
      errorRows,
      workshopRows,
      planRows,
      countryRows,
    ].every((r) => r == null)
  ) {
    return emptyData(
      range.key,
      range.label,
      "PostHog queries failed. Check the API key scope (Query: Read) and project.",
    );
  }

  const trend: ProductTrendPoint[] = (trendRows ?? []).map((r) => ({
    day: str(r[0]).slice(0, 10),
    events: num(r[1]),
    users: num(r[2]),
    pageviews: num(r[3]),
    sessions: num(r[4]),
  }));

  const ov = (overviewRows ?? [])[0] ?? [];
  const activeUsers = num(ov[1]);
  const avgDau =
    trend.length > 0
      ? Math.round(trend.reduce((sum, p) => sum + p.users, 0) / trend.length)
      : 0;
  const overview: ProductOverview = {
    events: num(ov[0]),
    activeUsers,
    sessions: num(ov[2]),
    pageviews: num(ov[3]),
    avgDau,
    stickiness: activeUsers > 0 ? avgDau / activeUsers : 0,
  };

  const diag = (diagRows ?? [])[0] ?? [];
  let prevUsers = 0;
  const diagnosticFunnel: ProductFunnelStep[] = DIAGNOSTIC_STEPS.map(
    (step, i) => {
      const users = num(diag[i]);
      const conversionFromPrevious =
        i === 0 ? 1 : prevUsers > 0 ? users / prevUsers : 0;
      prevUsers = users;
      return {
        key: step.event,
        label: step.label,
        users,
        conversionFromPrevious,
      };
    },
  );

  const mon = (monRows ?? [])[0] ?? [];
  const monetization: ProductEventRow[] = MONETIZATION_EVENTS.map((m, i) => ({
    key: m.event,
    label: m.label,
    count: 0,
    users: num(mon[i]),
  }));

  const topEvents: ProductEventRow[] = (topRows ?? []).map((r) => ({
    key: str(r[0]),
    label: str(r[0]),
    count: num(r[1]),
    users: num(r[2]),
  }));

  const errors: ProductErrorRow[] = (errorRows ?? []).map((r) => ({
    type: str(r[0]) || "Error",
    count: num(r[1]),
    users: num(r[2]),
    lastSeen: r[3] ? str(r[3]) : null,
  }));

  // Resolve workshop UUIDs → company names from the synced workshops table.
  const workshopBase = (workshopRows ?? []).map((r) => ({
    workshopId: str(r[0]),
    events: num(r[1]),
    users: num(r[2]),
    lastSeen: r[3] ? str(r[3]) : null,
  }));
  const nameById = await loadWorkshopNames(
    workshopBase.map((row) => row.workshopId),
  );
  const workshops: ProductWorkshopRow[] = workshopBase.map((row) => ({
    ...row,
    name: nameById.get(row.workshopId) ?? null,
  }));

  const toSegments = (input: Row[] | null): ProductSegmentRow[] =>
    (input ?? []).map((r) => ({
      key: str(r[0]) || "(unknown)",
      users: num(r[1]),
      events: num(r[2]),
    }));

  return {
    rangeKey: range.key,
    rangeLabel: range.label,
    available: true,
    note: null,
    overview,
    trend,
    diagnosticFunnel,
    monetization,
    topEvents,
    errors,
    workshops,
    byPlan: toSegments(planRows),
    byCountry: toSegments(countryRows),
  };
}

async function loadWorkshopNames(
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return map;

  const supabase = createSupabaseServiceClient();
  if (!supabase) return map;

  const { data, error } = await supabase
    .from(TABLES.workshops)
    .select("workshop_id, name")
    .in("workshop_id", unique);
  if (error || !data) return map;

  for (const row of data as Array<{ workshop_id: string; name: string | null }>) {
    if (row.name) map.set(row.workshop_id, row.name);
  }
  return map;
}

const getProductAnalyticsCached = unstable_cache(
  (rangeKey: string) =>
    getProductAnalyticsUncached(
      resolveDashboardTimeRange(
        normalizeDashboardTimeRangeKey(rangeKey),
      ),
    ),
  ["ceo-product-analytics"],
  CEO_CACHE_OPTIONS,
);

export function getProductAnalyticsData(
  rangeParam?: string | string[],
): Promise<ProductAnalyticsData> {
  return getProductAnalyticsCached(normalizeDashboardTimeRangeKey(rangeParam));
}

export const PRODUCT_ANALYTICS_DEFAULT_RANGE_KEY: DashboardTimeRangeKey =
  DEFAULT_TIME_RANGE_KEY;

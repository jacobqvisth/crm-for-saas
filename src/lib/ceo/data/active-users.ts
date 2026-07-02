import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { loadCountryFilterSets } from "@/lib/ceo/countries";
import { addStockholmDays, toStockholmIsoDate } from "@/lib/ceo/dates";
import { loadInternalTestSets } from "@/lib/ceo/internal-test/loader";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { runGa4Report } from "@/lib/ceo/sync/ga4-client";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";
import {
  formatRangeDateSpan,
  isDashboardTimeRangeKey,
  resolveDashboardTimeRange,
  type DashboardTimeRangeKey,
  type ResolvedDashboardRange,
} from "@/lib/ceo/time-ranges";

// The web app surface we attribute "logged-in activity" to. iOS / Android
// native events have no hostName, so this page intentionally scopes to the
// web app only — matching the user's "actions on app.wrenchlane.com" ask.
const APP_HOST = "app.wrenchlane.com";

// crm_user_id values that are not real Cognito subs. "(not set)" is GA4's
// placeholder for events with no value; "" shows up for app-host events that
// fired before user_identified resolved.
const NON_IDS = new Set(["(not set)", "", "(other)"]);

// crm_user_id custom dim was registered 2026-05-25; nothing exists before then,
// so "all_time" / null-start ranges start the GA4 window here rather than at
// the property's origin (avoids a pointless multi-year empty scan).
const CRM_USER_ID_EPOCH = "2026-05-25";

// How many distinct event types to surface per user in the "Top actions" cell.
const TOP_ACTIONS_PER_USER = 5;

export type ActiveUserAction = {
  event: string;
  count: number;
};

// How we identified this user:
//  - "contact": matched a CRM contact on contacts.wl_user_id (full record).
//  - "app":     no contact, but the Cognito sub exists in dashboard_users, so
//               we still know their app username + workshop (a sub-user of a
//               workshop that hasn't been propagated to its own contact row).
//  - "none":    only a bare GA4/diagnostics sub — nothing else known.
export type IdentitySource = "contact" | "app" | "none";

export type ActiveUserRow = {
  crmUserId: string;
  matched: boolean;
  identitySource: IdentitySource;
  appUsername: string | null;
  // wl_workshop_id of the user's workshop, when known — used to link the
  // company cell to /dashboard/workshops/{workshopId}.
  workshopId: string | null;
  name: string | null;
  email: string | null;
  title: string | null;
  company: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  lifecycleStage: string | null;
  appRole: string | null;
  leadStatus: string | null;
  location: string | null;
  lastActiveAt: string | null;
  signedUpAt: string | null;
  // GA4 engagement on app.wrenchlane.com
  sessions: number;
  pageViews: number;
  events: number;
  engagedSeconds: number;
  topActions: ActiveUserAction[];
  // First-party app business events
  diagnostics: number;
  diagnosticsLifetime: number | null;
  loginCount: number | null;
  creditsRemaining: number | null;
};

export type ActiveUsersData = {
  rangeKey: DashboardTimeRangeKey;
  rangeLabel: string;
  rangeSpan: string;
  ga4Available: boolean;
  note: string | null;
  totals: {
    activeUsers: number;
    sessions: number;
    pageViews: number;
    events: number;
    engagedSeconds: number;
    diagnostics: number;
  };
  rows: ActiveUserRow[];
};

// Page default is "yesterday" (the framing of the original ask), not the
// dashboard-wide "last_30_days".
export const ACTIVE_USERS_DEFAULT_RANGE_KEY: DashboardTimeRangeKey =
  "yesterday";

export function normalizeActiveUsersRangeKey(
  value: string | string[] | undefined,
): DashboardTimeRangeKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isDashboardTimeRangeKey(candidate)
    ? candidate
    : ACTIVE_USERS_DEFAULT_RANGE_KEY;
}

function ga4StartDate(range: ResolvedDashboardRange): string {
  return range.start ? toStockholmIsoDate(range.start) : CRM_USER_ID_EPOCH;
}

function ga4EndDate(range: ResolvedDashboardRange): string {
  // `end` is exclusive — step back one Stockholm day for GA4's inclusive end.
  return toStockholmIsoDate(addStockholmDays(range.end, -1));
}

type Ga4UserTotals = {
  sessions: number;
  pageViews: number;
  events: number;
  engagedSeconds: number;
};

type ContactIdentity = {
  name: string | null;
  appUsername: string | null;
  workshopId: string | null;
  email: string | null;
  title: string | null;
  company: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  lifecycleStage: string | null;
  appRole: string | null;
  leadStatus: string | null;
  location: string | null;
  lastActiveAt: string | null;
  signedUpAt: string | null;
  diagnosticsLifetime: number | null;
  loginCount: number | null;
  creditsRemaining: number | null;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function resolveContacts(
  ids: string[],
): Promise<Map<string, ContactIdentity>> {
  const map = new Map<string, ContactIdentity>();
  const supabase = createSupabaseServiceClient();
  if (!supabase || ids.length === 0) return map;

  type ContactRow = {
    wl_user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    title: string | null;
    app_username: string | null;
    app_role: string | null;
    lead_status: string | null;
    city: string | null;
    country: string | null;
    last_active_at: string | null;
    created_at: string | null;
    login_count: number | null;
    credits_remaining: number | null;
    user_plan_type: string | null;
    user_subscription_status: string | null;
    diagnostics_total: number | null;
    company_id: string | null;
  };

  const contactRows: ContactRow[] = [];
  // Chunk the .in() list — PostgREST builds the filter into the URL and a few
  // hundred UUIDs can blow the length limit.
  for (const group of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from("contacts")
      .select(
        "wl_user_id, first_name, last_name, email, title, app_username, app_role, lead_status, city, country, last_active_at, created_at, login_count, credits_remaining, user_plan_type, user_subscription_status, diagnostics_total, company_id",
      )
      .in("wl_user_id", group);

    if (error) {
      console.error("Active users contact lookup failed", error);
      continue;
    }
    contactRows.push(...((data ?? []) as ContactRow[]));
  }

  // Resolve company firmographics in a second batched pass (avoids relying on a
  // PostgREST embed that could be ambiguous if contacts ever gains a second FK
  // to companies).
  type CompanyInfo = {
    name: string | null;
    plan: string | null;
    customer_status: string | null;
    lifecycle_stage: string | null;
    wl_workshop_id: string | null;
  };
  const companyIds = [
    ...new Set(
      contactRows
        .map((row) => row.company_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const companies = new Map<string, CompanyInfo>();
  for (const group of chunk(companyIds, 100)) {
    const { data, error } = await supabase
      .from("companies")
      .select("id, name, plan, customer_status, lifecycle_stage, wl_workshop_id")
      .in("id", group);
    if (error) {
      console.error("Active users company lookup failed", error);
      continue;
    }
    for (const raw of (data ?? []) as ({ id: string } & CompanyInfo)[]) {
      companies.set(raw.id, {
        name: raw.name,
        plan: raw.plan,
        customer_status: raw.customer_status,
        lifecycle_stage: raw.lifecycle_stage,
        wl_workshop_id: raw.wl_workshop_id,
      });
    }
  }

  for (const row of contactRows) {
    const id = row.wl_user_id ? String(row.wl_user_id) : null;
    if (!id) continue;

    const fullName = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
    const company = row.company_id ? companies.get(row.company_id) : undefined;
    const location =
      [row.city, row.country].filter(Boolean).join(", ") || null;

    map.set(id, {
      name: fullName || row.app_username || null,
      appUsername: row.app_username,
      workshopId: company?.wl_workshop_id ?? null,
      email: row.email,
      title: row.title,
      company: company?.name ?? null,
      // Workshop-level plan/lifecycle wins; fall back to the per-user plan
      // string when the contact has no company.
      plan: company?.plan ?? row.user_plan_type ?? null,
      subscriptionStatus:
        row.user_subscription_status ?? company?.customer_status ?? null,
      lifecycleStage: company?.lifecycle_stage ?? null,
      appRole: row.app_role,
      leadStatus: row.lead_status,
      location,
      lastActiveAt: row.last_active_at,
      signedUpAt: row.created_at,
      diagnosticsLifetime: row.diagnostics_total,
      loginCount: row.login_count,
      creditsRemaining: row.credits_remaining,
    });
  }

  return map;
}

// Second-tier identity for subs with no CRM contact. dashboard_users carries
// the Cognito sub (internal_user_id) plus a metadata bag with the app username,
// workshop name and role — so a sub-user of a workshop that was only propagated
// as a single shared-inbox contact still resolves to "username @ workshop"
// instead of a bare hex id. workshop_id here is the wl_workshop_id, so it links
// straight to the CEO workshop detail page.
type AppUserIdentity = {
  appUsername: string | null;
  company: string | null;
  workshopId: string | null;
  appRole: string | null;
  plan: string | null;
  signedUpAt: string | null;
  lastActiveAt: string | null;
  loginCount: number | null;
  creditsRemaining: number | null;
};

async function resolveAppUsers(
  ids: string[],
): Promise<Map<string, AppUserIdentity>> {
  const map = new Map<string, AppUserIdentity>();
  const supabase = createSupabaseServiceClient();
  if (!supabase || ids.length === 0) return map;

  type AppUserRow = {
    internal_user_id: string;
    workshop_id: string | null;
    signed_up_at: string | null;
    last_seen_at: string | null;
    metadata: Record<string, unknown> | null;
  };

  const asStr = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v : null;
  const asNum = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  for (const group of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from("dashboard_users")
      .select(
        "internal_user_id, workshop_id, signed_up_at, last_seen_at, metadata",
      )
      .in("internal_user_id", group);

    if (error) {
      console.error("Active users app-user lookup failed", error);
      continue;
    }

    for (const row of (data ?? []) as AppUserRow[]) {
      const id = row.internal_user_id ? String(row.internal_user_id) : null;
      if (!id) continue;
      const meta = row.metadata ?? {};
      map.set(id, {
        appUsername: asStr(meta.username),
        company: asStr(meta.company_name),
        workshopId: row.workshop_id ? String(row.workshop_id) : null,
        appRole: asStr(meta.user_role),
        plan: asStr(meta.plan_type),
        signedUpAt: row.signed_up_at,
        lastActiveAt: row.last_seen_at,
        loginCount: asNum(meta.login_count),
        creditsRemaining: asNum(meta.credits_remaining),
      });
    }
  }

  return map;
}

async function getActiveUsersDataUncached(
  rangeKey: DashboardTimeRangeKey,
  country: string | null,
): Promise<ActiveUsersData> {
  const range = resolveDashboardTimeRange(rangeKey);
  const rangeSpan = formatRangeDateSpan(range);
  const startDate = ga4StartDate(range);
  const endDate = ga4EndDate(range);

  const userTotals = new Map<string, Ga4UserTotals>();
  const userActions = new Map<string, Map<string, number>>();
  let ga4Available = true;

  try {
    const hostFilter = {
      filter: {
        fieldName: "hostName",
        stringFilter: { matchType: "EXACT", value: APP_HOST },
      },
    };

    const totalsRows = await runGa4Report({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "customUser:crm_user_id" }],
      metrics: [
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "eventCount" },
        { name: "userEngagementDuration" },
      ],
      dimensionFilter: hostFilter,
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: "10000",
    });

    for (const row of totalsRows) {
      const id = row.dimensionValues?.[0]?.value ?? "";
      if (NON_IDS.has(id)) continue;
      userTotals.set(id, {
        sessions: Number(row.metricValues?.[0]?.value ?? 0),
        pageViews: Number(row.metricValues?.[1]?.value ?? 0),
        events: Number(row.metricValues?.[2]?.value ?? 0),
        engagedSeconds: Number(row.metricValues?.[3]?.value ?? 0),
      });
    }

    const actionRows = await runGa4Report({
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: "customUser:crm_user_id" },
        { name: "eventName" },
      ],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: hostFilter,
      limit: "50000",
    });

    for (const row of actionRows) {
      const id = row.dimensionValues?.[0]?.value ?? "";
      if (NON_IDS.has(id)) continue;
      const event = row.dimensionValues?.[1]?.value ?? "(unknown)";
      const count = Number(row.metricValues?.[0]?.value ?? 0);
      let bag = userActions.get(id);
      if (!bag) {
        bag = new Map<string, number>();
        userActions.set(id, bag);
      }
      bag.set(event, (bag.get(event) ?? 0) + count);
    }
  } catch (error) {
    console.error("Active users GA4 read failed", error);
    ga4Available = false;
  }

  // First-party app business events (diagnostics) for the same window, keyed
  // on internal_user_id which is the same Cognito sub as crm_user_id /
  // contacts.wl_user_id.
  const diagnosticsByUser = new Map<string, number>();
  const supabase = createSupabaseServiceClient();
  if (supabase) {
    const startIso = range.start?.toISOString();
    const endIso = range.end.toISOString();
    const diagResult = await pageAll<{ internal_user_id: string | null }>(
      ({ from, to }) => {
        let q = supabase
          .from(TABLES.diagnostics)
          .select("internal_user_id")
          .lt("created_at", endIso)
          .order("created_at", { ascending: false })
          .range(from, to);
        if (startIso) q = q.gte("created_at", startIso);
        return q;
      },
    );

    if (diagResult.error) {
      console.error("Active users diagnostics read failed", diagResult.error);
    } else {
      for (const row of diagResult.data) {
        const id = row.internal_user_id;
        if (!id) continue;
        diagnosticsByUser.set(id, (diagnosticsByUser.get(id) ?? 0) + 1);
      }
    }
  }

  // Union of everyone who showed engagement OR ran a diagnostic in the window,
  // minus internal-test accounts (unless explicitly exempted), scoped to the
  // selected country (workshop country via dashboard_users) when one is set.
  const [internalTest, countrySets] = await Promise.all([
    loadInternalTestSets(),
    loadCountryFilterSets(country),
  ]);
  const candidateIds = new Set<string>([
    ...userTotals.keys(),
    ...diagnosticsByUser.keys(),
  ]);
  const ids = [...candidateIds].filter(
    (id) =>
      (internalTest.exemptUserIds.has(id) || !internalTest.userIds.has(id)) &&
      (!countrySets || countrySets.userIds.has(id)),
  );

  const contacts = await resolveContacts(ids);
  // For everyone without a CRM contact, fall back to dashboard_users so we can
  // still show "username @ workshop" instead of a bare Cognito sub.
  const unmatchedIds = ids.filter((id) => !contacts.has(id));
  const appUsers = await resolveAppUsers(unmatchedIds);

  const rows: ActiveUserRow[] = ids.map((id) => {
    const totals = userTotals.get(id);
    const actionsBag = userActions.get(id);
    const topActions: ActiveUserAction[] = actionsBag
      ? [...actionsBag.entries()]
          .map(([event, count]) => ({ event, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, TOP_ACTIONS_PER_USER)
      : [];
    const identity = contacts.get(id);
    const appUser = identity ? undefined : appUsers.get(id);
    const identitySource: IdentitySource = identity
      ? "contact"
      : appUser
        ? "app"
        : "none";

    return {
      crmUserId: id,
      matched: Boolean(identity),
      identitySource,
      appUsername: identity?.appUsername ?? appUser?.appUsername ?? null,
      workshopId: identity?.workshopId ?? appUser?.workshopId ?? null,
      name: identity?.name ?? null,
      email: identity?.email ?? null,
      title: identity?.title ?? null,
      company: identity?.company ?? appUser?.company ?? null,
      plan: identity?.plan ?? appUser?.plan ?? null,
      subscriptionStatus: identity?.subscriptionStatus ?? null,
      lifecycleStage: identity?.lifecycleStage ?? null,
      appRole: identity?.appRole ?? appUser?.appRole ?? null,
      leadStatus: identity?.leadStatus ?? null,
      location: identity?.location ?? null,
      lastActiveAt: identity?.lastActiveAt ?? appUser?.lastActiveAt ?? null,
      signedUpAt: identity?.signedUpAt ?? appUser?.signedUpAt ?? null,
      sessions: totals?.sessions ?? 0,
      pageViews: totals?.pageViews ?? 0,
      events: totals?.events ?? 0,
      engagedSeconds: totals?.engagedSeconds ?? 0,
      topActions,
      diagnostics: diagnosticsByUser.get(id) ?? 0,
      diagnosticsLifetime: identity?.diagnosticsLifetime ?? null,
      loginCount: identity?.loginCount ?? appUser?.loginCount ?? null,
      creditsRemaining:
        identity?.creditsRemaining ?? appUser?.creditsRemaining ?? null,
    };
  });

  rows.sort(
    (a, b) => b.events - a.events || b.diagnostics - a.diagnostics,
  );

  const totals = rows.reduce(
    (acc, row) => {
      acc.sessions += row.sessions;
      acc.pageViews += row.pageViews;
      acc.events += row.events;
      acc.engagedSeconds += row.engagedSeconds;
      acc.diagnostics += row.diagnostics;
      return acc;
    },
    {
      activeUsers: rows.length,
      sessions: 0,
      pageViews: 0,
      events: 0,
      engagedSeconds: 0,
      diagnostics: 0,
    },
  );

  let note: string | null = null;
  if (!ga4Available) {
    note =
      "GA4 engagement is temporarily unavailable — showing first-party diagnostics activity only.";
  }

  return {
    rangeKey,
    rangeLabel: range.label,
    rangeSpan,
    ga4Available,
    note,
    totals,
    rows,
  };
}

const getActiveUsersDataCached = unstable_cache(
  (rangeKey: string, country: string | null) =>
    getActiveUsersDataUncached(rangeKey as DashboardTimeRangeKey, country),
  ["ceo-active-users-data"],
  CEO_CACHE_OPTIONS,
);

export function getActiveUsersData(
  rangeParam?: string | string[],
  country: string | null = null,
): Promise<ActiveUsersData> {
  return getActiveUsersDataCached(
    normalizeActiveUsersRangeKey(rangeParam),
    country,
  );
}

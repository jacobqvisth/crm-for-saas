import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
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

export type ActiveUserRow = {
  crmUserId: string;
  matched: boolean;
  name: string | null;
  email: string | null;
  company: string | null;
  appRole: string | null;
  leadStatus: string | null;
  lastActiveAt: string | null;
  // GA4 engagement on app.wrenchlane.com
  sessions: number;
  pageViews: number;
  events: number;
  topActions: ActiveUserAction[];
  // First-party app business events
  diagnostics: number;
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
};

type ContactIdentity = {
  name: string | null;
  email: string | null;
  company: string | null;
  appRole: string | null;
  leadStatus: string | null;
  lastActiveAt: string | null;
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
    app_username: string | null;
    app_role: string | null;
    lead_status: string | null;
    last_active_at: string | null;
    company_id: string | null;
  };

  const contactRows: ContactRow[] = [];
  // Chunk the .in() list — PostgREST builds the filter into the URL and a few
  // hundred UUIDs can blow the length limit.
  for (const group of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from("contacts")
      .select(
        "wl_user_id, first_name, last_name, email, app_username, app_role, lead_status, last_active_at, company_id",
      )
      .in("wl_user_id", group);

    if (error) {
      console.error("Active users contact lookup failed", error);
      continue;
    }
    contactRows.push(...((data ?? []) as ContactRow[]));
  }

  // Resolve company names in a second batched pass (avoids relying on a
  // PostgREST embed that could be ambiguous if contacts ever gains a second FK
  // to companies).
  const companyIds = [
    ...new Set(
      contactRows
        .map((row) => row.company_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const companyNames = new Map<string, string>();
  for (const group of chunk(companyIds, 100)) {
    const { data, error } = await supabase
      .from("companies")
      .select("id, name")
      .in("id", group);
    if (error) {
      console.error("Active users company lookup failed", error);
      continue;
    }
    for (const raw of (data ?? []) as { id: string; name: string | null }[]) {
      if (raw.name) companyNames.set(raw.id, raw.name);
    }
  }

  for (const row of contactRows) {
    const id = row.wl_user_id ? String(row.wl_user_id) : null;
    if (!id) continue;

    const fullName = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();

    map.set(id, {
      name: fullName || row.app_username || null,
      email: row.email,
      company: row.company_id
        ? (companyNames.get(row.company_id) ?? null)
        : null,
      appRole: row.app_role,
      leadStatus: row.lead_status,
      lastActiveAt: row.last_active_at,
    });
  }

  return map;
}

async function getActiveUsersDataUncached(
  rangeKey: DashboardTimeRangeKey,
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
  // minus internal-test accounts (unless explicitly exempted).
  const internalTest = await loadInternalTestSets();
  const candidateIds = new Set<string>([
    ...userTotals.keys(),
    ...diagnosticsByUser.keys(),
  ]);
  const ids = [...candidateIds].filter(
    (id) =>
      internalTest.exemptUserIds.has(id) || !internalTest.userIds.has(id),
  );

  const contacts = await resolveContacts(ids);

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

    return {
      crmUserId: id,
      matched: Boolean(identity),
      name: identity?.name ?? null,
      email: identity?.email ?? null,
      company: identity?.company ?? null,
      appRole: identity?.appRole ?? null,
      leadStatus: identity?.leadStatus ?? null,
      lastActiveAt: identity?.lastActiveAt ?? null,
      sessions: totals?.sessions ?? 0,
      pageViews: totals?.pageViews ?? 0,
      events: totals?.events ?? 0,
      topActions,
      diagnostics: diagnosticsByUser.get(id) ?? 0,
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
      acc.diagnostics += row.diagnostics;
      return acc;
    },
    { activeUsers: rows.length, sessions: 0, pageViews: 0, events: 0, diagnostics: 0 },
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
  (rangeKey: string) =>
    getActiveUsersDataUncached(rangeKey as DashboardTimeRangeKey),
  ["ceo-active-users-data"],
  CEO_CACHE_OPTIONS,
);

export function getActiveUsersData(
  rangeParam?: string | string[],
): Promise<ActiveUsersData> {
  return getActiveUsersDataCached(normalizeActiveUsersRangeKey(rangeParam));
}

import { addUtcDays, toIsoDate } from "@/lib/ceo/dates";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { hasGoogleApiCredentials } from "@/lib/ceo/sync/google-auth";
import { runGa4Report, type Ga4Row } from "@/lib/ceo/sync/ga4-client";
import { TABLES } from "@/lib/ceo/tables";
import type { ResolvedDashboardRange } from "@/lib/ceo/time-ranges";

export type CtaClicksHostFilter = "all" | "app" | "marketing";

export const CTA_HOST_FILTERS: CtaClicksHostFilter[] = ["app", "all", "marketing"];

const HOST_VALUES: Record<CtaClicksHostFilter, string | null> = {
  app: "app.wrenchlane.com",
  marketing: "wrenchlane.com",
  all: null,
};

export function normalizeCtaHost(
  value: string | string[] | undefined,
): CtaClicksHostFilter {
  const candidate = Array.isArray(value) ? value[0] : value;
  return (CTA_HOST_FILTERS as string[]).includes(candidate ?? "")
    ? (candidate as CtaClicksHostFilter)
    : "app";
}

export type CtaClicksKpis = {
  events: number;
  users: number;
  eventsPerUser: number;
};

export type CtaLocationRow = {
  location: string;
  events: number;
  users: number;
};

export type CtaButtonRow = {
  buttonText: string;
  location: string;
  events: number;
  users: number;
};

export type CtaDailyPoint = {
  date: string;
  events: number;
  users: number;
};

export type CtaClicksData = {
  generatedAt: string;
  hostnameFilter: CtaClicksHostFilter;
  totals: CtaClicksKpis;
  byLocation: CtaLocationRow[];
  topButtons: CtaButtonRow[];
  daily: CtaDailyPoint[];
  dimensionsWarming: boolean;
  error?: string;
};

const EMPTY_TOTALS: CtaClicksKpis = { events: 0, users: 0, eventsPerUser: 0 };

function emptyData(
  hostnameFilter: CtaClicksHostFilter,
  error?: string,
): CtaClicksData {
  return {
    generatedAt: new Date().toISOString(),
    hostnameFilter,
    totals: EMPTY_TOTALS,
    byLocation: [],
    topButtons: [],
    daily: [],
    dimensionsWarming: false,
    error,
  };
}

// Mirror of the "CTA Location" custom JS variable in GTM container
// GTM-5JRQVHHS. Keep these in sync — if the GTM regex changes, update
// this and the test fixture. Marketing-site (wrenchlane.com) paths get
// `marketing_*` prefixes so they're distinguishable from the app's
// internal sections of the same name (/pricing exists on both).
export function locationFromPagePath(
  pagePath: string | null | undefined,
  hostName?: string | null,
): string {
  const p = pagePath ?? "";
  const m = p.match(/^\/[a-z]{2,3}(\/.*)?$/);
  const rest = m ? (m[1] ?? "/") : p;

  const isMarketing = hostName === "wrenchlane.com";

  if (isMarketing) {
    if (rest === "/" || rest === "") return "marketing_home";
    if (rest === "/pricing") return "marketing_pricing";
    if (rest === "/wrenchlane-one") return "marketing_wrenchlane_one";
    if (rest === "/faster-car-diagnostics") return "marketing_landing";
    if (rest === "/about-us") return "marketing_about";
    if (rest === "/book-demo") return "marketing_book_demo";
    if (rest === "/contact") return "marketing_contact";
    if (rest === "/faq") return "marketing_faq";
    if (rest === "/signup") return "marketing_signup";
    if (rest.startsWith("/article")) return "marketing_article";
    if (rest.startsWith("/tags")) return "marketing_tag";
    return "marketing_other";
  }

  if (rest === "/" || rest === "") return "home";
  if (rest === "/dashboard") return "dashboard";
  if (rest === "/signup") return "signup";
  if (rest === "/profile") return "profile";
  if (rest === "/pricing") return "pricing";
  if (rest === "/support") return "support";
  if (rest === "/chat") return "chat";
  if (rest.startsWith("/diagnostics-v2")) return "diagnostics";
  if (rest.startsWith("/vehicle")) {
    return rest.includes("/service") ? "vehicle_service" : "vehicle";
  }
  return "other";
}

function buildDimensionFilter(host: CtaClicksHostFilter) {
  const expressions: unknown[] = [
    {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT", value: "cta_click" },
      },
    },
  ];
  const hostValue = HOST_VALUES[host];
  if (hostValue) {
    expressions.push({
      filter: {
        fieldName: "hostName",
        stringFilter: { matchType: "EXACT", value: hostValue },
      },
    });
  }
  return { andGroup: { expressions } };
}

function rangeForReport(range: ResolvedDashboardRange) {
  // GA4 expects YYYY-MM-DD strings (inclusive). Our range.end is exclusive,
  // so subtract a day for the inclusive endDate.
  const endIso = toIsoDate(addUtcDays(range.end, -1));
  // For open-ended ranges (all_time), fall back to 365 days.
  const startDate = range.start
    ? toIsoDate(range.start)
    : toIsoDate(addUtcDays(range.end, -365));
  return { startDate, endDate: endIso };
}

function enumerateDailyBuckets(range: ResolvedDashboardRange): string[] {
  // Inclusive list of YYYY-MM-DD dates between range.start (inclusive) and
  // range.end (exclusive). Pinned to UTC days to match GA4's `date` dim.
  const start = range.start ?? addUtcDays(range.end, -30);
  const out: string[] = [];
  let cur = start;
  while (cur < range.end) {
    out.push(toIsoDate(cur));
    cur = addUtcDays(cur, 1);
  }
  return out;
}

function ga4DateToIso(value: string) {
  // GA4 returns YYYYMMDD; convert to YYYY-MM-DD.
  if (value.length !== 8) return value;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function num(row: Ga4Row, idx: number) {
  const raw = row.metricValues?.[idx]?.value ?? "0";
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function dim(row: Ga4Row, idx: number) {
  return row.dimensionValues?.[idx]?.value ?? "";
}

type CtaClickStoredRow = {
  date: string | null;
  host_name: string | null;
  page_path: string | null;
  button_text: string | null;
  cta_location: string | null;
  events: number | string | null;
  users: number | string | null;
};

function numericValue(v: number | string | null): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Public entry point. Tries the daily Supabase rollup
 * (dashboard_cta_clicks, populated by /api/cron/sync-cta-clicks) first.
 * If the rollup has zero rows for the requested range — typically right
 * after deploy, before the first sync, or if the cron is down — falls
 * back to live GA4 so the page still works.
 */
export async function getCtaClicksData(
  range: ResolvedDashboardRange,
  hostnameFilter: CtaClicksHostFilter,
): Promise<CtaClicksData> {
  const stored = await getCtaClicksDataFromSupabase(range, hostnameFilter);
  if (stored && stored.totals.events > 0) {
    return stored;
  }
  return getCtaClicksDataFromGa4(range, hostnameFilter);
}

/**
 * Reads from the daily Supabase rollup. Returns null if Supabase
 * credentials are missing; returns an empty CtaClicksData (totals = 0)
 * if there are simply no rows for this range.
 */
export async function getCtaClicksDataFromSupabase(
  range: ResolvedDashboardRange,
  hostnameFilter: CtaClicksHostFilter,
): Promise<CtaClicksData | null> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const dateRange = rangeForReport(range);

  let query = supabase
    .from(TABLES.ctaClicks)
    .select("date,host_name,page_path,button_text,cta_location,events,users")
    .gte("date", dateRange.startDate)
    .lte("date", dateRange.endDate);

  const hostValue = HOST_VALUES[hostnameFilter];
  if (hostValue) {
    query = query.eq("host_name", hostValue);
  }

  const { data, error } = await query;
  if (error) {
    return emptyData(hostnameFilter, error.message);
  }

  const rows = (data ?? []) as CtaClickStoredRow[];

  // Totals
  let totalEvents = 0;
  const usersByDate = new Map<string, number>();
  const eventsByDate = new Map<string, number>();
  const usersByLocation = new Map<string, number>();
  const eventsByLocation = new Map<string, number>();
  const buttonAgg = new Map<
    string,
    { buttonText: string; location: string; events: number; users: number }
  >();
  // Track total users by summing per-day uniques across days (still an
  // over-count vs. true distinct users across the whole range, but
  // matches the existing GA4-path semantics).
  let totalUsers = 0;
  let buttonsWithText = 0;

  for (const row of rows) {
    const date = row.date ?? "";
    const host = row.host_name ?? "";
    const path = row.page_path ?? "";
    const buttonText = row.button_text ?? "";
    const ctaLocation = row.cta_location ?? "";
    const events = numericValue(row.events);
    const users = numericValue(row.users);

    totalEvents += events;
    totalUsers += users;

    eventsByDate.set(date, (eventsByDate.get(date) ?? 0) + events);
    usersByDate.set(date, (usersByDate.get(date) ?? 0) + users);

    const location = ctaLocation || locationFromPagePath(path, host);
    eventsByLocation.set(
      location,
      (eventsByLocation.get(location) ?? 0) + events,
    );
    usersByLocation.set(
      location,
      (usersByLocation.get(location) ?? 0) + users,
    );

    const displayText = buttonText || "(no text)";
    if (buttonText) buttonsWithText += events;
    const key = `${displayText}|${location}`;
    const existing = buttonAgg.get(key) ?? {
      buttonText: displayText,
      location,
      events: 0,
      users: 0,
    };
    existing.events += events;
    existing.users += users;
    buttonAgg.set(key, existing);
  }

  const daily: CtaDailyPoint[] = enumerateDailyBuckets(range).map((date) => ({
    date,
    events: eventsByDate.get(date) ?? 0,
    users: usersByDate.get(date) ?? 0,
  }));

  const byLocation: CtaLocationRow[] = [...eventsByLocation.keys()]
    .map((location) => ({
      location,
      events: eventsByLocation.get(location) ?? 0,
      users: usersByLocation.get(location) ?? 0,
    }))
    .sort((a, b) => b.events - a.events);

  const topButtons: CtaButtonRow[] = [...buttonAgg.values()]
    .sort((a, b) => b.events - a.events)
    .slice(0, 30);

  const totals: CtaClicksKpis = {
    events: totalEvents,
    users: totalUsers,
    eventsPerUser: totalUsers > 0 ? totalEvents / totalUsers : 0,
  };

  return {
    generatedAt: new Date().toISOString(),
    hostnameFilter,
    totals,
    byLocation,
    topButtons,
    daily,
    dimensionsWarming:
      topButtons.length > 0 && buttonsWithText === 0,
  };
}

/**
 * Live GA4 path — same logic as before the Supabase sync. Used as a
 * fallback when the daily rollup is empty for the requested range.
 */
export async function getCtaClicksDataFromGa4(
  range: ResolvedDashboardRange,
  hostnameFilter: CtaClicksHostFilter,
): Promise<CtaClicksData> {
  if (!hasGoogleApiCredentials()) {
    return emptyData(hostnameFilter, "GA4 credentials are not configured.");
  }

  const dateRange = rangeForReport(range);
  const filter = buildDimensionFilter(hostnameFilter);

  try {
    const [totalsRows, dailyRows, pageRows, buttonRows] = await Promise.all([
      runGa4Report({
        dateRanges: [dateRange],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: filter,
        limit: "1",
      }),
      runGa4Report({
        dateRanges: [dateRange],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: filter,
        orderBys: [{ dimension: { dimensionName: "date" } }],
        limit: "1000",
      }),
      runGa4Report({
        dateRanges: [dateRange],
        dimensions: [{ name: "pagePath" }, { name: "hostName" }],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: filter,
        orderBys: [
          { metric: { metricName: "eventCount" }, desc: true },
        ],
        limit: "500",
      }),
      runGa4Report({
        dateRanges: [dateRange],
        dimensions: [
          { name: "customEvent:button_text" },
          { name: "customEvent:cta_location" },
          { name: "pagePath" },
          { name: "hostName" },
        ],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: filter,
        orderBys: [
          { metric: { metricName: "eventCount" }, desc: true },
        ],
        limit: "100",
      }),
    ]);

    const totals: CtaClicksKpis = totalsRows[0]
      ? {
          events: num(totalsRows[0], 0),
          users: num(totalsRows[0], 1),
          eventsPerUser:
            num(totalsRows[0], 1) > 0
              ? num(totalsRows[0], 0) / num(totalsRows[0], 1)
              : 0,
        }
      : EMPTY_TOTALS;

    // Daily series with zero-fill for every day in the requested range.
    const dailyMap = new Map<string, { events: number; users: number }>();
    for (const row of dailyRows) {
      const iso = ga4DateToIso(dim(row, 0));
      dailyMap.set(iso, { events: num(row, 0), users: num(row, 1) });
    }
    const daily: CtaDailyPoint[] = enumerateDailyBuckets(range).map((date) => ({
      date,
      events: dailyMap.get(date)?.events ?? 0,
      users: dailyMap.get(date)?.users ?? 0,
    }));

    // Bucket pagePath + hostName → cta_location server-side (mirrors GTM JS).
    const locationMap = new Map<string, { events: number; users: number }>();
    for (const row of pageRows) {
      const path = dim(row, 0);
      const host = dim(row, 1);
      const location = locationFromPagePath(path, host);
      const current = locationMap.get(location) ?? { events: 0, users: 0 };
      current.events += num(row, 0);
      // Sum users is a slight over-count because the same user can hit
      // multiple paths in the same location; acceptable for a directional
      // bar chart. If we ever need exact unique users per location we'd
      // need an extra GA4 call with cohort dim.
      current.users += num(row, 1);
      locationMap.set(location, current);
    }
    const byLocation: CtaLocationRow[] = [...locationMap.entries()]
      .map(([location, v]) => ({ location, events: v.events, users: v.users }))
      .sort((a, b) => b.events - a.events);

    // Top buttons. If the GA4 custom dimension hasn't propagated yet
    // (registered <24h ago), `customEvent:button_text` will be empty for
    // all rows — surface that to the UI via `dimensionsWarming`.
    let buttonsWithText = 0;
    const topButtons: CtaButtonRow[] = buttonRows
      .filter((row) => num(row, 0) > 0)
      .map((row) => {
        const buttonText = dim(row, 0).trim();
        const ctaLocation = dim(row, 1).trim();
        const path = dim(row, 2);
        const host = dim(row, 3);
        if (buttonText && buttonText !== "(not set)") buttonsWithText += 1;
        return {
          buttonText: buttonText || "(no text)",
          location:
            ctaLocation && ctaLocation !== "(not set)"
              ? ctaLocation
              : locationFromPagePath(path, host),
          events: num(row, 0),
          users: num(row, 1),
        };
      })
      .slice(0, 30);

    return {
      generatedAt: new Date().toISOString(),
      hostnameFilter,
      totals,
      byLocation,
      topButtons,
      daily,
      dimensionsWarming: topButtons.length > 0 && buttonsWithText === 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return emptyData(hostnameFilter, message);
  }
}

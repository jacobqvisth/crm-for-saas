import { addUtcDays, toIsoDate } from "@/lib/ceo/dates";
import { hasGoogleApiCredentials } from "@/lib/ceo/sync/google-auth";
import { runGa4Report, type Ga4Row } from "@/lib/ceo/sync/ga4-client";
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
// GTM-5JRQVHHS (workspace 7, version 6). Keep these in sync — if the GTM
// regex changes, update this and the test fixture.
export function locationFromPagePath(pagePath: string | null | undefined): string {
  const p = pagePath ?? "";
  const m = p.match(/^\/[a-z]{2,3}(\/.*)?$/);
  const rest = m ? (m[1] ?? "/") : p;
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

export async function getCtaClicksData(
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
        dimensions: [{ name: "pagePath" }],
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

    // Bucket pagePath → cta_location server-side (mirrors GTM JS).
    const locationMap = new Map<string, { events: number; users: number }>();
    for (const row of pageRows) {
      const path = dim(row, 0);
      const location = locationFromPagePath(path);
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
        if (buttonText && buttonText !== "(not set)") buttonsWithText += 1;
        return {
          buttonText: buttonText || "(no text)",
          location:
            ctaLocation && ctaLocation !== "(not set)"
              ? ctaLocation
              : locationFromPagePath(path),
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

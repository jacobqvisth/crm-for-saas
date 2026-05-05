import { addUtcDays, toIsoDate } from "@/lib/ceo/dates";
import { getEnv } from "@/lib/ceo/env";
import { createGoogleAuth } from "@/lib/ceo/sync/google-auth";
import { SyncSkippedError } from "../errors";
import type {
  MetricPoint,
  RawMetricRow,
  SourceConnector,
  SourceSyncWindow,
} from "../types";

type SearchConsoleSite = {
  siteUrl?: string;
  permissionLevel?: string;
};

type SearchConsoleSitesResponse = {
  siteEntry?: SearchConsoleSite[];
};

type SearchConsoleRow = {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
};

type SearchConsoleQueryResponse = {
  rows?: SearchConsoleRow[];
};

const SEARCH_CONSOLE_SCOPE =
  "https://www.googleapis.com/auth/webmasters.readonly";

function preferredSiteCandidates() {
  const explicit =
    getEnv("GOOGLE_SEARCH_CONSOLE_SITE_URL") ??
    getEnv("SEARCH_CONSOLE_SITE_URL");

  return [
    explicit,
    "sc-domain:wrenchlane.com",
    "https://www.wrenchlane.com/",
    "https://wrenchlane.com/",
    "http://www.wrenchlane.com/",
    "http://wrenchlane.com/",
  ].filter((value): value is string => Boolean(value));
}

async function fetchGoogleJson<T>(
  auth: Awaited<ReturnType<typeof createGoogleAuth>>,
  input: string,
  init?: RequestInit,
): Promise<T> {
  const authHeaders = await auth.getRequestHeaders();
  const headers = new Headers(init?.headers);

  if (authHeaders instanceof Headers) {
    authHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  } else {
    for (const [key, value] of Object.entries(authHeaders)) {
      if (typeof value === "string") {
        headers.set(key, value);
      }
    }
  }

  headers.set("accept", "application/json");
  if (init?.body) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Search Console API failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
    );
  }

  return (await response.json()) as T;
}

async function fetchSites(
  auth: Awaited<ReturnType<typeof createGoogleAuth>>,
): Promise<SearchConsoleSite[]> {
  const payload = await fetchGoogleJson<SearchConsoleSitesResponse>(
    auth,
    "https://www.googleapis.com/webmasters/v3/sites",
  );

  return (payload.siteEntry ?? []).filter(
    (site) =>
      typeof site.siteUrl === "string" &&
      site.siteUrl.length > 0 &&
      site.permissionLevel !== "siteUnverifiedUser",
  );
}

function resolveSiteUrl(sites: SearchConsoleSite[]) {
  const preferred = preferredSiteCandidates();

  for (const candidate of preferred) {
    const exact = sites.find((site) => site.siteUrl === candidate);
    if (exact?.siteUrl) {
      return exact.siteUrl;
    }
  }

  const fuzzy = sites.find((site) => site.siteUrl?.includes("wrenchlane.com"));
  if (fuzzy?.siteUrl) {
    return fuzzy.siteUrl;
  }

  if (sites.length === 1 && sites[0]?.siteUrl) {
    return sites[0].siteUrl;
  }

  throw new SyncSkippedError(
    `No Search Console property for WrenchLane was found. Available properties: ${sites
      .map((site) => site.siteUrl)
      .filter(Boolean)
      .slice(0, 8)
      .join(", ")}`,
  );
}

async function querySearchConsole(
  auth: Awaited<ReturnType<typeof createGoogleAuth>>,
  siteUrl: string,
  body: Record<string, unknown>,
): Promise<SearchConsoleRow[]> {
  const payload = await fetchGoogleJson<SearchConsoleQueryResponse>(
    auth,
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  return payload.rows ?? [];
}

async function fetchAllRows(
  auth: Awaited<ReturnType<typeof createGoogleAuth>>,
  siteUrl: string,
  body: Record<string, unknown>,
) {
  const rows: SearchConsoleRow[] = [];
  let startRow = 0;
  const rowLimit = Number(body.rowLimit ?? 25000);

  while (true) {
    const pageRows = await querySearchConsole(auth, siteUrl, {
      ...body,
      startRow,
      rowLimit,
    });

    rows.push(...pageRows);
    if (pageRows.length < rowLimit) {
      return rows;
    }

    startRow += rowLimit;
  }
}

function dateWindow(dateValue: string) {
  const periodStart = new Date(`${dateValue}T00:00:00.000Z`);
  return {
    periodStart,
    periodEnd: addUtcDays(periodStart, 1),
  };
}

function pushMetricBundle({
  metrics,
  sourceKey,
  periodStart,
  periodEnd,
  row,
  dimensions,
}: {
  metrics: MetricPoint[];
  sourceKey: "search_console";
  periodStart: Date;
  periodEnd: Date;
  row: SearchConsoleRow;
  dimensions?: Record<string, string>;
}) {
  const base = {
    sourceKey,
    periodStart,
    periodEnd,
    dimensions,
  } satisfies Partial<MetricPoint>;

  metrics.push(
    {
      ...base,
      metricKey: "organic_search_clicks",
      value: Number(row.clicks ?? 0),
    } as MetricPoint,
    {
      ...base,
      metricKey: "organic_search_impressions",
      value: Number(row.impressions ?? 0),
    } as MetricPoint,
    {
      ...base,
      metricKey: "organic_search_ctr",
      value: Number(row.ctr ?? 0) * 100,
      unit: "percent",
    } as MetricPoint,
    {
      ...base,
      metricKey: "organic_search_position",
      value: Number(row.position ?? 0),
      unit: "count",
    } as MetricPoint,
  );
}

function bundleRawRows(
  prefix: string,
  rows: SearchConsoleRow[],
  start: Date,
  end: Date,
  extras: Record<string, unknown>,
): RawMetricRow[] {
  return rows.map((row, index) => ({
    sourceKey: "search_console",
    externalId: `${prefix}:${index}:${(row.keys ?? []).join("|") || "total"}`,
    periodStart: start,
    periodEnd: end,
    payload: {
      ...extras,
      row,
    },
  }));
}

export const searchConsoleConnector: SourceConnector = {
  sourceKey: "search_console",
  async fetchMetrics(window: SourceSyncWindow) {
    const auth = await createGoogleAuth([SEARCH_CONSOLE_SCOPE]);
    const sites = await fetchSites(auth);
    if (sites.length === 0) {
      throw new SyncSkippedError(
        "Search Console access is configured, but no accessible properties were returned.",
      );
    }

    const siteUrl = resolveSiteUrl(sites);
    const startDate = toIsoDate(window.start);
    const endDate = toIsoDate(addUtcDays(window.end, -1));
    const metrics: MetricPoint[] = [];
    const rawRows: RawMetricRow[] = [];

    const [dailyRows, queryRows, pageRows, deviceRows, countryRows] =
      await Promise.all([
        fetchAllRows(auth, siteUrl, {
          startDate,
          endDate,
          dimensions: ["date"],
          type: "web",
          dataState: "all",
          rowLimit: 25000,
        }),
        fetchAllRows(auth, siteUrl, {
          startDate,
          endDate,
          dimensions: ["date", "query"],
          type: "web",
          dataState: "all",
          rowLimit: 25000,
        }),
        fetchAllRows(auth, siteUrl, {
          startDate,
          endDate,
          dimensions: ["date", "page"],
          type: "web",
          dataState: "all",
          rowLimit: 25000,
        }),
        fetchAllRows(auth, siteUrl, {
          startDate,
          endDate,
          dimensions: ["date", "device"],
          type: "web",
          dataState: "all",
          rowLimit: 25000,
        }),
        fetchAllRows(auth, siteUrl, {
          startDate,
          endDate,
          dimensions: ["date", "country"],
          type: "web",
          dataState: "all",
          rowLimit: 25000,
        }),
      ]);

    for (const row of dailyRows) {
      const dateValue = row.keys?.[0];
      if (!dateValue) continue;
      const { periodStart, periodEnd } = dateWindow(dateValue);
      pushMetricBundle({
        metrics,
        sourceKey: "search_console",
        periodStart,
        periodEnd,
        row,
      });
    }

    for (const row of queryRows) {
      const [dateValue, query] = row.keys ?? [];
      if (!dateValue || !query) continue;
      const { periodStart, periodEnd } = dateWindow(dateValue);
      pushMetricBundle({
        metrics,
        sourceKey: "search_console",
        periodStart,
        periodEnd,
        row,
        dimensions: { query },
      });
    }

    for (const row of pageRows) {
      const [dateValue, page] = row.keys ?? [];
      if (!dateValue || !page) continue;
      const { periodStart, periodEnd } = dateWindow(dateValue);
      pushMetricBundle({
        metrics,
        sourceKey: "search_console",
        periodStart,
        periodEnd,
        row,
        dimensions: { page },
      });
    }

    for (const row of deviceRows) {
      const [dateValue, device] = row.keys ?? [];
      if (!dateValue || !device) continue;
      const { periodStart, periodEnd } = dateWindow(dateValue);
      pushMetricBundle({
        metrics,
        sourceKey: "search_console",
        periodStart,
        periodEnd,
        row,
        dimensions: { device: device.toLowerCase() },
      });
    }

    for (const row of countryRows) {
      const [dateValue, country] = row.keys ?? [];
      if (!dateValue || !country) continue;
      const { periodStart, periodEnd } = dateWindow(dateValue);
      pushMetricBundle({
        metrics,
        sourceKey: "search_console",
        periodStart,
        periodEnd,
        row,
        dimensions: { country: country.toUpperCase() },
      });
    }

    rawRows.push(
      ...bundleRawRows("daily", dailyRows, window.start, window.end, {
        report: "date",
        siteUrl,
      }),
      ...bundleRawRows("query", queryRows, window.start, window.end, {
        report: "date_query",
        siteUrl,
      }),
      ...bundleRawRows("page", pageRows, window.start, window.end, {
        report: "date_page",
        siteUrl,
      }),
      ...bundleRawRows("device", deviceRows, window.start, window.end, {
        report: "date_device",
        siteUrl,
      }),
      ...bundleRawRows("country", countryRows, window.start, window.end, {
        report: "date_country",
        siteUrl,
      }),
    );

    return {
      sourceKey: "search_console",
      rowsRead:
        dailyRows.length +
        queryRows.length +
        pageRows.length +
        deviceRows.length +
        countryRows.length,
      metrics,
      rawRows,
      metadata: {
        siteUrl,
        startDate,
        endDate,
        reports: {
          daily: dailyRows.length,
          query: queryRows.length,
          page: pageRows.length,
          device: deviceRows.length,
          country: countryRows.length,
        },
      },
    };
  },
};

import { google } from "googleapis";
import { GA4_EVENT_MAP, FUNNEL_STEPS } from "@/config/ceo/kpi-events";
import { addUtcDays, parseGa4Date, toIsoDate } from "@/lib/ceo/dates";
import { getEnv } from "@/lib/ceo/env";
import { createGoogleAuth } from "@/lib/ceo/sync/google-auth";
import { requireSourceEnv } from "../errors";
import type { MetricPoint, SourceConnector, SourceSyncWindow } from "../types";

type Ga4Row = {
  dimensionValues?: { value?: string | null }[];
  metricValues?: { value?: string | null }[];
};

const EVENT_TO_METRIC = new Map<string, string>(
  Object.entries(GA4_EVENT_MAP).flatMap(([metricKey, eventNames]) =>
    eventNames.map((eventName) => [eventName, metricKey] as const),
  ),
);

function periodFromGa4Date(value: string) {
  const start = parseGa4Date(value);
  return { start, end: addUtcDays(start, 1) };
}

async function runReport(
  requestBody: Record<string, unknown>,
): Promise<Ga4Row[]> {
  const propertyId = getEnv("GA4_PROPERTY_ID")!;
  const auth = await createGoogleAuth([
    "https://www.googleapis.com/auth/analytics.readonly",
  ]);
  const analyticsData = google.analyticsdata({ version: "v1beta", auth });
  const response = await analyticsData.properties.runReport({
    property: `properties/${propertyId}`,
    requestBody,
  });

  return (response.data.rows ?? []) as Ga4Row[];
}

export const ga4Connector: SourceConnector = {
  sourceKey: "ga4",
  async fetchMetrics(window: SourceSyncWindow) {
    requireSourceEnv("GA4 / Firebase", ["GA4_PROPERTY_ID"]);

    const startDate = toIsoDate(window.start);
    const endDate = toIsoDate(addUtcDays(window.end, -1));
    const metrics: MetricPoint[] = [];
    let rowsRead = 0;

    const totalRows = await runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "date" }],
      metrics: [
        { name: "activeUsers" },
        { name: "newUsers" },
        { name: "sessions" },
      ],
      limit: "10000",
    });

    rowsRead += totalRows.length;
    for (const row of totalRows) {
      const date = row.dimensionValues?.[0]?.value;
      if (!date) continue;

      const period = periodFromGa4Date(date);
      metrics.push(
        {
          sourceKey: "ga4",
          metricKey: "active_users",
          periodStart: period.start,
          periodEnd: period.end,
          value: Number(row.metricValues?.[0]?.value ?? 0),
        },
        {
          sourceKey: "ga4",
          metricKey: "new_users",
          periodStart: period.start,
          periodEnd: period.end,
          value: Number(row.metricValues?.[1]?.value ?? 0),
        },
        {
          sourceKey: "ga4",
          metricKey: "sessions",
          periodStart: period.start,
          periodEnd: period.end,
          value: Number(row.metricValues?.[2]?.value ?? 0),
        },
      );
    }

    const platformRows = await runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "date" }, { name: "platform" }],
      metrics: [{ name: "activeUsers" }],
      limit: "10000",
    });

    rowsRead += platformRows.length;
    for (const row of platformRows) {
      const date = row.dimensionValues?.[0]?.value;
      const platform = row.dimensionValues?.[1]?.value ?? "unknown";
      if (!date) continue;

      const period = periodFromGa4Date(date);
      metrics.push({
        sourceKey: "ga4",
        metricKey: "active_users",
        periodStart: period.start,
        periodEnd: period.end,
        value: Number(row.metricValues?.[0]?.value ?? 0),
        dimensions: { platform: platform.toLowerCase() },
      });
    }

    const eventRows = await runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "date" }, { name: "eventName" }],
      metrics: [{ name: "eventCount" }],
      limit: "10000",
    });

    rowsRead += eventRows.length;
    for (const row of eventRows) {
      const date = row.dimensionValues?.[0]?.value;
      const eventName = row.dimensionValues?.[1]?.value ?? "";
      const metricKey = EVENT_TO_METRIC.get(eventName);
      if (!date || !metricKey) continue;

      const period = periodFromGa4Date(date);
      metrics.push({
        sourceKey: "ga4",
        metricKey,
        periodStart: period.start,
        periodEnd: period.end,
        value: Number(row.metricValues?.[0]?.value ?? 0),
        dimensions: { event_name: eventName },
      });
    }

    // Android first_open count, fixed 365-day lookback so the Android
    // downloads column on /dashboard/new-users self-heals across the
    // standard ranges (30d / 90d / all-time) on every hourly cron without
    // a separate backfill.
    //
    // Uses eventCount filtered to (streamName = WrenchLane - Android,
    // eventName = first_open) instead of the firstOpens metric: firstOpens
    // is only valid on properties whose schema includes app streams, and
    // this property's schema currently rejects it ("Field firstOpens is
    // not a valid metric"). eventCount works regardless and yields the
    // same per-user-per-app first_open semantics.
    const androidFirstOpenStartDate = toIsoDate(addUtcDays(window.end, -365));
    const androidFirstOpenRows = await runReport({
      dateRanges: [{ startDate: androidFirstOpenStartDate, endDate }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: "streamName",
                stringFilter: {
                  matchType: "EXACT",
                  value: "WrenchLane - Android",
                },
              },
            },
            {
              filter: {
                fieldName: "eventName",
                stringFilter: { matchType: "EXACT", value: "first_open" },
              },
            },
          ],
        },
      },
      limit: "10000",
    });

    rowsRead += androidFirstOpenRows.length;
    for (const row of androidFirstOpenRows) {
      const date = row.dimensionValues?.[0]?.value;
      if (!date) continue;

      const period = periodFromGa4Date(date);
      metrics.push({
        sourceKey: "ga4",
        metricKey: "android_first_opens",
        periodStart: period.start,
        periodEnd: period.end,
        value: Number(row.metricValues?.[0]?.value ?? 0),
      });
    }

    // Web app first-time visitors on app.wrenchlane.com. Symmetric to the
    // Android first_open count above, but for the web stream — uses
    // eventCount filtered to (streamName = Website and web app,
    // hostName = app.wrenchlane.com, eventName = first_visit). 365-day
    // lookback so the column self-heals across all ranges on every
    // hourly cron.
    //
    // Why both streamName AND hostName: Capacitor wraps the iOS / Android
    // apps with a webview that can hit app.wrenchlane.com. Filtering on
    // hostName alone would include those in-app webview first-visits and
    // overcount the "web" surface. Filtering on streamName alone is
    // brittle if the marketing site is ever attached to the same web
    // stream. The intersection is the honest web-only signal.
    //
    // Caveat: GA4 web "first_visit" is keyed on browser cookie, so
    // cookie-clearing or device-switching inflates this slightly. Same
    // tradeoff as the Android column.
    const webFirstVisitStartDate = toIsoDate(addUtcDays(window.end, -365));
    const webFirstVisitRows = await runReport({
      dateRanges: [{ startDate: webFirstVisitStartDate, endDate }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: "streamName",
                stringFilter: {
                  matchType: "EXACT",
                  value: "Website and web app",
                },
              },
            },
            {
              filter: {
                fieldName: "hostName",
                stringFilter: {
                  matchType: "EXACT",
                  value: "app.wrenchlane.com",
                },
              },
            },
            {
              filter: {
                fieldName: "eventName",
                stringFilter: { matchType: "EXACT", value: "first_visit" },
              },
            },
          ],
        },
      },
      limit: "10000",
    });

    rowsRead += webFirstVisitRows.length;
    for (const row of webFirstVisitRows) {
      const date = row.dimensionValues?.[0]?.value;
      if (!date) continue;

      const period = periodFromGa4Date(date);
      metrics.push({
        sourceKey: "ga4",
        metricKey: "app_first_visits",
        periodStart: period.start,
        periodEnd: period.end,
        value: Number(row.metricValues?.[0]?.value ?? 0),
      });
    }

    return {
      sourceKey: "ga4",
      rowsRead,
      metrics,
      funnel: FUNNEL_STEPS.filter((step) => step.sourceKey === "ga4").map(
        (step) => ({
          sourceKey: "ga4",
          stepKey: step.key,
          periodStart: window.start,
          periodEnd: window.end,
          count: metrics
            .filter((metric) => metric.metricKey === step.metricKey)
            .reduce((sum, metric) => sum + metric.value, 0),
        }),
      ),
      metadata: { startDate, endDate },
    };
  },
};

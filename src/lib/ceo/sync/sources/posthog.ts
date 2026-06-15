// PostHog product-analytics connector for the CEO dashboard.
//
// codeoc (app.wrenchlane.com) already ships posthog-js + a backend Python SDK
// that send events to PostHog Cloud EU. Both call identify() with the Cognito
// `sub` as distinct_id, so a PostHog person maps 1:1 to a CRM contact
// (contacts.wl_user_id = Cognito sub). That makes PostHog the cleanest source
// of in-app engagement (active users, pageviews, sessions, custom product
// events) to sit alongside GA4 + core_app on the dashboard.
//
// We pull pre-aggregated daily metrics through the HogQL Query API
// (POST /api/projects/{id}/query/) rather than batch-exporting raw events —
// it matches the existing MetricPoint pattern and the hourly rolling-window
// sync exactly, and stays well under the 2,400 req/hour query limit.
//
// Config (all read at sync time; the source cleanly SKIPS when unset):
//   POSTHOG_API_KEY        personal API key with the "Query Read" scope
//   POSTHOG_PROJECT_ID     numeric project id (Project settings → General)
//   POSTHOG_API_HOST       optional, defaults to https://eu.posthog.com
//   POSTHOG_TRACKED_EVENTS optional comma-separated event names to break out
//                          per-day (e.g. "diagnostic_started,chat_opened")
import { addUtcDays } from "@/lib/ceo/dates";
import { getEnv } from "@/lib/ceo/env";
import { requireSourceEnv } from "../errors";
import type {
  MetricPoint,
  RawMetricRow,
  SourceConnector,
  SourceSyncWindow,
} from "../types";

const DEFAULT_POSTHOG_HOST = "https://eu.posthog.com";

// One HogQL query yields every overview metric per day. Column order here MUST
// match the SELECT list in buildOverviewQuery(). Keeping them together keeps
// the parser and the query in lockstep.
type OverviewColumn = {
  alias: string;
  metricKey: string;
  unit?: MetricPoint["unit"];
};

export const OVERVIEW_COLUMNS: OverviewColumn[] = [
  { alias: "events", metricKey: "posthog_events" },
  { alias: "active_users", metricKey: "posthog_active_users" },
  { alias: "pageviews", metricKey: "posthog_pageviews" },
  { alias: "sessions", metricKey: "posthog_sessions" },
];

type QueryResponse = {
  results?: Array<Array<string | number | null>>;
  columns?: string[];
  error?: string;
  detail?: string;
};

export function getPostHogApiHost(): string {
  return (getEnv("POSTHOG_API_HOST") ?? DEFAULT_POSTHOG_HOST).replace(/\/+$/, "");
}

// HogQL's toDateTime() wants 'YYYY-MM-DD HH:MM:SS' (no trailing Z / fractional
// seconds). The window is always UTC-aligned (getRollingWindow), so we read the
// UTC wall-clock straight off the ISO string.
export function formatHogqlDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function escapeHogqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function getTrackedEvents(): string[] {
  return (getEnv("POSTHOG_TRACKED_EVENTS") ?? "")
    .split(",")
    .map((event) => event.trim())
    .filter(Boolean);
}

export function buildOverviewQuery(window: SourceSyncWindow): string {
  const start = formatHogqlDateTime(window.start);
  const end = formatHogqlDateTime(window.end);

  return [
    "SELECT",
    "  toDate(timestamp) AS day,",
    "  count() AS events,",
    "  count(DISTINCT person_id) AS active_users,",
    "  countIf(event = '$pageview') AS pageviews,",
    "  count(DISTINCT properties.$session_id) AS sessions",
    "FROM events",
    `WHERE timestamp >= toDateTime('${start}') AND timestamp < toDateTime('${end}')`,
    "GROUP BY day",
    "ORDER BY day",
  ].join("\n");
}

export function buildTrackedEventsQuery(
  window: SourceSyncWindow,
  events: string[],
): string {
  const start = formatHogqlDateTime(window.start);
  const end = formatHogqlDateTime(window.end);
  const inList = events
    .map((event) => `'${escapeHogqlString(event)}'`)
    .join(", ");

  return [
    "SELECT",
    "  toDate(timestamp) AS day,",
    "  event AS event,",
    "  count() AS occurrences,",
    "  count(DISTINCT person_id) AS users",
    "FROM events",
    `WHERE timestamp >= toDateTime('${start}') AND timestamp < toDateTime('${end}')`,
    `  AND event IN (${inList})`,
    "GROUP BY day, event",
    "ORDER BY day, event",
  ].join("\n");
}

function dayToPeriod(day: unknown, fallback: Date): { start: Date; end: Date } {
  const value = typeof day === "string" ? day : "";
  const start = value
    ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
    : fallback;
  return { start, end: addUtcDays(start, 1) };
}

function toNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

async function runHogqlQuery(query: string): Promise<QueryResponse> {
  const host = getPostHogApiHost();
  const projectId = getEnv("POSTHOG_PROJECT_ID")!;
  const apiKey = getEnv("POSTHOG_API_KEY")!;

  const response = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });

  const payload = (await response.json().catch(() => null)) as
    | QueryResponse
    | null;

  if (!response.ok) {
    const detail =
      payload?.detail ?? payload?.error ?? `HTTP ${response.status}`;
    throw new Error(`PostHog query failed (${response.status}): ${detail}`);
  }

  return payload ?? {};
}

export const posthogConnector: SourceConnector = {
  sourceKey: "posthog",
  async fetchMetrics(window: SourceSyncWindow) {
    requireSourceEnv("PostHog", ["POSTHOG_API_KEY", "POSTHOG_PROJECT_ID"]);

    const metrics: MetricPoint[] = [];
    const rawRows: RawMetricRow[] = [];

    // 1) Daily overview: events, active users, pageviews, sessions.
    const overview = await runHogqlQuery(buildOverviewQuery(window));
    const overviewRows = overview.results ?? [];

    for (const row of overviewRows) {
      const [day, ...values] = row;
      const { start, end } = dayToPeriod(day, window.start);

      OVERVIEW_COLUMNS.forEach((column, index) => {
        metrics.push({
          sourceKey: "posthog",
          metricKey: column.metricKey,
          periodStart: start,
          periodEnd: end,
          value: toNumber(values[index]),
          unit: column.unit,
        });
      });

      rawRows.push({
        sourceKey: "posthog",
        externalId: `overview:${typeof day === "string" ? day : start.toISOString().slice(0, 10)}`,
        periodStart: start,
        periodEnd: end,
        payload: {
          events: toNumber(values[0]),
          active_users: toNumber(values[1]),
          pageviews: toNumber(values[2]),
          sessions: toNumber(values[3]),
        },
      });
    }

    // 2) Optional per-event breakout for product events worth surfacing.
    const trackedEvents = getTrackedEvents();
    if (trackedEvents.length > 0) {
      const tracked = await runHogqlQuery(
        buildTrackedEventsQuery(window, trackedEvents),
      );

      for (const row of tracked.results ?? []) {
        const [day, event, occurrences, users] = row;
        const { start, end } = dayToPeriod(day, window.start);
        const eventName = typeof event === "string" ? event : "unknown";

        metrics.push({
          sourceKey: "posthog",
          metricKey: "posthog_event_occurrences",
          periodStart: start,
          periodEnd: end,
          value: toNumber(occurrences),
          dimensions: { event: eventName },
        });
        metrics.push({
          sourceKey: "posthog",
          metricKey: "posthog_event_users",
          periodStart: start,
          periodEnd: end,
          value: toNumber(users),
          dimensions: { event: eventName },
        });
      }
    }

    return {
      sourceKey: "posthog",
      rowsRead: overviewRows.length,
      metrics,
      rawRows,
      metadata: {
        host: getPostHogApiHost(),
        projectId: getEnv("POSTHOG_PROJECT_ID") ?? null,
        trackedEvents,
      },
    };
  },
};

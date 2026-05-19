// Daily aggregator: pulls cta_click event rollups from GA4 and upserts
// per-day rows into dashboard_cta_clicks. Idempotent on
// (date, host_name, page_path, button_text, cta_location) so re-running
// over the same window just refreshes the rows.
//
// Called from /api/cron/sync-cta-clicks (Vercel cron at 06:30 UTC) and
// from a manual one-off backfill if the table is cold.

import { runGa4Report, type Ga4Row } from "@/lib/ceo/sync/ga4-client";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";

export type CtaClicksSyncResult = {
  rowsFetched: number;
  rowsUpserted: number;
  rangeStart: string;
  rangeEnd: string;
  ok: boolean;
  error?: string;
};

type CtaClickUpsertRow = {
  date: string;
  host_name: string;
  page_path: string;
  button_text: string;
  cta_location: string;
  events: number;
  users: number;
  synced_at: string;
};

function ga4DateToIso(value: string) {
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

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysAgoIso(days: number, now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return isoDate(d);
}

function todayIso(now = new Date()) {
  return isoDate(now);
}

/**
 * Fetch GA4 cta_click rollups for the window and upsert into Supabase.
 * Default window: last 7 days + today, so each cron run refreshes the
 * last week (GA4 events can land late; same-day data continues to
 * accrue throughout the day).
 */
export async function syncCtaClicks(options: {
  windowDays?: number;
  now?: Date;
} = {}): Promise<CtaClicksSyncResult> {
  const windowDays = options.windowDays ?? 7;
  const now = options.now ?? new Date();
  const rangeStart = daysAgoIso(windowDays, now);
  const rangeEnd = todayIso(now);

  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return {
      rowsFetched: 0,
      rowsUpserted: 0,
      rangeStart,
      rangeEnd,
      ok: false,
      error: "Supabase service-role credentials not configured.",
    };
  }

  let rows: Ga4Row[];
  try {
    rows = await runGa4Report({
      dateRanges: [{ startDate: rangeStart, endDate: rangeEnd }],
      dimensions: [
        { name: "date" },
        { name: "hostName" },
        { name: "pagePath" },
        { name: "customEvent:button_text" },
        { name: "customEvent:cta_location" },
      ],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          stringFilter: { matchType: "EXACT", value: "cta_click" },
        },
      },
      limit: "100000",
    });
  } catch (error) {
    return {
      rowsFetched: 0,
      rowsUpserted: 0,
      rangeStart,
      rangeEnd,
      ok: false,
      error:
        error instanceof Error ? error.message : `GA4 fetch failed: ${error}`,
    };
  }

  const syncedAt = new Date().toISOString();
  // Dedupe in JS before upsert — GA4 won't return duplicate compound
  // keys today, but the upsert key is wide enough to be defensive.
  const byKey = new Map<string, CtaClickUpsertRow>();
  for (const row of rows) {
    const dateRaw = dim(row, 0);
    if (!dateRaw) continue;
    const date = ga4DateToIso(dateRaw);
    const host_name = dim(row, 1) || "";
    const page_path = dim(row, 2) || "";
    let button_text = dim(row, 3) || "";
    let cta_location = dim(row, 4) || "";
    // Normalize GA4's "(not set)" sentinel to empty string so the upsert
    // key stays stable across the warming-up window.
    if (button_text === "(not set)") button_text = "";
    if (cta_location === "(not set)") cta_location = "";
    const key = `${date}|${host_name}|${page_path}|${button_text}|${cta_location}`;
    byKey.set(key, {
      date,
      host_name,
      page_path,
      button_text,
      cta_location,
      events: num(row, 0),
      users: num(row, 1),
      synced_at: syncedAt,
    });
  }

  const upsertRows = [...byKey.values()];
  if (upsertRows.length === 0) {
    return {
      rowsFetched: rows.length,
      rowsUpserted: 0,
      rangeStart,
      rangeEnd,
      ok: true,
    };
  }

  // Chunk upserts to stay well under PostgREST's payload limit. 500 rows
  // per chunk is plenty for the daily volume (~7 days × 2 hosts × ~30
  // distinct slices ≈ 400 rows total).
  const CHUNK = 500;
  let rowsUpserted = 0;
  for (let i = 0; i < upsertRows.length; i += CHUNK) {
    const slice = upsertRows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from(TABLES.ctaClicks)
      .upsert(slice, {
        onConflict: "date,host_name,page_path,button_text,cta_location",
      });
    if (error) {
      return {
        rowsFetched: rows.length,
        rowsUpserted,
        rangeStart,
        rangeEnd,
        ok: false,
        error: error.message,
      };
    }
    rowsUpserted += slice.length;
  }

  return {
    rowsFetched: rows.length,
    rowsUpserted,
    rangeStart,
    rangeEnd,
    ok: true,
  };
}

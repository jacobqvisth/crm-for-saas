import { unstable_cache } from "next/cache";
import { hasSupabaseConfig } from "@/lib/ceo/env";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";

export const getCoreAppLastSyncedAt = unstable_cache(
  getCoreAppLastSyncedAtUncached,
  ["ceo-core-app-last-synced"],
  CEO_CACHE_OPTIONS,
);

/**
 * Reads the stamp the sync runner maintains on `dashboard_source_accounts`
 * (one row per source), rather than deriving it from the raw-rows table.
 *
 * The previous implementation ordered `dashboard_raw_metric_rows` by
 * collected_at with a LIKE filter on external_id. There is no index supporting
 * that, so Postgres index-scanned every core_app row and top-N sorted 48,876 of
 * them: EXPLAIN ANALYZE measured **30.2 seconds** against PostgREST's 8s
 * statement_timeout. It therefore never returned, `data` was always undefined,
 * and every dashboard header rendered "Last updated never" — including while
 * the sync was demonstrably healthy.
 *
 * `dashboard_source_accounts` is a handful of rows and is upserted with
 * last_success_at on every successful run, so this is a single-row primary-key
 * lookup for the same fact.
 */
async function getCoreAppLastSyncedAtUncached(): Promise<string | null> {
  if (!hasSupabaseConfig()) return null;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from(TABLES.sourceAccounts)
    .select("last_success_at")
    .eq("source_key", "core_app")
    .maybeSingle();

  return (data?.last_success_at as string | undefined) ?? null;
}

export function formatStockholmTime(iso: string | null): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "never";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

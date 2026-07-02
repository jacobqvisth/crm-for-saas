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

async function getCoreAppLastSyncedAtUncached(): Promise<string | null> {
  if (!hasSupabaseConfig()) return null;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from(TABLES.rawMetricRows)
    .select("collected_at")
    .eq("source_key", "core_app")
    .like("external_id", "user_stats:%")
    .order("collected_at", { ascending: false })
    .limit(1);

  return (data?.[0]?.collected_at as string | undefined) ?? null;
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

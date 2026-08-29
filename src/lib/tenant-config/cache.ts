import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { ConfigCache } from "./resolve";
import type { FeatureFlags } from "@/config/features";

// Layer 2: the last good config, cached in the TENANT'S OWN database.
//
// In the tenant's database rather than in memory because the failure this
// guards against is a cold start during a control-plane outage: a fresh
// serverless instance has no memory to fall back on, and would otherwise drop
// straight to compiled defaults and silently ignore every override an
// administrator had set.
//
// One row, id = 1. There is exactly one tenant per database, so a table with a
// tenant column here would be inventing a dimension that does not exist.

const CACHE_TABLE = "tenant_config_cache";

export function databaseConfigCache(): ConfigCache | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const db = createClient(url, key, { auth: { persistSession: false } });

  return {
    async read() {
      const { data, error } = await db
        .from(CACHE_TABLE)
        .select("features, settings, fetched_at")
        .eq("id", 1)
        .maybeSingle();
      // A missing table is not an error worth escalating: it means the
      // migration has not run yet, and compiled defaults are the right answer.
      if (error || !data) return null;
      return {
        features: data.features,
        settings: data.settings,
        fetchedAt: data.fetched_at as string,
      };
    },

    async write(v: { features: FeatureFlags; settings: Record<string, unknown> }) {
      await db.from(CACHE_TABLE).upsert(
        {
          id: 1,
          features: v.features,
          settings: v.settings,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    },
  };
}

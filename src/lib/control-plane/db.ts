import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FEATURES, type FeatureKey } from "@/config/features";
import { isStale, sinceText } from "./stats";

// The control-plane database client, and the queries the console runs.
//
// These credentials point at the CONTROL-PLANE Supabase project, which holds no
// customer data. They are separate environment variables from the tenant app's
// NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY precisely so that the
// two can never be confused: a control-plane deployment that accidentally read
// the tenant variables would be pointing the console at a customer's CRM.

export function controlPlaneClient(): SupabaseClient | null {
  const url = process.env.CONTROL_PLANE_SUPABASE_URL;
  const key = process.env.CONTROL_PLANE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export type TenantStatus = "active" | "suspended" | "provisioning";
export type ReleaseChannel = "main" | "stable";

export interface TenantRow {
  id: string;
  slug: string;
  display_name: string;
  status: TenantStatus;
  release_channel: ReleaseChannel;
  supabase_project_ref: string | null;
  app_url: string | null;
  notes: string | null;
  created_at: string;
  /** Last heartbeat. Null means it has never reported, normal while provisioning. */
  last_seen_at: string | null;
}

export interface OverrideRow {
  tenant_id: string;
  feature_key: string;
  enabled: boolean;
  note: string | null;
  updated_at: string;
  updated_by: string;
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  tenant_id: string | null;
  action: string;
  before: unknown;
  after: unknown;
}

/**
 * The value a feature actually has for a tenant, and whether anyone chose it.
 *
 * `source` is the field that matters in the UI. A toggle that shows only the
 * effective value hides the difference between "Jacob turned this off for
 * Animech" and "this is off because the default changed", and silent
 * inheritance is how you take a feature away from a paying customer by
 * accident.
 */
export interface EffectiveFlag {
  key: FeatureKey;
  name: string;
  category: string;
  description: string;
  enabled: boolean;
  source: "override" | "default";
  defaultEnabled: boolean;
  note: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function resolveEffectiveFlags(
  overrides: OverrideRow[],
  tenantId: string,
): EffectiveFlag[] {
  const byKey = new Map(
    overrides.filter((o) => o.tenant_id === tenantId).map((o) => [o.feature_key, o]),
  );

  return FEATURES.map((f) => {
    const o = byKey.get(f.key);
    return {
      key: f.key,
      name: f.name,
      category: f.category,
      description: f.description,
      // An absent row means "inherit", which keeps a newly added feature on for
      // everyone without a backfill.
      enabled: o ? o.enabled : f.enabledByDefault,
      source: o ? ("override" as const) : ("default" as const),
      defaultEnabled: f.enabledByDefault,
      note: o?.note ?? null,
      updatedAt: o?.updated_at ?? null,
      updatedBy: o?.updated_by ?? null,
    };
  });
}

export async function listTenants(db: SupabaseClient): Promise<TenantRow[]> {
  const { data, error } = await db.from("tenants").select("*").order("created_at");
  if (error) throw new Error(`control plane: listing tenants failed: ${error.message}`);
  return (data ?? []) as TenantRow[];
}

export interface StatsRow {
  tenant_id: string;
  day: string;
  reported_at: string;
  metrics: Record<string, number>;
}

/**
 * The most recent report from each tenant.
 *
 * Deliberately tolerant: a control plane whose console 500s because the stats
 * table is missing or empty is worse than one that shows no numbers. This
 * returns an empty map on any failure, and every caller must render without it.
 */
export async function latestStats(db: SupabaseClient): Promise<Map<string, StatsRow>> {
  const { data, error } = await db
    .from("tenant_stats")
    .select("tenant_id, day, reported_at, metrics")
    .order("day", { ascending: false });
  if (error || !data) return new Map();

  const out = new Map<string, StatsRow>();
  for (const row of data as StatsRow[]) {
    // Ordered newest first, so the first row seen for a tenant is its latest.
    if (!out.has(row.tenant_id)) out.set(row.tenant_id, row);
  }
  return out;
}

export interface TenantOverview {
  tenant: TenantRow;
  stats: StatsRow | null;
  seenText: string | null;
  stale: boolean;
}

/**
 * Tenants with their latest report, ready to render.
 *
 * The clock is read HERE, once for the whole page, rather than in the console.
 * `Date.now()` during render is impure — React's purity rule rejects it, and a
 * relative time computed on the server and again on the client is a hydration
 * mismatch. This is a data-layer function, so it is the right place for it.
 */
export async function tenantOverview(db: SupabaseClient): Promise<TenantOverview[]> {
  const [tenants, stats] = await Promise.all([listTenants(db), latestStats(db)]);
  const now = Date.now();
  return tenants.map((t) => ({
    tenant: t,
    stats: stats.get(t.id) ?? null,
    seenText: sinceText(t.last_seen_at, now),
    stale: isStale(t.last_seen_at, now),
  }));
}

export async function listOverrides(db: SupabaseClient): Promise<OverrideRow[]> {
  const { data, error } = await db.from("tenant_features").select("*");
  if (error) throw new Error(`control plane: listing overrides failed: ${error.message}`);
  return (data ?? []) as OverrideRow[];
}

export async function recentAudit(db: SupabaseClient, limit = 50): Promise<AuditRow[]> {
  const { data, error } = await db
    .from("audit_log")
    .select("*")
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`control plane: reading audit log failed: ${error.message}`);
  return (data ?? []) as AuditRow[];
}

/**
 * Append to the audit log.
 *
 * Deliberately NOT wrapped in a try/catch by callers: if the audit write fails,
 * the change should fail with it. An unlogged change to a paying customer's
 * features is worse than a change that did not happen.
 */
export async function writeAudit(
  db: SupabaseClient,
  entry: {
    actor: string;
    tenantId: string | null;
    action: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  const { error } = await db.from("audit_log").insert({
    actor: entry.actor,
    tenant_id: entry.tenantId,
    action: entry.action,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
  if (error) throw new Error(`control plane: audit write failed: ${error.message}`);
}

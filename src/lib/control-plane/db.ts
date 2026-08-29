import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FEATURES, type FeatureKey } from "@/config/features";

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

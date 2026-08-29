"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { FEATURE_KEYS, type FeatureKey } from "@/config/features";
import { isAuthFailure, requireSuperAdmin } from "@/lib/control-plane/auth";
import { controlPlaneClient, writeAudit } from "@/lib/control-plane/db";

// Every write the console can make.
//
// Each one re-checks authorisation itself. Server actions are reachable by
// direct POST and do NOT necessarily pass through middleware, so the middleware
// gate is a convenience and this is the boundary.
//
// Each one also writes an audit row, and does so WITHOUT swallowing failures:
// if the audit write fails the whole action fails. An unlogged change to a
// paying customer's features is worse than a change that did not happen.

export type ActionResult = { ok: true } | { ok: false; error: string };

async function authorized() {
  const admin = await requireSuperAdmin();
  if (isAuthFailure(admin)) return { admin: null, error: admin.error };
  const db = controlPlaneClient();
  if (!db) return { admin: null, error: "Control plane database is not configured." };
  return { admin, db, error: null as string | null };
}

function isFeatureKey(v: string): v is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(v);
}

/**
 * Turn a feature on or off for one tenant.
 *
 * Turning something OFF requires a note. Off is the destructive direction: it
 * removes a surface a customer may be using, and six months later "why does
 * Animech not have forums" needs an answer better than a timestamp.
 */
export async function setTenantFeature(input: {
  tenantId: string;
  featureKey: string;
  enabled: boolean;
  note?: string;
}): Promise<ActionResult> {
  const ctx = await authorized();
  if (!ctx.admin || !ctx.db) return { ok: false, error: ctx.error ?? "Not authorized." };

  if (!isFeatureKey(input.featureKey)) {
    return { ok: false, error: `Unknown feature "${input.featureKey}".` };
  }
  const note = input.note?.trim() || null;
  if (!input.enabled && !note) {
    return { ok: false, error: "Turning a feature off requires a note explaining why." };
  }

  const { data: before } = await ctx.db
    .from("tenant_features")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("feature_key", input.featureKey)
    .maybeSingle();

  const { error } = await ctx.db.from("tenant_features").upsert(
    {
      tenant_id: input.tenantId,
      feature_key: input.featureKey,
      enabled: input.enabled,
      note,
      updated_at: new Date().toISOString(),
      updated_by: ctx.admin.email,
    },
    { onConflict: "tenant_id,feature_key" },
  );
  if (error) return { ok: false, error: error.message };

  await writeAudit(ctx.db, {
    actor: ctx.admin.email,
    tenantId: input.tenantId,
    action: input.enabled ? "feature.enable" : "feature.disable",
    before: before ?? null,
    after: { feature_key: input.featureKey, enabled: input.enabled, note },
  });

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Drop an override so the feature follows its registry default again.
 *
 * Distinct from "set it to the same value as the default": an override that
 * happens to match today would silently diverge the day the default changes.
 */
export async function clearTenantFeature(input: {
  tenantId: string;
  featureKey: string;
}): Promise<ActionResult> {
  const ctx = await authorized();
  if (!ctx.admin || !ctx.db) return { ok: false, error: ctx.error ?? "Not authorized." };
  if (!isFeatureKey(input.featureKey)) {
    return { ok: false, error: `Unknown feature "${input.featureKey}".` };
  }

  const { data: before } = await ctx.db
    .from("tenant_features")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("feature_key", input.featureKey)
    .maybeSingle();

  const { error } = await ctx.db
    .from("tenant_features")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("feature_key", input.featureKey);
  if (error) return { ok: false, error: error.message };

  await writeAudit(ctx.db, {
    actor: ctx.admin.email,
    tenantId: input.tenantId,
    action: "feature.inherit",
    before: before ?? null,
    after: null,
  });

  revalidatePath("/admin");
  return { ok: true };
}

/**
 * Mint a config-pull token for a tenant, revoking any previous one.
 *
 * The plaintext is returned ONCE and never stored; only its SHA-256 goes to the
 * database. A read of `tenant_tokens` therefore does not let anyone impersonate
 * a tenant.
 */
export async function rotateTenantToken(input: {
  tenantId: string;
}): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const ctx = await authorized();
  if (!ctx.admin || !ctx.db) return { ok: false, error: ctx.error ?? "Not authorized." };

  const token = `cpt_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(token).digest("hex");

  const { error: revokeError } = await ctx.db
    .from("tenant_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", input.tenantId)
    .is("revoked_at", null);
  if (revokeError) return { ok: false, error: revokeError.message };

  const { error } = await ctx.db.from("tenant_tokens").insert({
    tenant_id: input.tenantId,
    token_hash: hash,
    created_by: ctx.admin.email,
  });
  if (error) return { ok: false, error: error.message };

  // The token itself is never audited, only the fact of rotation.
  await writeAudit(ctx.db, {
    actor: ctx.admin.email,
    tenantId: input.tenantId,
    action: "token.rotate",
    before: null,
    after: { hash_prefix: hash.slice(0, 8) },
  });

  revalidatePath("/admin");
  return { ok: true, token };
}

/** Change a tenant's status or the branch its deployment tracks. */
export async function updateTenant(input: {
  tenantId: string;
  status?: "active" | "suspended" | "provisioning";
  releaseChannel?: "main" | "stable";
  notes?: string;
}): Promise<ActionResult> {
  const ctx = await authorized();
  if (!ctx.admin || !ctx.db) return { ok: false, error: ctx.error ?? "Not authorized." };

  const { data: before } = await ctx.db
    .from("tenants")
    .select("*")
    .eq("id", input.tenantId)
    .maybeSingle();

  const patch: Record<string, unknown> = {};
  if (input.status) patch.status = input.status;
  // NOTE: this records which branch the tenant's Vercel project is expected to
  // build. It does NOT move any code. Promotion is `git push origin main:stable`
  // and nothing here should ever imply otherwise.
  if (input.releaseChannel) patch.release_channel = input.releaseChannel;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await ctx.db.from("tenants").update(patch).eq("id", input.tenantId);
  if (error) return { ok: false, error: error.message };

  await writeAudit(ctx.db, {
    actor: ctx.admin.email,
    tenantId: input.tenantId,
    action: "tenant.update",
    before: before ?? null,
    after: patch,
  });

  revalidatePath("/admin");
  return { ok: true };
}

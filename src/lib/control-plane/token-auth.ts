import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// How a tenant proves it is itself, for every endpoint the control plane
// exposes to tenants.
//
// Extracted so there is ONE implementation. Two endpoints now authenticate this
// way, and a second hand-rolled copy of "hash the bearer token and look it up"
// is how one of them ends up subtly weaker than the other.
//
// THE TOKEN IDENTIFIES THE TENANT. No endpoint takes a tenant id from the
// caller, because a caller-supplied id is a caller-controlled id and the whole
// design rests on a tenant being unable to touch another tenant's row.

/** Hash comparison that does not leak the answer through timing. */
function hashMatches(presented: string, storedHex: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  let b: Buffer;
  try {
    b = Buffer.from(storedHex, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function bearerToken(header: string | null): string {
  const h = header ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

export interface TenantAuth {
  tenantId: string;
  tokenId: string;
}

/**
 * Resolve the tenant a bearer token belongs to.
 *
 * Returns null for every failure — absent, unknown, revoked — because
 * distinguishing them tells a prober which of those they achieved.
 */
export async function authenticateTenant(
  db: SupabaseClient,
  token: string,
): Promise<TenantAuth | null> {
  if (!token) return null;

  const presentedHash = createHash("sha256").update(token).digest("hex");
  const { data: row, error } = await db
    .from("tenant_tokens")
    .select("id, tenant_id, token_hash, revoked_at")
    .eq("token_hash", presentedHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !row) return null;
  // The equality above is already an exact index match; the constant-time
  // compare is belt and braces for the day this becomes a scan.
  if (!hashMatches(token, row.token_hash)) return null;

  return { tenantId: row.tenant_id, tokenId: row.id };
}

/** Best effort: a failed last_used_at write must never fail the request. */
export function touchToken(db: SupabaseClient, tokenId: string): void {
  void db
    .from("tenant_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tokenId)
    .then(undefined, () => {});
}

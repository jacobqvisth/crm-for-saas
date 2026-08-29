import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { FEATURES } from "@/config/features";
import { isControlPlane } from "@/lib/control-plane/auth";
import { controlPlaneClient } from "@/lib/control-plane/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The endpoint tenants pull their own config from.
//
// This is the only door the control plane opens to the outside, so its rules
// are narrow on purpose:
//
//   - THE TOKEN IDENTIFIES THE TENANT. There is no tenant id in the request,
//     because a caller-supplied id is a caller-controlled id, and the whole
//     design rests on a tenant being unable to read another tenant's row.
//   - Only that tenant's flags and settings come back. Never the tenant list,
//     never another tenant's anything.
//   - No secrets are ever returned. The response is feature booleans and
//     non-sensitive settings, which is all the control plane holds anyway.
//
// It is deliberately boring. The interesting failure modes live on the calling
// side, where a tenant must survive this endpoint being slow, wrong or gone.

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

function unauthorized() {
  // Deliberately identical for "no token", "unknown token" and "revoked
  // token". Distinguishing them tells a prober which of those they achieved.
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  // Only the control-plane deployment answers this. A tenant deployment
  // serving it would be confusing at best and a second, unaudited source of
  // config at worst.
  if (!isControlPlane()) {
    return new NextResponse(null, { status: 404 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return unauthorized();

  const db = controlPlaneClient();
  if (!db) {
    return NextResponse.json({ error: "Control plane not configured" }, { status: 500 });
  }

  // Look the token up by its hash. Only live tokens (never revoked) count.
  const presentedHash = createHash("sha256").update(token).digest("hex");
  const { data: row, error } = await db
    .from("tenant_tokens")
    .select("id, tenant_id, token_hash, revoked_at")
    .eq("token_hash", presentedHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
  // The equality above is already an exact index match; the constant-time
  // compare is belt and braces for the day this becomes a scan.
  if (!row || !hashMatches(token, row.token_hash)) {
    console.warn("[control-plane/config] rejected token", {
      prefix: presentedHash.slice(0, 8),
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
    });
    return unauthorized();
  }

  const tenantId: string = row.tenant_id;

  const [{ data: tenant }, { data: overrides }, { data: settings }] = await Promise.all([
    db.from("tenants").select("slug, status, release_channel").eq("id", tenantId).maybeSingle(),
    db.from("tenant_features").select("feature_key, enabled").eq("tenant_id", tenantId),
    db.from("tenant_settings").select("key, value").eq("tenant_id", tenantId),
  ]);

  // Resolve to a complete flag map here rather than sending only the
  // overrides. The tenant then has one unambiguous answer per feature, and a
  // feature the tenant's build does not know about is simply ignored.
  const overrideMap = new Map((overrides ?? []).map((o) => [o.feature_key, o.enabled]));
  const features: Record<string, boolean> = {};
  for (const f of FEATURES) {
    features[f.key] = overrideMap.has(f.key) ? overrideMap.get(f.key)! : f.enabledByDefault;
  }

  // Best effort: a failed last_used_at write must not fail the pull.
  void db
    .from("tenant_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(undefined, () => {});

  return NextResponse.json(
    {
      slug: tenant?.slug ?? null,
      status: tenant?.status ?? null,
      release_channel: tenant?.release_channel ?? null,
      features,
      settings: Object.fromEntries((settings ?? []).map((s) => [s.key, s.value])),
      served_at: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

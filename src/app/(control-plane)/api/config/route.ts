import { NextResponse, type NextRequest } from "next/server";
import { FEATURES } from "@/config/features";
import { isControlPlane } from "@/lib/control-plane/auth";
import { controlPlaneClient } from "@/lib/control-plane/db";
import { authenticateTenant, bearerToken, touchToken } from "@/lib/control-plane/token-auth";

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

// The token lookup lives in lib/control-plane/token-auth.ts, shared with
// /api/heartbeat. Two hand-rolled copies of "hash the bearer token and look it
// up" is how one of them ends up subtly weaker than the other.

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

  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return unauthorized();

  const db = controlPlaneClient();
  if (!db) {
    return NextResponse.json({ error: "Control plane not configured" }, { status: 500 });
  }

  const auth = await authenticateTenant(db, token);
  if (!auth) {
    console.warn("[control-plane/config] rejected token", {
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
    });
    return unauthorized();
  }

  const tenantId: string = auth.tenantId;

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
  touchToken(db, auth.tokenId);

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

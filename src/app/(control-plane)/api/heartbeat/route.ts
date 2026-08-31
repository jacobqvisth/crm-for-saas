import { NextResponse, type NextRequest } from "next/server";
import { isControlPlane } from "@/lib/control-plane/auth";
import { controlPlaneClient } from "@/lib/control-plane/db";
import { authenticateTenant, bearerToken, touchToken } from "@/lib/control-plane/token-auth";
import { parseMetrics } from "@/lib/control-plane/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where a tenant reports its own numbers.
//
// The second and last door the control plane opens to tenants, and it is
// deliberately the boring shape of the first: the token identifies the tenant,
// there is no tenant id in the request, and a tenant can only ever write its
// own row.
//
// The direction matters more than the endpoint. The control plane could have
// READ these numbers out of each tenant's database, and that would have needed
// a service-role key per tenant stored here — one credential that reads every
// customer's entire CRM. Reporting inward means the control plane keeps no way
// in to anywhere.
//
// What may be reported is a closed list of counts in lib/control-plane/stats.ts.
// Unknown keys are REJECTED rather than dropped, so the list cannot quietly
// stop being closed.

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(request: NextRequest) {
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
    console.warn("[control-plane/heartbeat] rejected token", {
      ip: request.headers.get("x-forwarded-for") ?? "unknown",
    });
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const raw = (body as { metrics?: unknown } | null)?.metrics;
  const parsed = parseMetrics(raw ?? {});
  if (!parsed.ok) {
    // Say which key was wrong. This endpoint's caller is our own code on a
    // tenant deployment, not a stranger, and a silent 400 here would be
    // debugged by guesswork across two systems.
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const day = new Date().toISOString().slice(0, 10);
  const { error } = await db.from("tenant_stats").upsert(
    {
      tenant_id: auth.tenantId,
      day,
      reported_at: new Date().toISOString(),
      metrics: parsed.metrics,
    },
    { onConflict: "tenant_id,day" },
  );
  if (error) {
    return NextResponse.json({ error: "Could not store report" }, { status: 500 });
  }

  // Separate from the stats row on purpose: "reported nothing today" and "has
  // not been heard from since Tuesday" are different problems.
  await db
    .from("tenants")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", auth.tenantId);

  touchToken(db, auth.tokenId);

  return NextResponse.json(
    { ok: true, day, accepted: Object.keys(parsed.metrics ?? {}).length },
    { headers: { "cache-control": "no-store" } },
  );
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { MissingApiKeyError } from "@/lib/routes/geocode";
import { recomputeRouteAfterMutation } from "@/lib/routes/recompute";
import {
  FLAGS_DO_NOT_ROUTE,
  REMOVE_REASONS,
  type RemoveReason,
} from "@/lib/routes/remove-reasons";

const Body = z.object({
  reason: z.enum(REMOVE_REASONS as readonly [RemoveReason, ...RemoveReason[]]),
  notes: z.string().max(500).optional(),
});

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ routeId: string; stopId: string }> },
) {
  const { routeId, stopId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }
  const { reason, notes } = parsed.data;

  const { data: stop, error: stopErr } = await supabase
    .from("route_stops")
    .select("id, route_id, workspace_id, company_id, discovered_shop_id, shop_name")
    .eq("id", stopId)
    .eq("route_id", routeId)
    .maybeSingle();
  if (stopErr) return NextResponse.json({ error: stopErr.message }, { status: 500 });
  if (!stop) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", stop.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // 1) Delete the row.
  const { error: delErr } = await supabase
    .from("route_stops")
    .delete()
    .eq("id", stopId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // 2) Recompute totals — force=true here because removing a stop can never push the route
  //    above the day window, so the 409 path doesn't apply.
  let recompute;
  try {
    recompute = await recomputeRouteAfterMutation({ supabase, routeId, force: true });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY not configured" }, { status: 503 });
    }
    console.error("[DELETE /api/routes/[routeId]/stops/[stopId]] recompute failed", err);
    return NextResponse.json(
      { error: "Routes API failed — stop deleted but totals not refreshed" },
      { status: 502 },
    );
  }

  // 3) Activity row.
  await supabase.from("activities").insert({
    workspace_id: stop.workspace_id,
    user_id: user.id,
    company_id: stop.company_id,
    type: "route_stop_removed",
    subject: reason,
    body: notes ?? null,
    metadata: {
      routeId,
      stopId,
      shopName: stop.shop_name,
      companyId: stop.company_id,
      discoveredShopId: stop.discovered_shop_id,
      reason,
    },
  });

  // 4) do_not_route flag flips for reasons that imply a bad shop.
  if (FLAGS_DO_NOT_ROUTE.has(reason)) {
    const flagUpdate = {
      do_not_route: true,
      do_not_route_reason: reason,
      do_not_route_at: new Date().toISOString(),
    };
    if (stop.company_id) {
      await supabase.from("companies").update(flagUpdate).eq("id", stop.company_id);
    }
    if (stop.discovered_shop_id) {
      await supabase.from("discovered_shops").update(flagUpdate).eq("id", stop.discovered_shop_id);
    }
  }

  // 5) permanently_closed → also flip discovered_shops.permanently_closed.
  if (reason === "permanently_closed" && stop.discovered_shop_id) {
    await supabase
      .from("discovered_shops")
      .update({ permanently_closed: true })
      .eq("id", stop.discovered_shop_id);
  }

  if (recompute.ok === false) {
    // Shouldn't happen with force=true, but covered for safety.
    return NextResponse.json(
      {
        error: recompute.error,
        estimated_day_seconds: recompute.estimatedDaySeconds,
        max_seconds: recompute.maxSeconds,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    stop_count: recompute.stopCount,
    total_drive_seconds: recompute.totalSeconds,
    total_drive_meters: recompute.totalMeters,
    estimated_day_seconds: recompute.estimatedDaySeconds,
    google_maps_deeplink: recompute.deeplink,
  });
}

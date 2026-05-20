import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { recomputeFixedOrder } from "@/lib/routes/routes-api";
import { buildGoogleMapsDeeplink } from "@/lib/routes/generate";
import { MissingApiKeyError } from "@/lib/routes/geocode";
import {
  PRODUCTIVE_DAY_SECONDS,
  estimatedDaySeconds as computeEstimatedDaySeconds,
  exceedsDayWindow,
} from "@/lib/routes/day-window";

const Body = z.object({
  stopIds: z.array(z.string().uuid()).min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ routeId: string }> },
) {
  const { routeId: id } = await params;
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  const supabase = await createClient();

  // Auth
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Parse body
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { stopIds } = parsed.data;

  // Fetch route + workspace check
  const { data: route, error: routeErr } = await supabase
    .from("daily_routes")
    .select(
      "id, workspace_id, origin_address, origin_latitude, origin_longitude",
    )
    .eq("id", id)
    .maybeSingle();
  if (routeErr) return NextResponse.json({ error: routeErr.message }, { status: 500 });
  if (!route) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", route.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Fetch stops + validate set match
  const { data: existingStops, error: stopsErr } = await supabase
    .from("route_stops")
    .select("id, latitude, longitude")
    .eq("route_id", id);
  if (stopsErr) return NextResponse.json({ error: stopsErr.message }, { status: 500 });
  if (!existingStops || existingStops.length === 0) {
    return NextResponse.json({ error: "Route has no stops" }, { status: 400 });
  }

  const existingIds = new Set(existingStops.map((s) => s.id));
  const inputIds = new Set(stopIds);
  if (inputIds.size !== stopIds.length) {
    return NextResponse.json({ error: "stopIds contains duplicates" }, { status: 400 });
  }
  if (inputIds.size !== existingIds.size) {
    return NextResponse.json(
      { error: "stopIds count must match existing stops" },
      { status: 400 },
    );
  }
  for (const sid of inputIds) {
    if (!existingIds.has(sid)) {
      return NextResponse.json(
        { error: `stopId ${sid} not on this route` },
        { status: 400 },
      );
    }
  }

  // Build ordered waypoints in user-specified order
  const stopById = new Map(existingStops.map((s) => [s.id, s]));
  const orderedWaypoints = stopIds.map((sid) => {
    const s = stopById.get(sid)!;
    return { lat: s.latitude, lng: s.longitude };
  });

  // Routes API — fixed order
  let result: Awaited<ReturnType<typeof recomputeFixedOrder>>;
  try {
    result = await recomputeFixedOrder({
      origin: { lat: route.origin_latitude, lng: route.origin_longitude },
      orderedWaypoints,
      returnToOrigin: true,
    });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json(
        { error: "GOOGLE_MAPS_API_KEY not configured" },
        { status: 503 },
      );
    }
    console.error("[/api/routes/[id]/reorder] Routes API failed", err);
    return NextResponse.json(
      { error: "Routes API failed — no changes saved" },
      { status: 502 },
    );
  }

  // Day-window guardrail
  const stopCount = stopIds.length;
  const estimatedDaySeconds = computeEstimatedDaySeconds(
    result.totalSeconds,
    stopCount,
  );
  if (!force && exceedsDayWindow(estimatedDaySeconds)) {
    return NextResponse.json(
      {
        error: "exceeds_day_window",
        estimated_day_seconds: estimatedDaySeconds,
        max_seconds: PRODUCTIVE_DAY_SECONDS,
        total_drive_seconds: result.totalSeconds,
      },
      { status: 409 },
    );
  }

  // Build new deeplink
  const deeplink = buildGoogleMapsDeeplink({
    origin: route.origin_address,
    waypoints: orderedWaypoints,
  });

  // Build per-stop updates. legs[idx] is the drive into stop[idx] (origin → first stop, etc.)
  const stopOrders = stopIds.map((sid, idx) => ({
    id: sid,
    stop_order: idx,
    leg_drive_seconds: result.legs[idx]?.seconds ?? null,
    leg_drive_meters: result.legs[idx]?.meters ?? null,
  }));

  // Atomic via plpgsql function. Cast through `unknown` because the generated
  // Database type doesn't yet include the new RPC; type-regen happens on the
  // next health-check pass (see PR #128 procedure in CLAUDE.md).
  const rpcClient = supabase as unknown as {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>;
  };
  const { error: rpcErr } = await rpcClient.rpc("reorder_route_stops", {
    p_route_id: id,
    p_workspace_id: route.workspace_id,
    p_stop_orders: stopOrders,
    p_total_drive_seconds: result.totalSeconds,
    p_total_drive_meters: result.totalMeters,
    p_estimated_day_seconds: estimatedDaySeconds,
    p_google_maps_deeplink: deeplink,
    p_routes_api_response: result.rawResponse,
  });
  if (rpcErr) {
    console.error("[/api/routes/[id]/reorder] rpc failed", rpcErr);
    return NextResponse.json({ error: rpcErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    total_drive_seconds: result.totalSeconds,
    total_drive_meters: result.totalMeters,
    estimated_day_seconds: estimatedDaySeconds,
    google_maps_deeplink: deeplink,
  });
}

// Recompute totals + per-stop leg drives + deeplink for a route after a stop
// has been added or removed. Caller has already mutated route_stops; this
// reads the current stops, calls Routes API, and writes legs + daily_routes
// totals atomically (best-effort, since Supabase JS doesn't expose tx).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { recomputeFixedOrder } from "./routes-api";
import { buildGoogleMapsDeeplink } from "./generate";
import { estimatedDaySeconds, exceedsDayWindow, PRODUCTIVE_DAY_SECONDS } from "./day-window";

export type RecomputeOk = {
  ok: true;
  totalSeconds: number;
  totalMeters: number;
  estimatedDaySeconds: number;
  stopCount: number;
  deeplink: string;
};

export type RecomputeFail = {
  ok: false;
  /** "exceeds_day_window" → caller should respond 409 with the metadata. */
  error: "exceeds_day_window";
  estimatedDaySeconds: number;
  totalSeconds: number;
  maxSeconds: number;
};

export async function recomputeRouteAfterMutation({
  supabase,
  routeId,
  force = false,
}: {
  supabase: SupabaseClient<Database>;
  routeId: string;
  force?: boolean;
}): Promise<RecomputeOk | RecomputeFail> {
  const { data: route, error: routeErr } = await supabase
    .from("daily_routes")
    .select("id, origin_address, origin_latitude, origin_longitude")
    .eq("id", routeId)
    .single();
  if (routeErr || !route) throw new Error(routeErr?.message ?? "route not found");

  const { data: stops, error: stopsErr } = await supabase
    .from("route_stops")
    .select("id, latitude, longitude, stop_order")
    .eq("route_id", routeId)
    .order("stop_order", { ascending: true });
  if (stopsErr) throw new Error(stopsErr.message);

  const stopList = stops ?? [];
  const stopCount = stopList.length;

  if (stopCount === 0) {
    // Empty route: clear totals + deeplink.
    const { error: updErr } = await supabase
      .from("daily_routes")
      .update({
        stop_count: 0,
        total_drive_seconds: 0,
        total_drive_meters: 0,
        estimated_day_seconds: 0,
        google_maps_deeplink: buildGoogleMapsDeeplink({ origin: route.origin_address, waypoints: [] }),
      })
      .eq("id", routeId);
    if (updErr) throw new Error(updErr.message);
    return {
      ok: true,
      totalSeconds: 0,
      totalMeters: 0,
      estimatedDaySeconds: 0,
      stopCount: 0,
      deeplink: buildGoogleMapsDeeplink({ origin: route.origin_address, waypoints: [] }),
    };
  }

  const orderedWaypoints = stopList.map((s) => ({ lat: s.latitude, lng: s.longitude }));

  const result = await recomputeFixedOrder({
    origin: { lat: route.origin_latitude, lng: route.origin_longitude },
    orderedWaypoints,
    returnToOrigin: true,
  });

  const dayLength = estimatedDaySeconds(result.totalSeconds, stopCount);
  if (!force && exceedsDayWindow(dayLength)) {
    return {
      ok: false,
      error: "exceeds_day_window",
      estimatedDaySeconds: dayLength,
      totalSeconds: result.totalSeconds,
      maxSeconds: PRODUCTIVE_DAY_SECONDS,
    };
  }

  const deeplink = buildGoogleMapsDeeplink({ origin: route.origin_address, waypoints: orderedWaypoints });

  // Update each stop's leg drive (legs[idx] is the drive into stop idx).
  // Use one parallel batch — there are at most 12 stops.
  const legUpdates = stopList.map((s, idx) =>
    supabase
      .from("route_stops")
      .update({
        leg_drive_seconds: result.legs[idx]?.seconds ?? null,
        leg_drive_meters: result.legs[idx]?.meters ?? null,
      })
      .eq("id", s.id),
  );
  const legResults = await Promise.all(legUpdates);
  for (const r of legResults) {
    if (r.error) throw new Error(`leg update failed: ${r.error.message}`);
  }

  const { error: updErr } = await supabase
    .from("daily_routes")
    .update({
      stop_count: stopCount,
      total_drive_seconds: result.totalSeconds,
      total_drive_meters: result.totalMeters,
      estimated_day_seconds: dayLength,
      google_maps_deeplink: deeplink,
      routes_api_response: result.rawResponse as never,
    })
    .eq("id", routeId);
  if (updErr) throw new Error(updErr.message);

  return {
    ok: true,
    totalSeconds: result.totalSeconds,
    totalMeters: result.totalMeters,
    estimatedDaySeconds: dayLength,
    stopCount,
    deeplink,
  };
}

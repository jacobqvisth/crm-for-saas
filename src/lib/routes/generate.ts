// generateDailyRoutes — the main route generator.
// Pure-ish function: pulls candidate pools, clusters, assigns mode per cluster,
// optimizes via Routes API, builds Google Maps deeplink, persists routes + stops.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { cluster, haversineKm, type Point } from "./cluster";
import { labelForCentroid } from "./cluster-label";
import { optimizeRoute, type LatLng } from "./routes-api";

const STOCKHOLM_CENTER = { lat: 59.3293, lng: 18.0686 };
const RADIUS_KM = 120;
const VISIT_MINUTES = 30;
const PRODUCTIVE_DAY_SECONDS = 7.5 * 3600;
const MIN_STOPS_PER_ROUTE = 4;
const MAX_STOPS_PER_ROUTE = 12;

export type ModeMix = { mixed: number; cold: number; lapsed: number };
export type Origin = { address: string; lat: number; lng: number };

export type GenerateInput = {
  workspaceId: string;
  origin: Origin;
  generatedBy?: string | null;
  desiredCount?: number;
  modeMix?: ModeMix;
  supabase: SupabaseClient<Database>;
};

export type GenerateSummary = {
  batchId: string;
  routesCreated: number;
  coldPoolSize: number;
  lapsedPoolSize: number;
  fallbacks: { clusterLabel: string; reason: string }[];
  routes: { id: string; clusterLabel: string; mode: string; stopCount: number }[];
};

type CandidateOrigin = "discovered_shop" | "company";
type Candidate = {
  origin: CandidateOrigin;
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

export async function generateDailyRoutes(input: GenerateInput): Promise<GenerateSummary> {
  const {
    workspaceId,
    origin,
    generatedBy = null,
    desiredCount = 10,
    modeMix = { mixed: 5, cold: 3, lapsed: 2 },
    supabase,
  } = input;

  // 1. Pull candidate pools
  const cold = await fetchColdPool(supabase);
  const lapsed = await fetchLapsedPool(supabase);

  // 2. Cluster the union with k = desiredCount
  const allPoints: Point<{ kind: CandidateOrigin; idx: number }>[] = [
    ...cold.map((c, idx) => ({ id: { kind: "discovered_shop" as const, idx }, lat: c.lat, lng: c.lng })),
    ...lapsed.map((c, idx) => ({ id: { kind: "company" as const, idx }, lat: c.lat, lng: c.lng })),
  ];

  if (allPoints.length === 0) {
    throw new Error("No candidate shops in range — nothing to route.");
  }

  const clusters = cluster(allPoints, desiredCount);

  // 3. Compute lapsed-density per cluster, then assign modes.
  const ranked = clusters
    .map((c) => {
      const totalCount = c.points.length;
      const lapsedCount = c.points.filter((p) => p.id.kind === "company").length;
      return { c, totalCount, lapsedCount, lapsedRatio: totalCount > 0 ? lapsedCount / totalCount : 0 };
    })
    .sort((a, b) => b.lapsedRatio - a.lapsedRatio); // highest density first

  const modeForIndex = new Map<number, "lapsed" | "cold" | "mixed">();
  // Top N → lapsed (pre-fallback)
  const lapsedSlots = Math.min(modeMix.lapsed, ranked.length);
  for (let i = 0; i < lapsedSlots; i++) modeForIndex.set(i, "lapsed");
  // Bottom M → cold
  const coldSlots = Math.min(modeMix.cold, Math.max(0, ranked.length - lapsedSlots));
  for (let i = ranked.length - coldSlots; i < ranked.length; i++) modeForIndex.set(i, "cold");
  // Everything else → mixed
  for (let i = 0; i < ranked.length; i++) if (!modeForIndex.has(i)) modeForIndex.set(i, "mixed");

  // 4–6. For each cluster, build candidates, optimize, build deeplink.
  const batchId = crypto.randomUUID();
  const summary: GenerateSummary = {
    batchId,
    routesCreated: 0,
    coldPoolSize: cold.length,
    lapsedPoolSize: lapsed.length,
    fallbacks: [],
    routes: [],
  };

  for (let i = 0; i < ranked.length; i++) {
    const { c } = ranked[i];
    let mode = modeForIndex.get(i) ?? "mixed";
    const clusterLabel = labelForCentroid(c.centroidLat, c.centroidLng);

    // Materialize candidates from indices
    const inCluster: Candidate[] = c.points.map((p) => {
      if (p.id.kind === "discovered_shop") return cold[p.id.idx];
      return lapsed[p.id.idx];
    });

    // Pick mode-appropriate subset
    let pool: Candidate[];
    let fallbackReason: string | null = null;
    if (mode === "lapsed") {
      const lapsedOnly = inCluster.filter((x) => x.origin === "company");
      if (lapsedOnly.length < 6) {
        // fall back to mixed for this cluster
        fallbackReason = `lapsed pool < 6 in cluster (${lapsedOnly.length})`;
        mode = "mixed";
        pool = inCluster;
      } else {
        pool = lapsedOnly;
      }
    } else if (mode === "cold") {
      pool = inCluster.filter((x) => x.origin === "discovered_shop");
    } else {
      pool = inCluster;
    }

    if (fallbackReason) {
      summary.fallbacks.push({ clusterLabel, reason: fallbackReason });
    }

    // Sort by priority — for mixed: lapsed first, then by distance to centroid; otherwise distance only.
    const centroid = { lat: c.centroidLat, lng: c.centroidLng };
    pool.sort((a, b) => {
      if (mode === "mixed") {
        if (a.origin !== b.origin) return a.origin === "company" ? -1 : 1;
      }
      return haversineKm(a, centroid) - haversineKm(b, centroid);
    });

    let stops = pool.slice(0, Math.min(MAX_STOPS_PER_ROUTE, pool.length));
    if (stops.length < MIN_STOPS_PER_ROUTE) continue; // don't generate a route this small

    // Optimize with Routes API; if too long, drop farthest waypoint and retry.
    let optimized: Awaited<ReturnType<typeof optimizeRoute>> | null = null;
    while (stops.length >= MIN_STOPS_PER_ROUTE) {
      const waypoints: LatLng[] = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
      const result = await optimizeRoute({ origin: { lat: origin.lat, lng: origin.lng }, waypoints, returnToOrigin: true });
      const dayLengthSec = result.totalSeconds + VISIT_MINUTES * 60 * stops.length;
      if (dayLengthSec <= PRODUCTIVE_DAY_SECONDS) {
        optimized = result;
        break;
      }
      // Drop farthest stop from centroid and retry
      let farthestIdx = 0;
      let farthestD = -1;
      for (let s = 0; s < stops.length; s++) {
        const d = haversineKm(stops[s], centroid);
        if (d > farthestD) {
          farthestD = d;
          farthestIdx = s;
        }
      }
      stops = stops.filter((_, idx) => idx !== farthestIdx);
    }

    if (!optimized) continue; // discard route entirely

    // Reorder stops by Google's optimization
    const reordered = optimized.orderedWaypointIndices.map((idx) => stops[idx]);

    // Build deeplink
    const deeplink = buildGoogleMapsDeeplink({ origin: origin.address, waypoints: reordered });

    // Insert route + stops in a single (best-effort) transaction.
    // Supabase JS client doesn't support transactions directly — insert route first,
    // then stops; if stops fail, delete the route to avoid orphans.
    const dayLengthSeconds = optimized.totalSeconds + VISIT_MINUTES * 60 * reordered.length;

    const { data: insertedRoute, error: routeErr } = await supabase
      .from("daily_routes")
      .insert({
        workspace_id: workspaceId,
        generated_by: generatedBy,
        generation_batch_id: batchId,
        mode,
        mode_fallback_reason: fallbackReason,
        cluster_label: clusterLabel,
        origin_address: origin.address,
        origin_latitude: origin.lat,
        origin_longitude: origin.lng,
        stop_count: reordered.length,
        total_drive_seconds: optimized.totalSeconds,
        total_drive_meters: optimized.totalMeters,
        estimated_day_seconds: dayLengthSeconds,
        google_maps_deeplink: deeplink,
        routes_api_response: optimized.rawResponse as never,
      })
      .select("id")
      .single();

    if (routeErr || !insertedRoute) {
      console.error("[generateDailyRoutes] route insert failed", routeErr);
      continue;
    }

    // legs[0] is origin → first stop, legs[1..n] follow stop order, legs[n+1] is last → origin (return)
    // Use legs[0..n-1] for per-stop leg_drive (drive into that stop).
    const stopRows = reordered.map((s, idx) => ({
      route_id: insertedRoute.id,
      workspace_id: workspaceId,
      stop_order: idx,
      discovered_shop_id: s.origin === "discovered_shop" ? s.id : null,
      company_id: s.origin === "company" ? s.id : null,
      shop_name: s.name,
      shop_address: s.address,
      latitude: s.lat,
      longitude: s.lng,
      leg_drive_seconds: optimized.legs[idx]?.seconds ?? null,
      leg_drive_meters: optimized.legs[idx]?.meters ?? null,
    }));

    const { error: stopsErr } = await supabase.from("route_stops").insert(stopRows);
    if (stopsErr) {
      console.error("[generateDailyRoutes] stops insert failed, rolling back route", stopsErr);
      await supabase.from("daily_routes").delete().eq("id", insertedRoute.id);
      continue;
    }

    summary.routesCreated++;
    summary.routes.push({ id: insertedRoute.id, clusterLabel, mode, stopCount: reordered.length });
  }

  return summary;
}

// ----- pool fetchers -----

async function fetchColdPool(supabase: SupabaseClient<Database>): Promise<Candidate[]> {
  const { data, error } = await supabase
    .from("discovered_shops")
    .select("id, name, address, latitude, longitude")
    .is("crm_company_id", null)
    .in("shop_type", ["auto_repair", "tire_combo", "auto_glass", "auto_body"])
    .not("permanently_closed", "is", true)
    .not("latitude", "is", null)
    .not("longitude", "is", null)
    .limit(2000);

  if (error) throw new Error(`cold pool query failed: ${error.message}`);

  return (data ?? [])
    .filter((r): r is typeof r & { latitude: number; longitude: number; address: string } =>
      r.latitude != null && r.longitude != null && !!r.address,
    )
    .map((r) => ({
      origin: "discovered_shop" as const,
      id: r.id,
      name: r.name ?? "(unnamed shop)",
      address: r.address,
      lat: r.latitude,
      lng: r.longitude,
    }))
    .filter((c) => haversineKm(c, STOCKHOLM_CENTER) <= RADIUS_KM);
}

async function fetchLapsedPool(supabase: SupabaseClient<Database>): Promise<Candidate[]> {
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, address, latitude, longitude, subscription_status, activated_at, churned_at")
    .or("subscription_status.is.null,subscription_status.in.(canceled,incomplete_expired)")
    .or("activated_at.not.is.null,churned_at.not.is.null")
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (error) throw new Error(`lapsed pool query failed: ${error.message}`);

  return (data ?? [])
    .filter((r): r is typeof r & { latitude: number; longitude: number; address: string } =>
      r.latitude != null && r.longitude != null && !!r.address,
    )
    .map((r) => ({
      origin: "company" as const,
      id: r.id,
      name: r.name,
      address: r.address,
      lat: r.latitude,
      lng: r.longitude,
    }))
    .filter((c) => haversineKm(c, STOCKHOLM_CENTER) <= RADIUS_KM);
}

// ----- deeplink -----

export function buildGoogleMapsDeeplink({
  origin,
  waypoints,
}: {
  origin: string;
  waypoints: { lat: number; lng: number }[];
}): string {
  // https://developers.google.com/maps/documentation/urls/get-started#directions-action
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination: origin,
    travelmode: "driving",
  });
  if (waypoints.length > 0) {
    params.set("waypoints", waypoints.map((w) => `${w.lat},${w.lng}`).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

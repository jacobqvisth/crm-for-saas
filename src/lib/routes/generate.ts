// generateDailyRoutes — the main route generator.
// Pure-ish function: pulls candidate pools, clusters, assigns mode per cluster,
// optimizes via Routes API, builds Google Maps deeplink, persists routes + stops.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { cluster, haversineKm, type Point } from "./cluster";
import { labelForCentroid } from "./cluster-label";
import { optimizeRoute, type LatLng } from "./routes-api";

const STOCKHOLM_CENTER = { lat: 59.3293, lng: 18.0686 };
const RADIUS_KM = 120;
const VISIT_MINUTES = 30;
const PRODUCTIVE_DAY_SECONDS = 7.5 * 3600;
export const MIN_STOPS_PER_ROUTE = 4;
export const MAX_STOPS_PER_ROUTE = 12;
export const DEFAULT_MIN_REVISIT_DAYS = 30;

export type ModeMix = { mixed: number; cold: number; lapsed: number };
export type Origin = { address: string; lat: number; lng: number };

export type GenerateInput = {
  workspaceId: string;
  origin: Origin;
  generatedBy?: string | null;
  /** Whose routes these are. Defaults to generatedBy. */
  assignedTo?: string | null;
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

// 'cold'   = company that's never activated (lifecycle_stage in lead/mql/sql/etc., activated_at IS NULL)
// 'lapsed' = company that did activate at some point (activated_at IS NOT NULL) but isn't currently paying
type CandidateKind = "cold" | "lapsed";
type Candidate = {
  kind: CandidateKind;
  companyId: string;
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
    assignedTo = generatedBy,
    desiredCount = 10,
    modeMix = { mixed: 5, cold: 3, lapsed: 2 },
    supabase,
  } = input;

  // Read workspace-level min revisit interval (overridden per-company below).
  const workspaceDefaultRevisit = await fetchWorkspaceMinRevisit(supabase, workspaceId);

  // 1. Pull candidate pool — single query against `companies`. Cold vs lapsed
  //    is decided by whether the company ever activated (became a customer).
  //    `discovered_shops` rows are NOT eligible for field-route generation —
  //    they're un-vetted Apify scrapes; only shops the team has explicitly
  //    promoted to `companies` get visited.
  const allCandidates = await fetchCompanyPool(supabase, workspaceId, workspaceDefaultRevisit);
  const cold = allCandidates.filter((c) => c.kind === "cold");
  const lapsed = allCandidates.filter((c) => c.kind === "lapsed");

  // 2. Cluster the union with k = desiredCount. We don't need to track which
  //    pool each point came from for the clustering itself — we'll re-derive
  //    cold/lapsed from the candidate's `kind` later.
  const allPoints: Point<{ idx: number }>[] = allCandidates.map((c, idx) => ({
    id: { idx },
    lat: c.lat,
    lng: c.lng,
  }));

  if (allPoints.length === 0) {
    throw new Error("No candidate shops in range — nothing to route.");
  }

  const clusters = cluster(allPoints, desiredCount);

  // 3. Compute lapsed-density per cluster, then assign modes.
  const ranked = clusters
    .map((c) => {
      const totalCount = c.points.length;
      const lapsedCount = c.points.filter((p) => allCandidates[p.id.idx].kind === "lapsed").length;
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
    const inCluster: Candidate[] = c.points.map((p) => allCandidates[p.id.idx]);

    // Pick mode-appropriate subset
    let pool: Candidate[];
    let fallbackReason: string | null = null;
    if (mode === "lapsed") {
      const lapsedOnly = inCluster.filter((x) => x.kind === "lapsed");
      if (lapsedOnly.length < 6) {
        // fall back to mixed for this cluster
        fallbackReason = `lapsed pool < 6 in cluster (${lapsedOnly.length})`;
        mode = "mixed";
        pool = inCluster;
      } else {
        pool = lapsedOnly;
      }
    } else if (mode === "cold") {
      pool = inCluster.filter((x) => x.kind === "cold");
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
        if (a.kind !== b.kind) return a.kind === "lapsed" ? -1 : 1;
      }
      return haversineKm(a, centroid) - haversineKm(b, centroid);
    });

    let stops = pool.slice(0, Math.min(MAX_STOPS_PER_ROUTE, pool.length));
    if (stops.length < MIN_STOPS_PER_ROUTE) continue; // don't generate a route this small

    // Optimize with Routes API; if too long, drop farthest waypoint and retry.
    // If the API call itself fails (transient 5xx, empty response after retry),
    // record a fallback and skip this cluster — don't abort the whole generation.
    let optimized: Awaited<ReturnType<typeof optimizeRoute>> | null = null;
    let optimizeError: string | null = null;
    while (stops.length >= MIN_STOPS_PER_ROUTE) {
      const waypoints: LatLng[] = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
      let result: Awaited<ReturnType<typeof optimizeRoute>>;
      try {
        result = await optimizeRoute({ origin: { lat: origin.lat, lng: origin.lng }, waypoints, returnToOrigin: true });
      } catch (e) {
        optimizeError = e instanceof Error ? e.message : String(e);
        console.error(`[generateDailyRoutes] Routes API failed for cluster '${clusterLabel}' (${stops.length} stops): ${optimizeError}`);
        break;
      }
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

    if (optimizeError) {
      summary.fallbacks.push({ clusterLabel, reason: `Routes API failed: ${optimizeError}` });
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
        assigned_to: assignedTo,
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
    // All stops point at a `companies` row now. The `discovered_shops`-backed
    // stops on pre-existing routes (from before this change) keep working —
    // the route_stops CHECK constraint allows either FK, just not both.
    const stopRows = reordered.map((s, idx) => ({
      route_id: insertedRoute.id,
      workspace_id: workspaceId,
      stop_order: idx,
      discovered_shop_id: null,
      company_id: s.companyId,
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

// ----- pool fetcher -----

// Pull every company in the workspace that's a valid field-visit candidate,
// regardless of cold-vs-lapsed. We re-tag in-memory based on `activated_at`.
//
// Eligibility rules:
// - has lat/lng (geocoded) and a usable address
// - not a currently-paying customer:
//     subscription_status NOT IN ('active','trialing','past_due')
//     AND customer_status NOT IN ('active','trialing')
//     (NULLs on either field count as eligible)
// - do_not_route IS NOT TRUE
// - last visit (route_stops.visited_at most-recent) outside the per-company or
//   workspace-default min_revisit_interval_days window
// - inside the Stockholm 120km radius (post-filter, in-memory)
//
// We page through 1000 rows at a time because Supabase REST default pageSize
// is 1000 and the workspace has ~10k companies.
async function fetchCompanyPool(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  workspaceDefaultRevisitDays: number,
): Promise<Candidate[]> {
  const PAGE_SIZE = 1000;
  const rows: {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    activated_at: string | null;
    minRevisit: number | null;
  }[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("companies")
      .select(
        "id, name, address, latitude, longitude, subscription_status, customer_status, activated_at, do_not_route, min_revisit_interval_days",
      )
      .eq("workspace_id", workspaceId)
      .eq("do_not_route", false)
      .or("subscription_status.is.null,subscription_status.not.in.(active,trialing,past_due)")
      .or("customer_status.is.null,customer_status.not.in.(active,trialing)")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw new Error(`company pool query failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      if (r.latitude == null || r.longitude == null || !r.address) continue;
      if (haversineKm({ lat: r.latitude, lng: r.longitude }, STOCKHOLM_CENTER) > RADIUS_KM) continue;
      rows.push({
        id: r.id,
        name: r.name,
        address: r.address,
        lat: r.latitude,
        lng: r.longitude,
        activated_at: r.activated_at,
        minRevisit: r.min_revisit_interval_days ?? null,
      });
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (rows.length === 0) return [];

  const recentVisits = await fetchMostRecentVisits(
    supabase,
    workspaceId,
    rows.map((r) => r.id),
  );
  const now = Date.now();

  const out: Candidate[] = [];
  for (const r of rows) {
    const intervalDays = r.minRevisit ?? workspaceDefaultRevisitDays;
    const lastVisitedAt = recentVisits.get(r.id);
    if (lastVisitedAt) {
      const ageDays = (now - new Date(lastVisitedAt).getTime()) / 86_400_000;
      if (ageDays < intervalDays) continue;
    }
    out.push({
      kind: r.activated_at ? "lapsed" : "cold",
      companyId: r.id,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
    });
  }
  return out;
}

async function fetchWorkspaceMinRevisit(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
): Promise<number> {
  const { data } = await supabase
    .from("workspaces")
    .select("settings")
    .eq("id", workspaceId)
    .maybeSingle();
  const settings = data?.settings;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const fv = (settings as Record<string, Json>).field_visits;
    if (fv && typeof fv === "object" && !Array.isArray(fv)) {
      const v = (fv as Record<string, Json>).min_revisit_interval_days;
      if (typeof v === "number" && v > 0) return v;
    }
  }
  return DEFAULT_MIN_REVISIT_DAYS;
}

async function fetchMostRecentVisits(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  companyIds: string[],
): Promise<Map<string, string>> {
  const recent = new Map<string, string>();
  if (companyIds.length === 0) return recent;
  // Chunk to keep the .in() URL short (PostgREST URL limit can drop ~1000 UUIDs).
  const CHUNK = 200;
  for (let i = 0; i < companyIds.length; i += CHUNK) {
    const slice = companyIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("route_stops")
      .select("company_id, visited_at")
      .eq("workspace_id", workspaceId)
      .in("company_id", slice)
      .not("visited_at", "is", null)
      .order("visited_at", { ascending: false });
    if (error) throw new Error(`recent visits query failed: ${error.message}`);
    for (const row of data ?? []) {
      if (!row.company_id || !row.visited_at) continue;
      // Ordered DESC: first row per company wins.
      if (!recent.has(row.company_id)) recent.set(row.company_id, row.visited_at);
    }
  }
  return recent;
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

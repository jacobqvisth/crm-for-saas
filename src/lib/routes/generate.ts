// Route generation.
//
// `generateRoute` (Phase 5) — one click, one route. Picks the highest-scoring
// cluster (region-locked or auto), scores stops, optimizes via Routes API.
// `generateDailyRoutes` (Phase 1) — bulk batch flow, kept as backward-compat
// helper for tests and any caller that hasn't migrated yet.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { cluster, haversineKm, type Point } from "./cluster";
import { labelForCentroid, labelForStops, type LabelStop } from "./cluster-label";
import {
  rankClusters,
  type ClusterStop,
  type ScoredCluster,
} from "./cluster-rank";
import { fetchEngagementSignals } from "./engagement";
import { resolveListContactIds } from "@/lib/lists/filter-query";
import { geocodeAddressWithMeta, makeGeocodeCache } from "./geocode";
import { isUnavailable, type UnavailableReason } from "./profile";
import { optimizeRoute, type LatLng } from "./routes-api";
import { scoreStops, type CandidateStop, type ScoredStop } from "./stop-score";

const STOCKHOLM_CENTER = { lat: 59.3293, lng: 18.0686 };
const RADIUS_KM = 120;
const VISIT_MINUTES = 30;
const PRODUCTIVE_DAY_SECONDS = 7.5 * 3600;
export const MIN_STOPS_PER_ROUTE = 4;
export const MAX_STOPS_PER_ROUTE = 10;
export const DEFAULT_MIN_REVISIT_DAYS = 30;

// Google Maps web Directions URL truncates beyond this; we mirror the cap.
export const MAX_GOOGLE_MAPS_WAYPOINTS = 10;

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
  /**
   * Optional deterministic RNG for the k-means++ initialization. Production
   * leaves this undefined and the algorithm uses `Math.random`. Tests pass
   * a seeded RNG so cluster assignment is stable when the suite runs in any
   * order — without it `generate.test.ts` was flaky in the full src/ run
   * because other tests had advanced the global random state.
   */
  rng?: () => number;
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
    rng,
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

  const clusters = cluster(allPoints, desiredCount, { rng });

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
    lastVisitedAt: string | null;
  }[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("companies")
      .select(
        "id, name, address, latitude, longitude, subscription_status, customer_status, activated_at, do_not_route, min_revisit_interval_days, last_visited_at",
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
        lastVisitedAt: r.last_visited_at ?? null,
      });
    }

    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  if (rows.length === 0) return [];

  const directVisits = new Map<string, string | null>(
    rows.map((r) => [r.id, r.lastVisitedAt]),
  );
  const recentVisits = await fetchMostRecentVisits(
    supabase,
    workspaceId,
    rows.map((r) => r.id),
    directVisits,
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
  directVisits?: Map<string, string | null>,
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
  // Fold in companies.last_visited_at — captures visits that happened outside
  // Field Routes (manual drop-bys, pre-CRM outreach). Take the max so a more
  // recent route_stops visit still wins.
  if (directVisits) {
    for (const [id, ts] of directVisits) {
      if (!ts) continue;
      const existing = recent.get(id);
      if (!existing || new Date(ts).getTime() > new Date(existing).getTime()) {
        recent.set(id, ts);
      }
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
  // Google's web URL silently drops waypoints beyond ~10. Trim defensively so
  // legacy routes (pre-PR-N) and any future regression still produce a working
  // URL — the on-screen list shows the full set of stops.
  const safeWaypoints = waypoints.slice(0, MAX_GOOGLE_MAPS_WAYPOINTS);
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination: origin,
    travelmode: "driving",
  });
  if (safeWaypoints.length > 0) {
    params.set("waypoints", safeWaypoints.map((w) => `${w.lat},${w.lng}`).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Phase 5 — single-route generation
// ---------------------------------------------------------------------------

export type RegionKey =
  | "auto"
  | "stockholm-north"
  | "stockholm-south"
  | "stockholm-east"
  | "stockholm-west"
  | "uppsala"
  | "sodertalje"
  | "malardalen-west"
  | "norrtalje-area";

const REGION_CENTERS: Record<Exclude<RegionKey, "auto">, { lat: number; lng: number }> = {
  "stockholm-north": { lat: 59.42, lng: 17.95 },
  "stockholm-south": { lat: 59.2, lng: 17.95 },
  "stockholm-east": { lat: 59.32, lng: 18.2 },
  "stockholm-west": { lat: 59.36, lng: 17.85 },
  uppsala: { lat: 59.858, lng: 17.638 },
  sodertalje: { lat: 59.196, lng: 17.625 },
  "malardalen-west": { lat: 59.371, lng: 16.51 },
  "norrtalje-area": { lat: 59.756, lng: 18.7 },
};

const REGION_RADIUS_KM = 25;
const KMEANS_K = 10;

/** Optional pre-generation filters that prune the candidate company pool. */
export type CandidateFilterKey =
  /** Drop companies whose contacts already received a sent email. */
  | "exclude_already_emailed"
  /** Drop companies whose contacts have NOT yet received a sent email. */
  | "exclude_never_emailed"
  /** Drop companies whose contacts have replied (contacts.last_contacted_at set). */
  | "exclude_replied"
  /** Drop companies that are already onboarded as Wrenchlane app workshops. */
  | "exclude_has_account";

export const CANDIDATE_FILTER_KEYS: CandidateFilterKey[] = [
  "exclude_already_emailed",
  "exclude_never_emailed",
  "exclude_replied",
  "exclude_has_account",
];

export type GenerateRouteInput = {
  workspaceId: string;
  origin: Origin;
  generatedBy?: string | null;
  /** Whose route this is. Defaults to generatedBy. */
  assignedTo?: string | null;
  region?: RegionKey;
  /** ISO YYYY-MM-DD. When set, applies Phase 4's PTO + working-day check on assignedTo. */
  forDate?: string | null;
  /** Optional candidate-pool filters from the UI dropdown. */
  filters?: CandidateFilterKey[];
  /**
   * Optional saved-list ID. When set, the candidate pool is restricted to the
   * companies whose contacts belong to that list, and the list is treated as
   * authoritative: the not-a-customer, revisit-window, and Stockholm-radius
   * eligibility filters are skipped (a geocoded address and `do_not_route=false`
   * are still required). The "Filter out" candidate filters still compose on top.
   */
  listId?: string | null;
  supabase: SupabaseClient<Database>;
};

export type GenerateRouteSuccess = {
  ok: true;
  route: {
    id: string;
    clusterLabel: string;
    mode: "mixed" | "cold" | "lapsed";
    stopCount: number;
    totalDriveSeconds: number;
    estimatedDaySeconds: number;
    googleMapsDeeplink: string;
    scheduledFor: string | null;
  };
  diagnostics: {
    consideredClusters: number;
    chosenClusterScore: number;
    skippedReasons: { tooSmall: number; allSuppressed: number; dayWindowOverflow: number };
    poolSize: number;
    cityCoverage: number;
    fellBackToCentroidLabel: boolean;
    /** How many list companies were geocoded on the fly during this run. */
    geocodedCount: number;
  };
};

export type GenerateRouteFailure = {
  ok: false;
  error:
    | "no_eligible_cluster"
    | "no_pool"
    | "unavailable_date"
    | "routes_api_failed"
    | "persist_failed";
  reason: string;
  diagnostics?: {
    consideredClusters: number;
    skippedReasons: { tooSmall: number; allSuppressed: number; dayWindowOverflow: number };
    poolSize: number;
  };
};

export type GenerateRouteResult = GenerateRouteSuccess | GenerateRouteFailure;

type EnrichedCandidate = {
  companyId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  city: string | null;
  rating: number | null;
  activatedAt: string | null;
  lastVisitedAt: string | null;
  hasSendableEmail: boolean;
};

export async function generateRoute(input: GenerateRouteInput): Promise<GenerateRouteResult> {
  const {
    workspaceId,
    origin,
    generatedBy = null,
    assignedTo = generatedBy,
    region = "auto",
    forDate = null,
    filters = [],
    listId = null,
    supabase,
  } = input;

  // 1. Phase 4 schedule guard — only when forDate is provided. Empty forDate
  //    skips PTO + working-day; min_revisit_interval_days still applies via
  //    fetchEnrichedPool below (date-independent).
  if (forDate && assignedTo) {
    const reason = await isUnavailable(assignedTo, forDate, supabase);
    if (reason) {
      return {
        ok: false,
        error: "unavailable_date",
        reason: describeUnavailable(reason, forDate),
      };
    }
  }

  // 2. When a list is selected, resolve it to the companies its contacts
  //    belong to. The list is authoritative — fetchEnrichedPool skips the
  //    not-a-customer / revisit / radius eligibility gates for these IDs.
  let restrictToCompanyIds: string[] | undefined;
  let geocodedCount = 0;
  if (listId) {
    const listCompanyIds = await fetchListCompanyIds(supabase, workspaceId, listId);
    if (listCompanyIds === null) {
      return { ok: false, error: "no_pool", reason: "List not found in this workspace." };
    }
    if (listCompanyIds.length === 0) {
      return {
        ok: false,
        error: "no_pool",
        reason: "The selected list has no contacts linked to a company.",
      };
    }
    // Auto-geocode list companies that have an address but no coordinates, so a
    // freshly-imported/manual company becomes routable without a manual step.
    geocodedCount = await backfillMissingGeocodes(supabase, workspaceId, listCompanyIds);
    restrictToCompanyIds = listCompanyIds;
  }

  // 3. Pull pool with all the signals we'll need downstream.
  const workspaceDefaultRevisit = await fetchWorkspaceMinRevisit(supabase, workspaceId);
  const pool = await applyCandidateFilters(
    await fetchEnrichedPool(supabase, workspaceId, workspaceDefaultRevisit, {
      restrictToCompanyIds,
      authoritative: listId != null,
    }),
    supabase,
    workspaceId,
    filters,
  );
  if (pool.length === 0) {
    return {
      ok: false,
      error: "no_pool",
      reason: listId
        ? "No geocoded companies in the selected list after filters. Add addresses on the companies or pick another list."
        : "No eligible companies in workspace after filters.",
    };
  }

  const companyIds = pool.map((p) => p.companyId);
  const engagement = await fetchEngagementSignals(supabase, workspaceId, companyIds);

  // 3. k-means cluster.
  const points: Point<{ idx: number }>[] = pool.map((c, idx) => ({
    id: { idx },
    lat: c.lat,
    lng: c.lng,
  }));
  const rawClusters = cluster(points, KMEANS_K);

  // 4. Materialize candidate clusters with all signals attached.
  const candidateClusters = rawClusters.map((c) => ({
    centroidLat: c.centroidLat,
    centroidLng: c.centroidLng,
    candidates: c.points.map((p) => pool[p.id.idx]),
  }));

  // 5. Region filter (auto = no filter).
  const skipped = { tooSmall: 0, allSuppressed: 0, dayWindowOverflow: 0 };
  const regionCenter = region === "auto" ? null : REGION_CENTERS[region];
  let regionFiltered = candidateClusters;
  if (regionCenter) {
    regionFiltered = candidateClusters.filter((c) => {
      return (
        haversineKm({ lat: c.centroidLat, lng: c.centroidLng }, regionCenter) <= REGION_RADIUS_KM
      );
    });
  }

  // 6. Drop clusters smaller than MIN_STOPS_PER_ROUTE.
  const eligible = regionFiltered.filter((c) => {
    if (c.candidates.length < MIN_STOPS_PER_ROUTE) {
      skipped.tooSmall++;
      return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    return {
      ok: false,
      error: "no_eligible_cluster",
      reason:
        region === "auto"
          ? `No cluster has at least ${MIN_STOPS_PER_ROUTE} eligible stops.`
          : `No cluster within ${REGION_RADIUS_KM} km of ${region} has at least ${MIN_STOPS_PER_ROUTE} eligible stops.`,
      diagnostics: {
        consideredClusters: candidateClusters.length,
        skippedReasons: skipped,
        poolSize: pool.length,
      },
    };
  }

  // 7. Rank.
  const rankInput = eligible.map((c) => ({
    centroidLat: c.centroidLat,
    centroidLng: c.centroidLng,
    stops: c.candidates.map<ClusterStop>((s) => ({
      companyId: s.companyId,
      lat: s.lat,
      lng: s.lng,
      activatedAt: s.activatedAt,
      rating: s.rating,
      lastVisitedAt: s.lastVisitedAt,
      lastEmailedAt: engagement.lastEmailedAt.get(s.companyId) ?? null,
    })),
  }));
  const ranked = rankClusters(rankInput);

  // 8. Walk down ranked list — try each cluster in score order. Skip if
  //    scoreStops + day-window trim leaves us below MIN_STOPS_PER_ROUTE or
  //    if Routes API fails. This handles the case where the top cluster has
  //    enough rows but every shop is too distant to visit in a single day.
  let chosen: { ranked: ScoredCluster; candidates: EnrichedCandidate[] } | null = null;
  for (const r of ranked) {
    const candidates = lookupCandidatesForRanked(eligible, r);
    if (!candidates) continue;
    chosen = { ranked: r, candidates };
    break;
  }
  if (!chosen) {
    return {
      ok: false,
      error: "no_eligible_cluster",
      reason: "Ranker returned no clusters.",
      diagnostics: {
        consideredClusters: candidateClusters.length,
        skippedReasons: skipped,
        poolSize: pool.length,
      },
    };
  }

  // 9. Score stops within chosen cluster.
  const scoringInput = chosen.candidates.map<CandidateStop>((s) => ({
    companyId: s.companyId,
    lat: s.lat,
    lng: s.lng,
    activatedAt: s.activatedAt,
    rating: s.rating,
    hasSendableEmail: s.hasSendableEmail,
    hasRecentPositiveEngagement: engagement.recentPositiveCompanies.has(s.companyId),
    lastVisitedAt: s.lastVisitedAt,
  }));
  const scoredStops = scoreStops(scoringInput, {
    lat: chosen.ranked.centroidLat,
    lng: chosen.ranked.centroidLng,
  });

  const candidateById = new Map(chosen.candidates.map((c) => [c.companyId, c]));
  const top = scoredStops.slice(0, MAX_STOPS_PER_ROUTE);

  // 10. Routes API + day-window drop-and-retry.
  const centroid = { lat: chosen.ranked.centroidLat, lng: chosen.ranked.centroidLng };
  let stops: ScoredStop[] = top.slice();
  let optimized: Awaited<ReturnType<typeof optimizeRoute>> | null = null;
  let optimizeError: string | null = null;

  while (stops.length >= MIN_STOPS_PER_ROUTE) {
    const waypoints: LatLng[] = stops.map((s) => ({ lat: s.lat, lng: s.lng }));
    let result: Awaited<ReturnType<typeof optimizeRoute>>;
    try {
      result = await optimizeRoute({
        origin: { lat: origin.lat, lng: origin.lng },
        waypoints,
        returnToOrigin: true,
      });
    } catch (e) {
      optimizeError = e instanceof Error ? e.message : String(e);
      break;
    }
    const dayLengthSec = result.totalSeconds + VISIT_MINUTES * 60 * stops.length;
    if (dayLengthSec <= PRODUCTIVE_DAY_SECONDS) {
      optimized = result;
      break;
    }
    skipped.dayWindowOverflow++;
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
    return {
      ok: false,
      error: "routes_api_failed",
      reason: optimizeError,
      diagnostics: {
        consideredClusters: candidateClusters.length,
        skippedReasons: skipped,
        poolSize: pool.length,
      },
    };
  }
  if (!optimized) {
    return {
      ok: false,
      error: "no_eligible_cluster",
      reason: "Day-window trim reduced stops below minimum for the chosen cluster.",
      diagnostics: {
        consideredClusters: candidateClusters.length,
        skippedReasons: skipped,
        poolSize: pool.length,
      },
    };
  }

  // 11. Reorder by Routes API.
  const reordered = optimized.orderedWaypointIndices.map((idx) => stops[idx]);
  const finalCandidates = reordered.map((s) => {
    const c = candidateById.get(s.companyId);
    if (!c) throw new Error(`scored stop ${s.companyId} missing from candidate map`);
    return c;
  });

  // 12. Mode + label from FINAL stops.
  const lapsedCount = finalCandidates.filter((c) => c.activatedAt != null).length;
  const coldCount = finalCandidates.length - lapsedCount;
  let mode: "mixed" | "cold" | "lapsed" = "mixed";
  if (lapsedCount / finalCandidates.length >= 0.8) mode = "lapsed";
  else if (coldCount / finalCandidates.length >= 0.8) mode = "cold";

  const labelStops: LabelStop[] = finalCandidates.map((c) => ({
    city: c.city,
    lat: c.lat,
    lng: c.lng,
  }));
  const cityCoverage = labelStops.filter((s) => s.city && s.city.trim().length > 0).length;
  const finalLabel = labelForStops(labelStops, centroid.lat, centroid.lng);
  const fellBackToCentroidLabel = cityCoverage < labelStops.length / 2 || cityCoverage === 0;

  // 13. Persist route + stops. Best-effort transaction (insert route, then
  //     stops; rollback the route if stops insert fails to avoid orphans).
  const dayLengthSeconds = optimized.totalSeconds + VISIT_MINUTES * 60 * reordered.length;
  const deeplink = buildGoogleMapsDeeplink({
    origin: origin.address,
    waypoints: reordered.map((s) => ({ lat: s.lat, lng: s.lng })),
  });
  const batchId = crypto.randomUUID();

  const { data: insertedRoute, error: routeErr } = await supabase
    .from("daily_routes")
    .insert({
      workspace_id: workspaceId,
      generated_by: generatedBy,
      assigned_to: assignedTo,
      generation_batch_id: batchId,
      mode,
      mode_fallback_reason: null,
      cluster_label: finalLabel,
      origin_address: origin.address,
      origin_latitude: origin.lat,
      origin_longitude: origin.lng,
      scheduled_for: forDate ?? null,
      stop_count: reordered.length,
      total_drive_seconds: optimized.totalSeconds,
      total_drive_meters: optimized.totalMeters,
      estimated_day_seconds: dayLengthSeconds,
      google_maps_deeplink: deeplink,
      routes_api_response: optimized.rawResponse as never,
    })
    .select("id, scheduled_for")
    .single();

  if (routeErr || !insertedRoute) {
    return {
      ok: false,
      error: "persist_failed",
      reason: routeErr?.message ?? "Insert returned no row.",
      diagnostics: {
        consideredClusters: candidateClusters.length,
        skippedReasons: skipped,
        poolSize: pool.length,
      },
    };
  }

  const stopRows = finalCandidates.map((s, idx) => ({
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
    await supabase.from("daily_routes").delete().eq("id", insertedRoute.id);
    return {
      ok: false,
      error: "persist_failed",
      reason: `route_stops insert failed: ${stopsErr.message}`,
      diagnostics: {
        consideredClusters: candidateClusters.length,
        skippedReasons: skipped,
        poolSize: pool.length,
      },
    };
  }

  return {
    ok: true,
    route: {
      id: insertedRoute.id,
      clusterLabel: finalLabel,
      mode,
      stopCount: reordered.length,
      totalDriveSeconds: optimized.totalSeconds,
      estimatedDaySeconds: dayLengthSeconds,
      googleMapsDeeplink: deeplink,
      scheduledFor: insertedRoute.scheduled_for ?? null,
    },
    diagnostics: {
      consideredClusters: candidateClusters.length,
      chosenClusterScore: chosen.ranked.totalScore,
      skippedReasons: skipped,
      poolSize: pool.length,
      cityCoverage,
      fellBackToCentroidLabel,
      geocodedCount,
    },
  };
}

function lookupCandidatesForRanked(
  eligible: { centroidLat: number; centroidLng: number; candidates: EnrichedCandidate[] }[],
  r: ScoredCluster,
): EnrichedCandidate[] | null {
  // Match the ranked cluster back to its source by centroid + first companyId.
  // (rankClusters preserves stops order, so the first entry's companyId is a
  // safe fingerprint.)
  const firstId = r.stops[0]?.companyId;
  for (const c of eligible) {
    if (c.centroidLat !== r.centroidLat || c.centroidLng !== r.centroidLng) continue;
    if (firstId && c.candidates[0]?.companyId !== firstId) continue;
    return c.candidates;
  }
  return null;
}

function describeUnavailable(reason: UnavailableReason, isoDate: string): string {
  if (reason.kind === "non_working_day") {
    return `${isoDate} is not a working day (${reason.day}) for the assignee.`;
  }
  return `${isoDate} is marked PTO${reason.reason ? `: ${reason.reason}` : ""}.`;
}

/** Options for {@link fetchEnrichedPool}. */
type EnrichedPoolOpts = {
  /**
   * Restrict the pool to these company IDs (queried in chunks). Used for
   * list-sourced generation. When omitted, the whole workspace is paginated.
   */
  restrictToCompanyIds?: string[];
  /**
   * Treat the source as authoritative: skip the not-a-customer, Stockholm-radius,
   * and revisit-window eligibility gates. A geocoded address and `do_not_route=false`
   * are still required. Used together with `restrictToCompanyIds` for lists.
   */
  authoritative?: boolean;
};

const COMPANY_POOL_COLUMNS =
  "id, name, address, latitude, longitude, city, rating, subscription_status, customer_status, activated_at, do_not_route, min_revisit_interval_days, last_visited_at";

async function fetchEnrichedPool(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  workspaceDefaultRevisitDays: number,
  opts: EnrichedPoolOpts = {},
): Promise<EnrichedCandidate[]> {
  const { restrictToCompanyIds, authoritative = false } = opts;
  const PAGE_SIZE = 1000;
  type Row = {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    city: string | null;
    rating: number | null;
    activatedAt: string | null;
    minRevisit: number | null;
    lastVisitedAt: string | null;
  };
  const rows: Row[] = [];

  // base() rebuilds the workspace-scoped query with the geocode + do_not_route
  // gates that always apply. The not-a-customer gate is skipped in authoritative
  // mode (lists curate exactly who to visit, customer or not).
  const base = () => {
    let q = supabase
      .from("companies")
      .select(COMPANY_POOL_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("do_not_route", false)
      .not("latitude", "is", null)
      .not("longitude", "is", null);
    if (!authoritative) {
      q = q
        .or("subscription_status.is.null,subscription_status.not.in.(active,trialing,past_due)")
        .or("customer_status.is.null,customer_status.not.in.(active,trialing)");
    }
    return q;
  };

  type CompanyRow = {
    id: string;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    city: string | null;
    rating: number | string | null;
    activated_at: string | null;
    min_revisit_interval_days: number | null;
    last_visited_at: string | null;
  };

  const ingest = (data: CompanyRow[]) => {
    for (const r of data) {
      if (r.latitude == null || r.longitude == null || !r.address) continue;
      // Radius gate only applies to the open workspace pool — an authoritative
      // list may legitimately target shops outside the Stockholm catchment.
      if (
        !authoritative &&
        haversineKm({ lat: r.latitude, lng: r.longitude }, STOCKHOLM_CENTER) > RADIUS_KM
      ) {
        continue;
      }
      rows.push({
        id: r.id,
        name: r.name,
        address: r.address,
        lat: r.latitude,
        lng: r.longitude,
        city: r.city ?? null,
        rating: r.rating == null ? null : Number(r.rating),
        activatedAt: r.activated_at,
        minRevisit: r.min_revisit_interval_days ?? null,
        lastVisitedAt: r.last_visited_at ?? null,
      });
    }
  };

  if (restrictToCompanyIds) {
    // Chunk the .in() list to keep the PostgREST URL short (~200 UUIDs/req).
    const CHUNK = 200;
    for (let i = 0; i < restrictToCompanyIds.length; i += CHUNK) {
      const slice = restrictToCompanyIds.slice(i, i + CHUNK);
      const { data, error } = await base().in("id", slice).limit(slice.length);
      if (error) throw new Error(`enriched pool query failed: ${error.message}`);
      ingest((data ?? []) as CompanyRow[]);
    }
  } else {
    let offset = 0;
    while (true) {
      const { data, error } = await base()
        .order("id")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error(`enriched pool query failed: ${error.message}`);
      if (!data || data.length === 0) break;
      ingest(data as CompanyRow[]);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const directVisits = new Map<string, string | null>(
    rows.map((r) => [r.id, r.lastVisitedAt]),
  );
  const recentVisits = await fetchMostRecentVisits(supabase, workspaceId, ids, directVisits);
  const sendable = await fetchSendableContactCompanies(supabase, workspaceId, ids);
  const now = Date.now();

  const out: EnrichedCandidate[] = [];
  for (const r of rows) {
    const intervalDays = r.minRevisit ?? workspaceDefaultRevisitDays;
    const lastVisitedAt = recentVisits.get(r.id) ?? null;
    // Authoritative (list) pools keep recently-visited shops — the user chose them.
    if (!authoritative && lastVisitedAt) {
      const ageDays = (now - new Date(lastVisitedAt).getTime()) / 86_400_000;
      if (ageDays < intervalDays) continue;
    }
    out.push({
      companyId: r.id,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      city: r.city,
      rating: r.rating,
      activatedAt: r.activatedAt,
      lastVisitedAt,
      hasSendableEmail: sendable.has(r.id),
    });
  }
  return out;
}

async function fetchSendableContactCompanies(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  companyIds: string[],
): Promise<Set<string>> {
  const result = new Set<string>();
  if (companyIds.length === 0) return result;
  const CHUNK = 200;
  for (let i = 0; i < companyIds.length; i += CHUNK) {
    const slice = companyIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("contacts")
      .select("company_id, email_status")
      .eq("workspace_id", workspaceId)
      .in("company_id", slice)
      .in("email_status", ["valid", "catch_all"]);
    if (error) throw new Error(`sendable contacts query failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.company_id) result.add(row.company_id);
    }
  }
  return result;
}

/**
 * Resolve a saved contact list to the distinct set of company IDs its contacts
 * belong to. Returns `null` when the list doesn't exist in this workspace, or an
 * empty array when no member contact is linked to a company. Dynamic vs static
 * resolution is delegated to {@link resolveListContactIds}.
 */
async function fetchListCompanyIds(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  listId: string,
): Promise<string[] | null> {
  const { data: list, error } = await supabase
    .from("contact_lists")
    .select("id, workspace_id, is_dynamic, filters")
    .eq("id", listId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`list lookup failed: ${error.message}`);
  if (!list) return null;

  const contactIds = await resolveListContactIds(supabase, list);
  if (contactIds.length === 0) return [];

  const companyIds = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const slice = contactIds.slice(i, i + CHUNK);
    const { data, error: cErr } = await supabase
      .from("contacts")
      .select("company_id")
      .eq("workspace_id", workspaceId)
      .in("id", slice)
      .not("company_id", "is", null);
    if (cErr) throw new Error(`list company resolution failed: ${cErr.message}`);
    for (const row of data ?? []) {
      if (row.company_id) companyIds.add(row.company_id);
    }
  }
  return Array.from(companyIds);
}

// Cap how many companies we'll geocode in one generate call, and how many we
// fire concurrently — keeps us inside the route's maxDuration even for a large
// list where most rows lack coordinates.
const GEOCODE_BACKFILL_CAP = 200;
const GEOCODE_CONCURRENCY = 8;

type GeocodableRow = {
  id: string;
  name: string;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
};

/**
 * Geocode list companies that have an address but no lat/lng, persisting the
 * result back to `companies`. Returns how many rows were geocoded. Best-effort:
 * a row that can't be resolved is left as-is (it simply won't be routable).
 */
async function backfillMissingGeocodes(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  companyIds: string[],
): Promise<number> {
  if (companyIds.length === 0) return 0;

  const missing: GeocodableRow[] = [];
  const CHUNK = 200;
  for (let i = 0; i < companyIds.length && missing.length < GEOCODE_BACKFILL_CAP; i += CHUNK) {
    const slice = companyIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("companies")
      .select("id, name, address, postal_code, city, country")
      .eq("workspace_id", workspaceId)
      .in("id", slice)
      .or("latitude.is.null,longitude.is.null")
      .limit(slice.length);
    if (error) throw new Error(`geocode backfill scan failed: ${error.message}`);
    for (const r of (data ?? []) as GeocodableRow[]) {
      if (missing.length >= GEOCODE_BACKFILL_CAP) break;
      missing.push(r);
    }
  }
  if (missing.length === 0) return 0;

  const cache = makeGeocodeCache();
  let geocoded = 0;

  for (let i = 0; i < missing.length; i += GEOCODE_CONCURRENCY) {
    const batch = missing.slice(i, i + GEOCODE_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (r) => ({ id: r.id, coords: await geocodeCompanyRow(r, cache) })),
    );
    for (const { id, coords } of results) {
      if (!coords) continue;
      const { error } = await supabase
        .from("companies")
        .update({ latitude: coords.lat, longitude: coords.lng })
        .eq("id", id)
        .eq("workspace_id", workspaceId);
      if (error) {
        console.error(`[geocode backfill] update failed for ${id}: ${error.message}`);
        continue;
      }
      geocoded++;
    }
  }
  return geocoded;
}

/**
 * Resolve one company to coordinates. Prefers the full street address; if that
 * is missing or doesn't resolve, falls back to "<name>, <city, country>" but
 * rejects APPROXIMATE matches (locality centroid) — a vague pin is worse than
 * no pin for driving directions.
 */
async function geocodeCompanyRow(
  r: GeocodableRow,
  cache: ReturnType<typeof makeGeocodeCache>,
): Promise<{ lat: number; lng: number } | null> {
  const street = r.address?.trim();
  if (street) {
    const q = [street, r.postal_code, r.city, r.country]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(", ");
    const meta = await geocodeAddressWithMeta(q, cache);
    if (meta) return { lat: meta.lat, lng: meta.lng };
  }

  const locality = [r.city, r.country]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");
  if (r.name && locality) {
    const meta = await geocodeAddressWithMeta(`${r.name}, ${locality}`, cache);
    if (meta && meta.precision !== "APPROXIMATE") return { lat: meta.lat, lng: meta.lng };
  }
  return null;
}

/**
 * Apply user-selected candidate filters to the enriched pool. Each filter
 * either expands an exclude-set or restricts the pool via an include-only
 * set. Filters compose: stacking opposing filters (e.g. already-emailed +
 * never-emailed) collapses the pool to empty, which is the user's choice.
 */
async function applyCandidateFilters(
  pool: EnrichedCandidate[],
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  filters: CandidateFilterKey[],
): Promise<EnrichedCandidate[]> {
  if (filters.length === 0 || pool.length === 0) return pool;

  const ids = pool.map((p) => p.companyId);

  const exclude = new Set<string>();
  let includeOnly: Set<string> | null = null;

  const needsEmailedSet = filters.some(
    (f) => f === "exclude_already_emailed" || f === "exclude_never_emailed",
  );
  const emailedCompanyIds = needsEmailedSet
    ? await fetchCompaniesWithSentEmail(supabase, workspaceId, ids)
    : null;

  if (filters.includes("exclude_already_emailed") && emailedCompanyIds) {
    for (const id of emailedCompanyIds) exclude.add(id);
  }
  if (filters.includes("exclude_never_emailed") && emailedCompanyIds) {
    includeOnly = includeOnly ?? new Set(ids);
    const next = new Set<string>();
    for (const id of includeOnly) {
      if (emailedCompanyIds.has(id)) next.add(id);
    }
    includeOnly = next;
  }

  if (filters.includes("exclude_replied")) {
    for (const id of await fetchCompaniesWithRepliedContact(supabase, workspaceId, ids)) {
      exclude.add(id);
    }
  }

  if (filters.includes("exclude_has_account")) {
    for (const id of await fetchCompaniesWithWlAccount(supabase, workspaceId, ids)) {
      exclude.add(id);
    }
  }

  return pool.filter(
    (c) => !exclude.has(c.companyId) && (!includeOnly || includeOnly.has(c.companyId)),
  );
}

async function fetchCompaniesWithSentEmail(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  companyIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (companyIds.length === 0) return out;
  const CHUNK = 200;

  // Map company_id → contact_ids in scope.
  const contactToCompany = new Map<string, string>();
  for (let i = 0; i < companyIds.length; i += CHUNK) {
    const slice = companyIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("contacts")
      .select("id, company_id")
      .eq("workspace_id", workspaceId)
      .in("company_id", slice);
    if (error) throw new Error(`contacts (sent-email scan) failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.company_id) contactToCompany.set(row.id, row.company_id);
    }
  }
  if (contactToCompany.size === 0) return out;

  const contactIds = Array.from(contactToCompany.keys());
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const slice = contactIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("email_queue")
      .select("contact_id, sent_at")
      .eq("workspace_id", workspaceId)
      .in("contact_id", slice)
      .not("sent_at", "is", null)
      .limit(slice.length);
    if (error) throw new Error(`email_queue (sent-email scan) failed: ${error.message}`);
    for (const row of data ?? []) {
      if (!row.contact_id) continue;
      const companyId = contactToCompany.get(row.contact_id);
      if (companyId) out.add(companyId);
    }
  }
  return out;
}

async function fetchCompaniesWithRepliedContact(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  companyIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (companyIds.length === 0) return out;
  const CHUNK = 200;
  for (let i = 0; i < companyIds.length; i += CHUNK) {
    const slice = companyIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("contacts")
      .select("company_id")
      .eq("workspace_id", workspaceId)
      .in("company_id", slice)
      .not("last_contacted_at", "is", null);
    if (error) throw new Error(`contacts (replied scan) failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.company_id) out.add(row.company_id);
    }
  }
  return out;
}

async function fetchCompaniesWithWlAccount(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  companyIds: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (companyIds.length === 0) return out;
  const CHUNK = 200;
  for (let i = 0; i < companyIds.length; i += CHUNK) {
    const slice = companyIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("companies")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("id", slice)
      .not("wl_workshop_id", "is", null);
    if (error) throw new Error(`companies (wl-account scan) failed: ${error.message}`);
    for (const row of data ?? []) {
      out.add(row.id);
    }
  }
  return out;
}

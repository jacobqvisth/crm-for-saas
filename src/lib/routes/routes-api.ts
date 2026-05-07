// Google Routes API v2 wrapper.
// optimizeRoute — Google reorders waypoints (cold-start route generation).
// recomputeFixedOrder — visit order is fixed by caller (manual reorder).
// Uses TRAFFIC_AWARE routing preference. Field mask is narrow to keep cost down
// but includes encoded polyline so the embedded map can draw the actual road path.

import { MissingApiKeyError } from "./geocode";

export type LatLng = { lat: number; lng: number };

export type RouteLeg = { seconds: number; meters: number };

export type OptimizeRouteResult = {
  /** Indices into the original `waypoints` array, in the optimized visit order. */
  orderedWaypointIndices: number[];
  totalSeconds: number;
  totalMeters: number;
  legs: RouteLeg[];
  /** Encoded polyline (Google's algorithm) for the entire route, or null if not returned. */
  encodedPolyline: string | null;
  rawResponse: unknown;
};

const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

const FIELD_MASK = [
  "routes.duration",
  "routes.distanceMeters",
  "routes.optimizedIntermediateWaypointIndex",
  "routes.polyline.encodedPolyline",
  "routes.legs.duration",
  "routes.legs.distanceMeters",
].join(",");

type RoutesApiRoute = {
  duration?: string;
  distanceMeters?: number;
  optimizedIntermediateWaypointIndex?: number[];
  polyline?: { encodedPolyline?: string };
  legs?: { duration?: string; distanceMeters?: number }[];
};

type RoutesApiResponse = {
  routes?: RoutesApiRoute[];
};

type ParsedRoute = RoutesApiRoute & { _rawResponse: RoutesApiResponse };

async function callRoutesApi(body: Record<string, unknown>): Promise<ParsedRoute> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new MissingApiKeyError();

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[routes-api] HTTP ${res.status}: ${text.slice(0, 500)}`);
    throw new Error(`Routes API HTTP ${res.status}`);
  }

  const data = (await res.json()) as RoutesApiResponse;
  const route = data.routes?.[0];
  if (!route) {
    console.error(`[routes-api] no routes in response: ${JSON.stringify(data).slice(0, 300)}`);
    throw new Error("Routes API returned no routes");
  }
  return { ...route, _rawResponse: data };
}

function buildBody({
  origin,
  waypoints,
  returnToOrigin,
  optimize,
}: {
  origin: LatLng;
  waypoints: LatLng[];
  returnToOrigin: boolean;
  optimize: boolean;
}): Record<string, unknown> {
  return {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: returnToOrigin
      ? { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } }
      : { location: { latLng: { latitude: waypoints.at(-1)!.lat, longitude: waypoints.at(-1)!.lng } } },
    intermediates: (returnToOrigin ? waypoints : waypoints.slice(0, -1)).map((p) => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } },
    })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    optimizeWaypointOrder: optimize,
  };
}

function parseRoute(
  route: ParsedRoute,
  waypointCount: number,
  returnToOrigin: boolean,
): OptimizeRouteResult {
  const totalSeconds = parseDurationSeconds(route.duration);
  const totalMeters = route.distanceMeters ?? 0;
  const legs: RouteLeg[] = (route.legs ?? []).map((l) => ({
    seconds: parseDurationSeconds(l.duration),
    meters: l.distanceMeters ?? 0,
  }));

  const orderedWaypointIndices =
    route.optimizedIntermediateWaypointIndex ??
    Array.from({ length: returnToOrigin ? waypointCount : Math.max(0, waypointCount - 1) }, (_, i) => i);

  const encodedPolyline = route.polyline?.encodedPolyline ?? null;

  return {
    orderedWaypointIndices,
    totalSeconds,
    totalMeters,
    legs,
    encodedPolyline,
    rawResponse: route._rawResponse,
  };
}

export async function optimizeRoute({
  origin,
  waypoints,
  returnToOrigin = true,
}: {
  origin: LatLng;
  waypoints: LatLng[];
  returnToOrigin?: boolean;
}): Promise<OptimizeRouteResult> {
  if (waypoints.length < 1) throw new Error("optimizeRoute: need at least 1 waypoint");
  const route = await callRoutesApi(buildBody({ origin, waypoints, returnToOrigin, optimize: true }));
  return parseRoute(route, waypoints.length, returnToOrigin);
}

/**
 * Recompute legs for a manually-ordered set of waypoints.
 * Caller has already decided the visit order — this just asks Google for fresh
 * leg times and an encoded polyline. `optimizeWaypointOrder` is forced false.
 */
export async function recomputeFixedOrder({
  origin,
  orderedWaypoints,
  returnToOrigin = true,
}: {
  origin: LatLng;
  orderedWaypoints: LatLng[];
  returnToOrigin?: boolean;
}): Promise<OptimizeRouteResult> {
  if (orderedWaypoints.length < 1) throw new Error("recomputeFixedOrder: need at least 1 waypoint");
  const route = await callRoutesApi(
    buildBody({ origin, waypoints: orderedWaypoints, returnToOrigin, optimize: false }),
  );
  const result = parseRoute(route, orderedWaypoints.length, returnToOrigin);
  result.orderedWaypointIndices = Array.from({ length: orderedWaypoints.length }, (_, i) => i);
  return result;
}

function parseDurationSeconds(d?: string): number {
  if (!d) return 0;
  const m = d.match(/^(\d+)s$/);
  return m ? Number(m[1]) : 0;
}

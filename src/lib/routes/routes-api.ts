// Google Routes API v2 wrapper.
// Single function: optimizeRoute({origin, waypoints, returnToOrigin: true}).
// Uses TRAFFIC_AWARE routing preference and asks Google to optimize waypoint order.
// Field mask is narrow to keep cost down.

import { MissingApiKeyError } from "./geocode";

export type LatLng = { lat: number; lng: number };

export type RouteLeg = { seconds: number; meters: number };

export type OptimizeRouteResult = {
  /** Indices into the original `waypoints` array, in the optimized visit order. */
  orderedWaypointIndices: number[];
  totalSeconds: number;
  totalMeters: number;
  legs: RouteLeg[];
  rawResponse: unknown;
};

const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

export async function optimizeRoute({
  origin,
  waypoints,
  returnToOrigin = true,
}: {
  origin: LatLng;
  waypoints: LatLng[];
  returnToOrigin?: boolean;
}): Promise<OptimizeRouteResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new MissingApiKeyError();
  if (waypoints.length < 1) throw new Error("optimizeRoute: need at least 1 waypoint");

  const body = {
    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
    destination: returnToOrigin
      ? { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } }
      : { location: { latLng: { latitude: waypoints.at(-1)!.lat, longitude: waypoints.at(-1)!.lng } } },
    intermediates: (returnToOrigin ? waypoints : waypoints.slice(0, -1)).map((p) => ({
      location: { latLng: { latitude: p.lat, longitude: p.lng } },
    })),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
    optimizeWaypointOrder: true,
  };

  const fieldMask = [
    "routes.duration",
    "routes.distanceMeters",
    "routes.optimizedIntermediateWaypointIndex",
    "routes.legs.duration",
    "routes.legs.distanceMeters",
  ].join(",");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`[routes-api] HTTP ${res.status}: ${text.slice(0, 500)}`);
    throw new Error(`Routes API HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    routes?: {
      duration?: string;
      distanceMeters?: number;
      optimizedIntermediateWaypointIndex?: number[];
      legs?: { duration?: string; distanceMeters?: number }[];
    }[];
  };

  const route = data.routes?.[0];
  if (!route) {
    console.error(`[routes-api] no routes in response: ${JSON.stringify(data).slice(0, 300)}`);
    throw new Error("Routes API returned no routes");
  }

  // duration comes as e.g. "5400s"
  const totalSeconds = parseDurationSeconds(route.duration);
  const totalMeters = route.distanceMeters ?? 0;
  const legs: RouteLeg[] = (route.legs ?? []).map((l) => ({
    seconds: parseDurationSeconds(l.duration),
    meters: l.distanceMeters ?? 0,
  }));

  // If returnToOrigin and the API didn't return an explicit ordering, fall back to identity.
  const orderedWaypointIndices =
    route.optimizedIntermediateWaypointIndex ??
    Array.from({ length: returnToOrigin ? waypoints.length : Math.max(0, waypoints.length - 1) }, (_, i) => i);

  return { orderedWaypointIndices, totalSeconds, totalMeters, legs, rawResponse: data };
}

function parseDurationSeconds(d?: string): number {
  if (!d) return 0;
  const m = d.match(/^(\d+)s$/);
  return m ? Number(m[1]) : 0;
}

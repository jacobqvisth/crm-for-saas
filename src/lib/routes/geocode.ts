// Google Geocoding API wrapper.
// In-process cache lives for the duration of one request — pass `cache` if you
// want to share results across calls (e.g. inside a single API handler invocation).

export class MissingApiKeyError extends Error {
  constructor() {
    super("GOOGLE_MAPS_API_KEY not configured");
    this.name = "MissingApiKeyError";
  }
}

export type GeocodeResult = { lat: number; lng: number };

/** Google's `geometry.location_type` — how precise the match is. */
export type GeocodePrecision =
  | "ROOFTOP"
  | "RANGE_INTERPOLATED"
  | "GEOMETRIC_CENTER"
  | "APPROXIMATE";

export type GeocodeResultMeta = GeocodeResult & { precision: GeocodePrecision };

export type GeocodeCache = Map<string, GeocodeResultMeta | null>;

export function makeGeocodeCache(): GeocodeCache {
  return new Map();
}

function normalize(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Geocode a free-text address and return the location plus Google's precision
 * (`location_type`). Callers that geocode loose queries (e.g. a business name
 * with no street) can reject `APPROXIMATE` hits, which Google returns as the
 * locality centroid — useless for driving directions.
 */
export async function geocodeAddressWithMeta(
  address: string,
  cache?: GeocodeCache,
): Promise<GeocodeResultMeta | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new MissingApiKeyError();

  const norm = normalize(address);
  if (cache?.has(norm)) return cache.get(norm) ?? null;

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.error(`[geocode] HTTP ${res.status} for ${norm}`);
    cache?.set(norm, null);
    return null;
  }

  const data = (await res.json()) as {
    status: string;
    results?: {
      geometry?: { location?: { lat: number; lng: number }; location_type?: string };
    }[];
  };

  if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
    if (data.status !== "ZERO_RESULTS") {
      console.error(`[geocode] status=${data.status} for ${norm}`);
    }
    cache?.set(norm, null);
    return null;
  }

  const geom = data.results[0].geometry;
  const out: GeocodeResultMeta = {
    lat: geom.location!.lat,
    lng: geom.location!.lng,
    precision: (geom.location_type as GeocodePrecision) ?? "APPROXIMATE",
  };
  cache?.set(norm, out);
  return out;
}

export async function geocodeAddress(
  address: string,
  cache?: GeocodeCache,
): Promise<GeocodeResult | null> {
  const meta = await geocodeAddressWithMeta(address, cache);
  return meta ? { lat: meta.lat, lng: meta.lng } : null;
}

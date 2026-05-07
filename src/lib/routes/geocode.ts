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

export type GeocodeCache = Map<string, GeocodeResult | null>;

export function makeGeocodeCache(): GeocodeCache {
  return new Map();
}

function normalize(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function geocodeAddress(
  address: string,
  cache?: GeocodeCache,
): Promise<GeocodeResult | null> {
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
    results?: { geometry?: { location?: { lat: number; lng: number } } }[];
  };

  if (data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
    if (data.status !== "ZERO_RESULTS") {
      console.error(`[geocode] status=${data.status} for ${norm}`);
    }
    cache?.set(norm, null);
    return null;
  }

  const loc = data.results[0].geometry.location;
  const out = { lat: loc.lat, lng: loc.lng };
  cache?.set(norm, out);
  return out;
}

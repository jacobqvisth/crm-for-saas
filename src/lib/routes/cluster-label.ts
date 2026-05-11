// Route name builders.
//
// Phase 5 prefers a stop-aware label (`labelForStops`) — the actual cities the
// route visits make a more useful name than any centroid-derived guess. The
// older centroid mapping (`labelForCentroid`) is kept around as the fallback
// when city data is missing on the chosen stops.

const REGIONS: { name: string; lat: number; lng: number }[] = [
  // Stockholm — west / northwest
  { name: "Bromma", lat: 59.345, lng: 17.945 },
  { name: "Hässelby", lat: 59.367, lng: 17.838 },
  { name: "Vällingby", lat: 59.367, lng: 17.873 },
  { name: "Spånga", lat: 59.385, lng: 17.903 },
  { name: "Järfälla", lat: 59.408, lng: 17.836 },
  { name: "Sollentuna", lat: 59.428, lng: 17.951 },
  { name: "Upplands Väsby", lat: 59.519, lng: 17.910 },
  { name: "Solna", lat: 59.360, lng: 17.998 },
  { name: "Sundbyberg", lat: 59.361, lng: 17.971 },
  // Stockholm — north / northeast
  { name: "Täby", lat: 59.444, lng: 18.067 },
  { name: "Vallentuna", lat: 59.535, lng: 18.078 },
  { name: "Danderyd", lat: 59.404, lng: 18.038 },
  { name: "Åkersberga", lat: 59.480, lng: 18.300 },
  { name: "Norrtälje", lat: 59.756, lng: 18.700 },
  { name: "Märsta", lat: 59.625, lng: 17.852 },
  { name: "Sigtuna", lat: 59.617, lng: 17.722 },
  // Stockholm — central + east (islands)
  { name: "Stockholm central", lat: 59.330, lng: 18.067 },
  { name: "Lidingö", lat: 59.366, lng: 18.130 },
  { name: "Nacka", lat: 59.310, lng: 18.165 },
  { name: "Saltsjö-Boo", lat: 59.323, lng: 18.243 },
  { name: "Vaxholm", lat: 59.402, lng: 18.348 },
  // Stockholm — south
  { name: "Tyresö", lat: 59.245, lng: 18.225 },
  { name: "Haninge", lat: 59.169, lng: 18.144 },
  { name: "Handen", lat: 59.169, lng: 18.140 },
  { name: "Huddinge", lat: 59.237, lng: 17.982 },
  { name: "Skärholmen", lat: 59.276, lng: 17.907 },
  { name: "Bandhagen", lat: 59.265, lng: 18.054 },
  { name: "Botkyrka", lat: 59.193, lng: 17.834 },
  { name: "Salem", lat: 59.198, lng: 17.778 },
  { name: "Södertälje", lat: 59.196, lng: 17.625 },
  { name: "Nykvarn", lat: 59.180, lng: 17.418 },
  // Mälardalen / Uppsala län
  { name: "Bålsta", lat: 59.567, lng: 17.524 },
  { name: "Knivsta", lat: 59.725, lng: 17.788 },
  { name: "Uppsala", lat: 59.858, lng: 17.638 },
  { name: "Enköping", lat: 59.636, lng: 17.077 },
  { name: "Strängnäs", lat: 59.378, lng: 17.030 },
  { name: "Eskilstuna", lat: 59.371, lng: 16.510 },
  { name: "Nyköping", lat: 58.753, lng: 17.008 },
];

import { haversineKm } from "./cluster";

const SEPARATOR = " · ";
const SINGLE_DOMINANT_THRESHOLD = 0.7;
const MULTI_DOMINANT_THRESHOLD = 0.8;

export function labelForCentroid(lat: number, lng: number): string {
  let bestName = "Stockholm region";
  let bestD = Infinity;
  for (const r of REGIONS) {
    const d = haversineKm({ lat, lng }, { lat: r.lat, lng: r.lng });
    if (d < bestD) {
      bestD = d;
      bestName = r.name;
    }
  }
  // If the centroid is far from every known town, fall back to a less
  // specific tag than the closest one — picking "Bromma" for a centroid
  // 80 km away would be misleading.
  if (bestD > 25) return "Stockholm region";
  return bestName;
}

export type LabelStop = {
  city: string | null;
  lat: number;
  lng: number;
};

/**
 * Stop-aware route name. Tallies city across the final stops and picks a
 * dominant city / pair / triple, falling back to the centroid label when city
 * data is missing on most stops.
 */
export function labelForStops(
  stops: LabelStop[],
  fallbackLat: number,
  fallbackLng: number,
): string {
  if (stops.length === 0) return labelForCentroid(fallbackLat, fallbackLng);

  // Tally non-blank cities (case-insensitive, trimmed).
  const counts = new Map<string, { count: number; display: string }>();
  let totalWithCity = 0;
  for (const s of stops) {
    if (!s.city) continue;
    const trimmed = s.city.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { count: 1, display: trimmed });
    totalWithCity++;
  }

  if (totalWithCity === 0) return labelForCentroid(fallbackLat, fallbackLng);
  // If most stops are missing a city, the tally isn't representative —
  // fall back to centroid mapping.
  if (totalWithCity < stops.length / 2) {
    return labelForCentroid(fallbackLat, fallbackLng);
  }

  const sorted = Array.from(counts.values()).sort((a, b) => b.count - a.count);
  const total = stops.length;

  // 1 city ≥ 70% share → just that city.
  if (sorted[0].count / total >= SINGLE_DOMINANT_THRESHOLD) {
    return sorted[0].display;
  }

  // 2 cities together ≥ 80% → join them.
  if (sorted.length >= 2 && (sorted[0].count + sorted[1].count) / total >= MULTI_DOMINANT_THRESHOLD) {
    return `${sorted[0].display}${SEPARATOR}${sorted[1].display}`;
  }

  // 3 cities together ≥ 80% → join all three.
  if (
    sorted.length >= 3 &&
    (sorted[0].count + sorted[1].count + sorted[2].count) / total >= MULTI_DOMINANT_THRESHOLD
  ) {
    return `${sorted[0].display}${SEPARATOR}${sorted[1].display}${SEPARATOR}${sorted[2].display}`;
  }

  // Very mixed — top 2 + ellipsis.
  if (sorted.length >= 2) {
    return `${sorted[0].display}${SEPARATOR}${sorted[1].display} ...`;
  }
  return `${sorted[0].display} ...`;
}

// Map a cluster centroid to a Swedish municipality / district label.
// Finer-grained than cardinal "Stockholm North/South" labels so 10 generated
// clusters don't end up with 3 identical names. Each entry's coordinate is
// the approximate town center; we pick the closest entry to the centroid.
// Phase 5 replaces this with a stop-aware label derived from the actual
// cities the route visits.

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

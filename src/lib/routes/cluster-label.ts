// Map a cluster centroid to a coarse Swedish region label.
// Falls back to "Stockholm region" if no match — this is just a UI hint, not data.

const REGIONS: { name: string; lat: number; lng: number }[] = [
  { name: "Stockholm North", lat: 59.45, lng: 17.95 },
  { name: "Stockholm South", lat: 59.18, lng: 18.02 },
  { name: "Stockholm West", lat: 59.36, lng: 17.78 },
  { name: "Stockholm East", lat: 59.32, lng: 18.20 },
  { name: "Uppsala", lat: 59.86, lng: 17.64 },
  { name: "Södertälje", lat: 59.20, lng: 17.62 },
  { name: "Mälardalen West", lat: 59.42, lng: 17.40 },
  { name: "Norrtälje", lat: 59.76, lng: 18.70 },
  { name: "Nyköping", lat: 58.75, lng: 17.00 },
  { name: "Enköping", lat: 59.63, lng: 17.08 },
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
  return bestName;
}

// k-means clustering with k-means++ init, Haversine distance, ≤30 iterations.
// Pure JS, no dependencies.

export type Point<T> = { id: T; lat: number; lng: number };
export type Cluster<T> = {
  centroidLat: number;
  centroidLng: number;
  points: Point<T>[];
};

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function cluster<T>(
  points: Point<T>[],
  k: number,
  opts: { maxIterations?: number; rng?: () => number } = {},
): Cluster<T>[] {
  const maxIterations = opts.maxIterations ?? 30;
  const rng = opts.rng ?? Math.random;

  if (points.length === 0) return [];
  const effectiveK = Math.min(k, points.length);

  // k-means++ initialization
  const centroids: { lat: number; lng: number }[] = [];
  centroids.push({ lat: points[Math.floor(rng() * points.length)].lat, lng: points[Math.floor(rng() * points.length)].lng });

  while (centroids.length < effectiveK) {
    const dists = points.map((p) => {
      let min = Infinity;
      for (const c of centroids) {
        const d = haversineKm(p, c);
        if (d < min) min = d;
      }
      return min * min; // squared distance for k-means++ weighting
    });
    const total = dists.reduce((s, d) => s + d, 0);
    if (total === 0) {
      // duplicate points; just pick anything
      const i = Math.floor(rng() * points.length);
      centroids.push({ lat: points[i].lat, lng: points[i].lng });
      continue;
    }
    const target = rng() * total;
    let cum = 0;
    let pickedIdx = points.length - 1;
    for (let i = 0; i < points.length; i++) {
      cum += dists[i];
      if (cum >= target) {
        pickedIdx = i;
        break;
      }
    }
    centroids.push({ lat: points[pickedIdx].lat, lng: points[pickedIdx].lng });
  }

  let assignments = new Array<number>(points.length).fill(0);
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;

    // Assign
    for (let i = 0; i < points.length; i++) {
      let bestC = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = haversineKm(points[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      if (assignments[i] !== bestC) {
        assignments[i] = bestC;
        changed = true;
      }
    }

    // Recompute centroids
    const sums = centroids.map(() => ({ lat: 0, lng: 0, count: 0 }));
    for (let i = 0; i < points.length; i++) {
      const c = assignments[i];
      sums[c].lat += points[i].lat;
      sums[c].lng += points[i].lng;
      sums[c].count += 1;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c].count > 0) {
        centroids[c] = { lat: sums[c].lat / sums[c].count, lng: sums[c].lng / sums[c].count };
      }
    }

    if (!changed) break;
  }

  // Build output
  const buckets: Cluster<T>[] = centroids.map((c) => ({
    centroidLat: c.lat,
    centroidLng: c.lng,
    points: [],
  }));
  for (let i = 0; i < points.length; i++) {
    buckets[assignments[i]].points.push(points[i]);
  }

  return buckets.filter((b) => b.points.length > 0);
}

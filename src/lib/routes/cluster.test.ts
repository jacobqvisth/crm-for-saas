import { describe, expect, it } from "vitest";
import { cluster, haversineKm } from "./cluster";

// Deterministic RNG so k-means++ initialization is reproducible.
function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineKm({ lat: 59.33, lng: 18.07 }, { lat: 59.33, lng: 18.07 })).toBeCloseTo(0, 5);
  });

  it("Stockholm → Uppsala is roughly 65 km", () => {
    const d = haversineKm({ lat: 59.3293, lng: 18.0686 }, { lat: 59.86, lng: 17.64 });
    expect(d).toBeGreaterThan(60);
    expect(d).toBeLessThan(75);
  });
});

describe("cluster", () => {
  it("returns empty array for empty input", () => {
    expect(cluster([], 5)).toEqual([]);
  });

  it("produces at most k clusters", () => {
    const rng = seededRng(42);
    const points = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      lat: 59.3 + (rng() - 0.5) * 0.5,
      lng: 18.0 + (rng() - 0.5) * 0.5,
    }));
    const clusters = cluster(points, 5, { rng: seededRng(7) });
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters.length).toBeLessThanOrEqual(5);
    // All input points are accounted for
    const totalAssigned = clusters.reduce((s, c) => s + c.points.length, 0);
    expect(totalAssigned).toBe(50);
  });

  it("separates two distinct geographic groups", () => {
    const stockholm = Array.from({ length: 20 }, (_, i) => ({
      id: `s-${i}`,
      lat: 59.33 + (i % 5) * 0.005,
      lng: 18.07 + Math.floor(i / 5) * 0.005,
    }));
    const goteborg = Array.from({ length: 20 }, (_, i) => ({
      id: `g-${i}`,
      lat: 57.71 + (i % 5) * 0.005,
      lng: 11.97 + Math.floor(i / 5) * 0.005,
    }));
    const clusters = cluster([...stockholm, ...goteborg], 2, { rng: seededRng(123) });
    expect(clusters.length).toBe(2);
    // Each cluster should be entirely one group
    for (const c of clusters) {
      const ids = c.points.map((p) => String(p.id));
      const allS = ids.every((id) => id.startsWith("s-"));
      const allG = ids.every((id) => id.startsWith("g-"));
      expect(allS || allG).toBe(true);
    }
  });
});

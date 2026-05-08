import { describe, expect, it } from "vitest";
import { rankClusters, type ClusterStop } from "./cluster-rank";

const NOW = new Date("2026-05-08T12:00:00Z");

function stop(overrides: Partial<ClusterStop> = {}): ClusterStop {
  return {
    companyId: crypto.randomUUID(),
    lat: 59.33,
    lng: 18.07,
    activatedAt: null,
    rating: null,
    lastVisitedAt: null,
    lastEmailedAt: null,
    ...overrides,
  };
}

describe("rankClusters", () => {
  it("ranks high-quality, fresh, lapsed cluster above stale, no-data cluster", () => {
    const A = {
      centroidLat: 59.33,
      centroidLng: 18.07,
      stops: [
        stop({ lat: 59.33, lng: 18.07, activatedAt: NOW.toISOString(), rating: 4.5, lastVisitedAt: null }),
        stop({ lat: 59.33, lng: 18.08, activatedAt: NOW.toISOString(), rating: 4.7, lastVisitedAt: null }),
        stop({ lat: 59.34, lng: 18.07, activatedAt: NOW.toISOString(), rating: 4.6, lastVisitedAt: null }),
        stop({ lat: 59.34, lng: 18.08, activatedAt: NOW.toISOString(), rating: 4.8, lastVisitedAt: null }),
      ],
    };
    const B = {
      centroidLat: 59.20,
      centroidLng: 18.20,
      stops: [
        // Visited yesterday, no rating, no activation, 50 km between extremes
        stop({ lat: 59.20, lng: 18.20, activatedAt: null, rating: null, lastVisitedAt: new Date(NOW.getTime() - 86_400_000).toISOString() }),
        stop({ lat: 59.21, lng: 18.21, activatedAt: null, rating: null, lastVisitedAt: new Date(NOW.getTime() - 86_400_000).toISOString() }),
        stop({ lat: 59.22, lng: 18.22, activatedAt: null, rating: null, lastVisitedAt: new Date(NOW.getTime() - 86_400_000).toISOString() }),
        stop({ lat: 59.60, lng: 18.50, activatedAt: null, rating: null, lastVisitedAt: new Date(NOW.getTime() - 86_400_000).toISOString() }),
      ],
    };

    const ranked = rankClusters([B, A], { now: NOW });
    expect(ranked[0].centroidLat).toBe(A.centroidLat);
    expect(ranked[1].centroidLat).toBe(B.centroidLat);
    expect(ranked[0].totalScore).toBeGreaterThan(ranked[1].totalScore);
  });

  it("penalizes outreach restraint when most stops were emailed yesterday", () => {
    const fresh = {
      centroidLat: 59.33,
      centroidLng: 18.07,
      stops: [
        stop({ lastEmailedAt: null, rating: null }),
        stop({ lastEmailedAt: null, rating: null }),
        stop({ lastEmailedAt: null, rating: null }),
        stop({ lastEmailedAt: null, rating: null }),
      ],
    };
    const justBlasted = {
      centroidLat: 59.33,
      centroidLng: 18.07,
      stops: [
        stop({ lastEmailedAt: new Date(NOW.getTime() - 86_400_000).toISOString(), rating: null }),
        stop({ lastEmailedAt: new Date(NOW.getTime() - 86_400_000).toISOString(), rating: null }),
        stop({ lastEmailedAt: new Date(NOW.getTime() - 86_400_000).toISOString(), rating: null }),
        stop({ lastEmailedAt: new Date(NOW.getTime() - 86_400_000).toISOString(), rating: null }),
      ],
    };
    const ranked = rankClusters([justBlasted, fresh], { now: NOW });
    expect(ranked[0]).toBe(rankedSame(ranked, fresh.centroidLat));
    expect(ranked[0].signals.outreachRestraint).toBeGreaterThan(ranked[1].signals.outreachRestraint);
  });

  it("uses NULL-rating half-credit at the cluster layer", () => {
    const allHighRated = {
      centroidLat: 59.33,
      centroidLng: 18.07,
      stops: [stop({ rating: 4.5 }), stop({ rating: 4.5 }), stop({ rating: 4.5 }), stop({ rating: 4.5 })],
    };
    const allNullRated = {
      centroidLat: 59.33,
      centroidLng: 18.07,
      stops: [stop({ rating: null }), stop({ rating: null }), stop({ rating: null }), stop({ rating: null })],
    };
    const ranked = rankClusters([allHighRated, allNullRated], { now: NOW });
    expect(ranked[0].signals.qualityDensity).toBe(1);
    expect(ranked[1].signals.qualityDensity).toBe(0.5);
  });
});

function rankedSame<T extends { centroidLat: number }>(arr: T[], lat: number): T {
  const r = arr.find((c) => c.centroidLat === lat);
  if (!r) throw new Error("not found");
  return r;
}

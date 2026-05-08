import { describe, expect, it } from "vitest";
import { scoreStops, type CandidateStop } from "./stop-score";

const NOW = new Date("2026-05-08T12:00:00Z");
const CENTROID = { lat: 59.33, lng: 18.07 };

function stop(overrides: Partial<CandidateStop> = {}): CandidateStop {
  return {
    companyId: crypto.randomUUID(),
    lat: 59.33,
    lng: 18.07,
    activatedAt: null,
    rating: null,
    hasSendableEmail: false,
    hasRecentPositiveEngagement: false,
    lastVisitedAt: null,
    ...overrides,
  };
}

describe("scoreStops", () => {
  it("ranks lapsed + rating-4 + recent reply above cold + lower-rating + no engagement", () => {
    const lapsedHighEngaged = stop({
      activatedAt: NOW.toISOString(),
      rating: 4.5,
      hasRecentPositiveEngagement: true,
      hasSendableEmail: true,
    });
    const coldQuieter = stop({
      activatedAt: null,
      rating: 4.0,
      hasRecentPositiveEngagement: false,
      hasSendableEmail: true,
    });
    const ranked = scoreStops([coldQuieter, lapsedHighEngaged], CENTROID, { now: NOW });
    expect(ranked[0].companyId).toBe(lapsedHighEngaged.companyId);
    expect(ranked[1].companyId).toBe(coldQuieter.companyId);
  });

  it("'visited 5 days ago' scores below 'never visited' with all else equal", () => {
    const visitedRecently = stop({
      lastVisitedAt: new Date(NOW.getTime() - 5 * 86_400_000).toISOString(),
    });
    const neverVisited = stop({
      lastVisitedAt: null,
    });
    const ranked = scoreStops([visitedRecently, neverVisited], CENTROID, { now: NOW });
    expect(ranked[0].companyId).toBe(neverVisited.companyId);
    expect(ranked[1].companyId).toBe(visitedRecently.companyId);
  });
});

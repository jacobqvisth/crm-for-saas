// Pure stop-scorer — no DB. Phase 5.
//
// Per-stop bonuses + a long-since-last-visit ramp + a mild distance-from-centroid
// penalty. Sort descending and take MAX_STOPS_PER_ROUTE before passing to the
// Routes API.

import { haversineKm } from "./cluster";

const FRESHNESS_CAP_DAYS = 365;

export type CandidateStop = {
  companyId: string;
  lat: number;
  lng: number;
  activatedAt: string | null;
  rating: number | null;
  /** True if the company has at least one contact with email_status in ('valid','catch_all'). */
  hasSendableEmail: boolean;
  /** True if there's any open/reply/click event on this company's contacts in the last 30 days. */
  hasRecentPositiveEngagement: boolean;
  lastVisitedAt: string | null;
};

export type ScoredStop = CandidateStop & {
  score: number;
  /** Distance to centroid at scoring time, kept for tiebreak/diagnostics. */
  distanceKm: number;
};

const DISTANCE_PENALTY_MAX_KM = 25;

export function scoreStops(
  stops: CandidateStop[],
  centroid: { lat: number; lng: number },
  opts: { now?: Date } = {},
): ScoredStop[] {
  const now = opts.now ?? new Date();

  const out: ScoredStop[] = stops.map((s) => {
    let score = 0;

    if (s.activatedAt != null) score += 20;
    if (s.rating != null && s.rating >= 4) score += 15;
    if (s.hasSendableEmail) score += 10;
    if (s.hasRecentPositiveEngagement) score += 15;

    const days = s.lastVisitedAt
      ? Math.min(FRESHNESS_CAP_DAYS, daysBetween(s.lastVisitedAt, now))
      : FRESHNESS_CAP_DAYS;
    score += (days / FRESHNESS_CAP_DAYS) * 15;

    const distanceKm = haversineKm(s, centroid);
    const distancePenalty =
      Math.min(DISTANCE_PENALTY_MAX_KM, distanceKm) / DISTANCE_PENALTY_MAX_KM;
    score -= distancePenalty * 10;

    return { ...s, score, distanceKm };
  });

  return out.sort((a, b) => b.score - a.score);
}

function daysBetween(iso: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

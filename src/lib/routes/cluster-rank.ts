// Pure cluster scorer — no DB. Phase 5.
//
// Scores each candidate cluster on five signals, sums them with weights
// totalling 100, and returns the clusters ranked by total score (highest first).
// Lapsed-density weight is intentionally light because no companies have
// `activated_at` set yet (the signal is flat zero across the workspace) — see
// the saved prompt's clarifications for context. Bump the weight back up when
// activation data starts landing.

import { haversineKm } from "./cluster";

export const CLUSTER_RANK_WEIGHTS = {
  lapsedDensity: 5,
  freshness: 30,
  qualityDensity: 30,
  compactness: 20,
  outreachRestraint: 15,
} as const;

const FRESHNESS_CAP_DAYS = 365;
const OUTREACH_CAP_DAYS = 90;

export type ClusterStop = {
  companyId: string;
  lat: number;
  lng: number;
  /** TIMESTAMPTZ | null — never null when activated. */
  activatedAt: string | null;
  /** Google Maps rating, 0–5, null if unknown. */
  rating: number | null;
  /** ISO timestamp of most-recent visit, null if never visited. */
  lastVisitedAt: string | null;
  /** ISO timestamp of most-recent email sent to this company in last 90 days, null if none. */
  lastEmailedAt: string | null;
};

export type ScoredCluster = {
  centroidLat: number;
  centroidLng: number;
  stops: ClusterStop[];
  signals: {
    lapsedDensity: number;
    freshness: number;
    qualityDensity: number;
    compactness: number;
    outreachRestraint: number;
  };
  totalScore: number;
};

export function rankClusters(
  clusters: { centroidLat: number; centroidLng: number; stops: ClusterStop[] }[],
  opts: { now?: Date; weights?: typeof CLUSTER_RANK_WEIGHTS } = {},
): ScoredCluster[] {
  const now = opts.now ?? new Date();
  const weights = opts.weights ?? CLUSTER_RANK_WEIGHTS;

  const scored = clusters.map((c) => {
    const total = c.stops.length;
    if (total === 0) {
      return {
        ...c,
        signals: {
          lapsedDensity: 0,
          freshness: 0,
          qualityDensity: 0,
          compactness: 0,
          outreachRestraint: 0,
        },
        totalScore: 0,
      };
    }

    // Lapsed density — fraction of cluster that has activated_at set.
    const lapsedCount = c.stops.filter((s) => s.activatedAt != null).length;
    const lapsedDensity = lapsedCount / total;

    // Freshness — mean days since last visit, capped, normalized to 0–1.
    let freshSum = 0;
    for (const s of c.stops) {
      const d = s.lastVisitedAt
        ? Math.min(FRESHNESS_CAP_DAYS, daysBetween(s.lastVisitedAt, now))
        : FRESHNESS_CAP_DAYS;
      freshSum += d;
    }
    const freshness = freshSum / total / FRESHNESS_CAP_DAYS;

    // Quality density — count_4plus + 0.5 * count_null (NULL contributes
    // half-credit, since `companies.rating` is mostly null today).
    let count4plus = 0;
    let countNull = 0;
    for (const s of c.stops) {
      if (s.rating == null) countNull++;
      else if (s.rating >= 4) count4plus++;
    }
    const qualityDensity = (count4plus + 0.5 * countNull) / total;

    // Compactness — 1 / (max pairwise km + 1), no further normalization
    // since the formula already lives in 0–1. Single-stop cluster scores 1.
    let maxPair = 0;
    for (let i = 0; i < c.stops.length; i++) {
      for (let j = i + 1; j < c.stops.length; j++) {
        const d = haversineKm(c.stops[i], c.stops[j]);
        if (d > maxPair) maxPair = d;
      }
    }
    const compactness = 1 / (maxPair + 1);

    // Outreach restraint — mean days since last email per shop, capped 90.
    // No email history → 90 (full credit, fully rested).
    let restraintSum = 0;
    for (const s of c.stops) {
      const d = s.lastEmailedAt
        ? Math.min(OUTREACH_CAP_DAYS, daysBetween(s.lastEmailedAt, now))
        : OUTREACH_CAP_DAYS;
      restraintSum += d;
    }
    const outreachRestraint = restraintSum / total / OUTREACH_CAP_DAYS;

    const totalScore =
      lapsedDensity * weights.lapsedDensity +
      freshness * weights.freshness +
      qualityDensity * weights.qualityDensity +
      compactness * weights.compactness +
      outreachRestraint * weights.outreachRestraint;

    return {
      ...c,
      signals: {
        lapsedDensity,
        freshness,
        qualityDensity,
        compactness,
        outreachRestraint,
      },
      totalScore,
    };
  });

  return scored.sort((a, b) => b.totalScore - a.totalScore);
}

function daysBetween(isoOrDate: string | Date, now: Date): number {
  const t = typeof isoOrDate === "string" ? new Date(isoOrDate).getTime() : isoOrDate.getTime();
  return Math.max(0, (now.getTime() - t) / 86_400_000);
}

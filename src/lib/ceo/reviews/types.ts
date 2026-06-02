// Shared shapes for the review sync sources (Trustpilot today, Google
// Business Profile once its API access is approved). A connector fetches a
// platform and returns a normalized snapshot; src/lib/ceo/reviews/sync.ts
// writes it into dashboard_review_snapshots + dashboard_reviews.

export type NormalizedReview = {
  /** Stable per-platform id — used as dashboard_reviews.external_id. */
  externalId: string;
  rating: number | null;
  title: string | null;
  body: string | null;
  authorName: string | null;
  authorCompany: string | null;
  reviewUrl: string | null;
  /** ISO timestamp. */
  reviewedAt: string | null;
  responseText: string | null;
};

export type ReviewSourceSnapshot = {
  /** Aggregate star rating, 0–5 (null if the platform didn't return one). */
  rating: number | null;
  reviewCount: number;
  /** Free-text context stored on the snapshot row (e.g. TrustScore). */
  note?: string | null;
  reviews: NormalizedReview[];
};

export type ReviewSourceFetchResult =
  | { ok: true; skipped?: false; snapshot: ReviewSourceSnapshot }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import {
  REVIEW_PLATFORMS,
  REVIEW_PLATFORM_SLUGS,
  type ReviewIntegrationType,
  type ReviewPlatform,
} from "@/lib/ceo/reviews/platforms";
import { TABLES } from "@/lib/ceo/tables";

export type PlatformScorecard = {
  slug: string;
  name: string;
  profileUrl: string;
  integrationType: ReviewIntegrationType;
  category: ReviewPlatform["category"];
  color: string;
  note: string;
  rating: number | null;
  reviewCount: number;
  source: string | null;
  capturedAt: string | null;
  ratingDelta: number | null;
  countDelta: number | null;
  hasData: boolean;
};

export type ReviewTrendPoint = {
  date: string;
  avgRating: number;
  totalReviews: number;
};

export type ReviewFeedItem = {
  id: string;
  platformSlug: string;
  platformName: string;
  rating: number | null;
  title: string | null;
  body: string | null;
  authorName: string | null;
  authorCompany: string | null;
  reviewUrl: string | null;
  reviewedAt: string | null;
  responseText: string | null;
  source: string;
};

export type ReviewsTotals = {
  avgRating: number | null;
  totalReviews: number;
  platformsTracked: number;
  platformsWithData: number;
};

export type ReviewsData = {
  generatedAt: string;
  scorecards: PlatformScorecard[];
  totals: ReviewsTotals;
  trend: ReviewTrendPoint[];
  recentReviews: ReviewFeedItem[];
  platformFilter: string;
  error?: string;
};

export function normalizeReviewPlatformFilter(
  value: string | string[] | undefined,
): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && REVIEW_PLATFORM_SLUGS.includes(candidate)
    ? candidate
    : "all";
}

type SnapshotRow = {
  platform_slug: string | null;
  captured_at: string | null;
  rating: number | string | null;
  review_count: number | string | null;
  source: string | null;
};

type ReviewRow = {
  id: number | string;
  platform_slug: string | null;
  rating: number | string | null;
  title: string | null;
  body: string | null;
  author_name: string | null;
  author_company: string | null;
  review_url: string | null;
  reviewed_at: string | null;
  response_text: string | null;
  source: string | null;
};

function toNumber(value: number | string | null): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toNullableRating(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function emptyData(platformFilter: string, error?: string): ReviewsData {
  return {
    generatedAt: new Date().toISOString(),
    scorecards: REVIEW_PLATFORMS.map((platform) => ({
      slug: platform.slug,
      name: platform.name,
      profileUrl: platform.profileUrl,
      integrationType: platform.integrationType,
      category: platform.category,
      color: platform.color,
      note: platform.note,
      rating: null,
      reviewCount: 0,
      source: null,
      capturedAt: null,
      ratingDelta: null,
      countDelta: null,
      hasData: false,
    })),
    totals: {
      avgRating: null,
      totalReviews: 0,
      platformsTracked: REVIEW_PLATFORMS.length,
      platformsWithData: 0,
    },
    trend: [],
    recentReviews: [],
    platformFilter,
    error,
  };
}

/**
 * Weighted average rating across platforms that have both a rating and at
 * least one review — bigger review pools count more. Falls back to a simple
 * mean of ratings when no counts are present.
 */
function weightedAverage(
  entries: Array<{ rating: number | null; count: number }>,
): number | null {
  const rated = entries.filter((e) => e.rating != null);
  if (rated.length === 0) return null;
  const weightedTotal = rated.reduce((sum, e) => sum + e.count, 0);
  if (weightedTotal > 0) {
    const num = rated.reduce(
      (sum, e) => sum + (e.rating as number) * e.count,
      0,
    );
    return num / weightedTotal;
  }
  const mean =
    rated.reduce((sum, e) => sum + (e.rating as number), 0) / rated.length;
  return mean;
}

export async function getReviewsData(
  platformFilter: string,
): Promise<ReviewsData> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return emptyData(platformFilter, "Supabase is not configured.");
  }

  const [snapshotsResult, reviewsResult] = await Promise.all([
    supabase
      .from(TABLES.reviewSnapshots)
      .select("platform_slug,captured_at,rating,review_count,source")
      .order("captured_at", { ascending: true }),
    (() => {
      let q = supabase
        .from(TABLES.reviews)
        .select(
          "id,platform_slug,rating,title,body,author_name,author_company,review_url,reviewed_at,response_text,source",
        )
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .limit(60);
      if (platformFilter !== "all") {
        q = q.eq("platform_slug", platformFilter);
      }
      return q;
    })(),
  ]);

  if (snapshotsResult.error) {
    return emptyData(platformFilter, snapshotsResult.error.message);
  }

  const snapshots = (snapshotsResult.data ?? []) as SnapshotRow[];

  // Group snapshots per platform (already sorted ascending by captured_at).
  const byPlatform = new Map<string, SnapshotRow[]>();
  for (const row of snapshots) {
    const slug = row.platform_slug ?? "";
    if (!byPlatform.has(slug)) byPlatform.set(slug, []);
    byPlatform.get(slug)!.push(row);
  }

  const scorecards: PlatformScorecard[] = REVIEW_PLATFORMS.map((platform) => {
    const history = byPlatform.get(platform.slug) ?? [];
    const latest = history.at(-1) ?? null;
    const previous = history.length > 1 ? history.at(-2)! : null;

    const rating = latest ? toNullableRating(latest.rating) : null;
    const reviewCount = latest ? toNumber(latest.review_count) : 0;
    const prevRating = previous ? toNullableRating(previous.rating) : null;
    const prevCount = previous ? toNumber(previous.review_count) : null;

    return {
      slug: platform.slug,
      name: platform.name,
      profileUrl: platform.profileUrl,
      integrationType: platform.integrationType,
      category: platform.category,
      color: platform.color,
      note: platform.note,
      rating,
      reviewCount,
      source: latest?.source ?? null,
      capturedAt: latest?.captured_at ?? null,
      ratingDelta:
        rating != null && prevRating != null ? rating - prevRating : null,
      countDelta:
        prevCount != null ? reviewCount - prevCount : null,
      hasData: latest != null,
    };
  });

  const totals: ReviewsTotals = {
    avgRating: weightedAverage(
      scorecards.map((s) => ({ rating: s.rating, count: s.reviewCount })),
    ),
    totalReviews: scorecards.reduce((sum, s) => sum + s.reviewCount, 0),
    platformsTracked: REVIEW_PLATFORMS.length,
    platformsWithData: scorecards.filter((s) => s.hasData).length,
  };

  // Company-wide trend: at each distinct snapshot date, carry forward the
  // most recent known snapshot per platform and aggregate. Gives a sensible
  // cumulative review count + weighted rating over time even though platforms
  // are entered on different dates.
  const distinctDates = [...new Set(snapshots.map((s) => s.captured_at ?? ""))]
    .filter(Boolean)
    .sort();

  const trend: ReviewTrendPoint[] = distinctDates.map((date) => {
    const entries = REVIEW_PLATFORMS.map((platform) => {
      const history = byPlatform.get(platform.slug) ?? [];
      let asOf: SnapshotRow | null = null;
      for (const row of history) {
        if ((row.captured_at ?? "") <= date) asOf = row;
        else break;
      }
      return {
        rating: asOf ? toNullableRating(asOf.rating) : null,
        count: asOf ? toNumber(asOf.review_count) : 0,
      };
    });
    return {
      date,
      avgRating: weightedAverage(entries) ?? 0,
      totalReviews: entries.reduce((sum, e) => sum + e.count, 0),
    };
  });

  const reviewRows = (reviewsResult.data ?? []) as ReviewRow[];
  const platformName = new Map(REVIEW_PLATFORMS.map((p) => [p.slug, p.name]));
  const recentReviews: ReviewFeedItem[] = reviewRows.map((row) => ({
    id: String(row.id),
    platformSlug: row.platform_slug ?? "",
    platformName: platformName.get(row.platform_slug ?? "") ?? "Unknown",
    rating: toNullableRating(row.rating),
    title: row.title,
    body: row.body,
    authorName: row.author_name,
    authorCompany: row.author_company,
    reviewUrl: row.review_url,
    reviewedAt: row.reviewed_at,
    responseText: row.response_text,
    source: row.source ?? "manual",
  }));

  return {
    generatedAt: new Date().toISOString(),
    scorecards,
    totals,
    trend,
    recentReviews,
    platformFilter,
  };
}

// Orchestrates the review sync: for each source connector, fetch the latest
// snapshot and upsert it into dashboard_review_snapshots (+ individual reviews
// into dashboard_reviews). Driven by /api/cron/sync-reviews. Idempotent —
// snapshots are unique on (platform_slug, captured_at), reviews on
// (platform_slug, external_id).

import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { fetchGoogleBusinessReviews } from "@/lib/ceo/reviews/sources/google-business";
import { fetchTrustpilotReviews } from "@/lib/ceo/reviews/sources/trustpilot";
import type { ReviewSourceFetchResult } from "@/lib/ceo/reviews/types";

const REVIEW_UPSERT_BATCH = 200;

type SourceDef = {
  slug: string;
  fetch: () => Promise<ReviewSourceFetchResult>;
};

const SOURCES: SourceDef[] = [
  { slug: "trustpilot", fetch: fetchTrustpilotReviews },
  { slug: "google-business", fetch: fetchGoogleBusinessReviews },
];

export type SourceSyncResult = {
  source: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  rating?: number | null;
  reviewCount?: number;
  reviewsUpserted?: number;
  error?: string;
};

export type SyncReviewsResult = {
  ok: boolean;
  syncedAt: string;
  sources: SourceSyncResult[];
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function syncReviews(
  only?: string,
): Promise<SyncReviewsResult> {
  const syncedAt = new Date().toISOString();
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return {
      ok: false,
      syncedAt,
      sources: [
        { source: "all", ok: false, error: "Supabase is not configured." },
      ],
    };
  }

  const capturedAt = todayIsoDate();
  const targets = only ? SOURCES.filter((s) => s.slug === only) : SOURCES;
  if (only && targets.length === 0) {
    return {
      ok: false,
      syncedAt,
      sources: [{ source: only, ok: false, error: "Unknown source." }],
    };
  }

  const results: SourceSyncResult[] = [];

  for (const source of targets) {
    try {
      const fetched = await source.fetch();

      if (!fetched.ok) {
        results.push({ source: source.slug, ok: false, error: fetched.error });
        continue;
      }
      if (fetched.skipped) {
        results.push({
          source: source.slug,
          ok: true,
          skipped: true,
          reason: fetched.reason,
        });
        continue;
      }

      const { snapshot } = fetched;

      const { error: snapErr } = await supabase
        .from(TABLES.reviewSnapshots)
        .upsert(
          {
            platform_slug: source.slug,
            captured_at: capturedAt,
            rating: snapshot.rating,
            review_count: snapshot.reviewCount,
            source: "api",
            note: snapshot.note ?? null,
            entered_by: "cron",
          },
          { onConflict: "platform_slug,captured_at" },
        );
      if (snapErr) {
        results.push({ source: source.slug, ok: false, error: snapErr.message });
        continue;
      }

      let reviewsUpserted = 0;
      const rows = snapshot.reviews.map((r) => ({
        platform_slug: source.slug,
        external_id: r.externalId,
        rating: r.rating,
        title: r.title,
        body: r.body,
        author_name: r.authorName,
        author_company: r.authorCompany,
        review_url: r.reviewUrl,
        reviewed_at: r.reviewedAt,
        response_text: r.responseText,
        source: "api",
      }));
      for (const batch of chunk(rows, REVIEW_UPSERT_BATCH)) {
        const { error: revErr } = await supabase
          .from(TABLES.reviews)
          .upsert(batch, { onConflict: "platform_slug,external_id" });
        if (revErr) {
          results.push({
            source: source.slug,
            ok: false,
            error: revErr.message,
          });
          break;
        }
        reviewsUpserted += batch.length;
      }

      results.push({
        source: source.slug,
        ok: true,
        rating: snapshot.rating,
        reviewCount: snapshot.reviewCount,
        reviewsUpserted,
      });
    } catch (error) {
      results.push({
        source: source.slug,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: results.every((r) => r.ok),
    syncedAt,
    sources: results,
  };
}

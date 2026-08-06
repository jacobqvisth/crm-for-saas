import { ReviewsContent } from "@/components/reviews/reviews-content";
import {
  getReviewsData,
  normalizeReviewPlatformFilter,
} from "@/lib/ceo/data/reviews";

export const metadata = {
  title: "Reviews",
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Top-level section (was /dashboard/reviews until 2026-08-06). Promoted out of
// the analytics shell so reviews can grow its own sub-pages and settings.
//
// Deliberately does NOT call getDashboardData(): this page's only data source is
// getReviewsData(), and the old DashboardShell wrapper was paying for a full
// dashboard-metrics read purely to render a title and a range selector that
// nothing here consumed.
export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string | string[] }>;
}) {
  const params = await searchParams;
  const platformFilter = normalizeReviewPlatformFilter(params.platform);
  const reviews = await getReviewsData(platformFilter);
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Reviews</h1>
        <p className="mt-1 text-sm text-slate-500">
          Wrenchlane&apos;s rating and review count across every review platform
          we track, with a feed of individual reviews where a platform exposes
          them.
        </p>
      </header>

      <ReviewsContent data={reviews} todayIso={todayIso} />
    </div>
  );
}

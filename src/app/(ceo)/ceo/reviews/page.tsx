import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { ReviewsContent } from "@/components/ceo/reviews-content";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import {
  getReviewsData,
  normalizeReviewPlatformFilter,
} from "@/lib/ceo/data/reviews";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ReviewsPageProps = DashboardRoutePageProps & {
  searchParams: Promise<{
    range?: string | string[];
    platform?: string | string[];
  }>;
};

export default async function ReviewsPage({ searchParams }: ReviewsPageProps) {
  const params = await searchParams;
  const platformFilter = normalizeReviewPlatformFilter(params.platform);

  const [data, reviews] = await Promise.all([
    getDashboardData(params.range),
    getReviewsData(platformFilter),
  ]);

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <DashboardShell data={data} section="reviews">
      <ReviewsContent
        data={reviews}
        selectedRange={data.selectedRange}
        todayIso={todayIso}
      />
    </DashboardShell>
  );
}

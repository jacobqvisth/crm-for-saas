import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { ProductAnalyticsContent } from "@/components/ceo/product-analytics-content";
import { UpdateButton } from "@/components/ceo/update-button";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import {
  getProductAnalyticsData,
  PRODUCT_ANALYTICS_DEFAULT_RANGE_KEY,
} from "@/lib/ceo/data/product-analytics";
import { normalizeDashboardTimeRangeKey } from "@/lib/ceo/time-ranges";
import { refreshProductAnalyticsAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function ProductAnalyticsPanel({ rangeKey }: { rangeKey: string }) {
  const data = await getProductAnalyticsData(rangeKey);
  return <ProductAnalyticsContent data={data} />;
}

export default async function ProductAnalyticsPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const data = await getDashboardData(rangeKey);

  return (
    <DashboardShell
      data={data}
      section="product-analytics"
      defaultRangeKey={PRODUCT_ANALYTICS_DEFAULT_RANGE_KEY}
      headerSubtext={
        <>
          <span>Queried live from PostHog (EU) · cached 5 min</span>
          <form action={refreshProductAnalyticsAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <ProductAnalyticsPanel rangeKey={rangeKey} />
      </Suspense>
    </DashboardShell>
  );
}

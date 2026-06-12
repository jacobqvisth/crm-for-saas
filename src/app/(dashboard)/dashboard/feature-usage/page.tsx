import { Suspense } from "react";
import { FeatureUsageContent } from "@/components/ceo/feature-usage-content";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import {
  FEATURE_USAGE_DEFAULT_RANGE_KEY,
  getFeatureUsageData,
  normalizeFeatureUsageRangeKey,
} from "@/lib/ceo/data/feature-usage";
import { normalizeDashboardCountry } from "@/lib/ceo/countries";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import {
  formatStockholmTime,
  getCoreAppLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import { refreshFeatureUsageAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function FeatureUsagePanel({
  rangeKey,
  country,
}: {
  rangeKey: string;
  country: string | null;
}) {
  const data = await getFeatureUsageData(rangeKey, country);
  return <FeatureUsageContent data={data} />;
}

export default async function FeatureUsagePage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeFeatureUsageRangeKey(params.range);
  const country = normalizeDashboardCountry(params.country);

  const [data, lastSyncedAt] = await Promise.all([
    getDashboardData(rangeKey),
    getCoreAppLastSyncedAt(),
  ]);

  return (
    <DashboardShell
      data={data}
      section="feature-usage"
      defaultRangeKey={FEATURE_USAGE_DEFAULT_RANGE_KEY}
      headerSubtext={
        <>
          <span>
            Last updated {formatStockholmTime(lastSyncedAt)} (Stockholm)
          </span>
          <form action={refreshFeatureUsageAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <FeatureUsagePanel rangeKey={rangeKey} country={country} />
      </Suspense>
    </DashboardShell>
  );
}


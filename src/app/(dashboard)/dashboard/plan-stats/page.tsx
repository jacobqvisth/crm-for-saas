import { Suspense } from "react";
import { PlanStatsContent } from "@/components/ceo/plan-stats-content";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import {
  PLAN_STATS_DEFAULT_RANGE_KEY,
  getPlanStatsData,
  normalizePlanStatsRangeKey,
} from "@/lib/ceo/data/plan-stats";
import { normalizeDashboardCountry } from "@/lib/ceo/countries";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import {
  formatStockholmTime,
  getCoreAppLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import { refreshPlanStatsAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function PlanStatsPanel({
  rangeKey,
  country,
}: {
  rangeKey: string;
  country: string | null;
}) {
  const data = await getPlanStatsData(rangeKey, country);
  return <PlanStatsContent data={data} />;
}

export default async function PlanStatsPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizePlanStatsRangeKey(params.range);
  const country = normalizeDashboardCountry(params.country);

  const [data, lastSyncedAt] = await Promise.all([
    getDashboardData(rangeKey),
    getCoreAppLastSyncedAt(),
  ]);

  return (
    <DashboardShell
      data={data}
      section="plan-stats"
      defaultRangeKey={PLAN_STATS_DEFAULT_RANGE_KEY}
      headerSubtext={
        <>
          <span>
            Last updated {formatStockholmTime(lastSyncedAt)} (Stockholm)
          </span>
          <form action={refreshPlanStatsAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <PlanStatsPanel rangeKey={rangeKey} country={country} />
      </Suspense>
    </DashboardShell>
  );
}

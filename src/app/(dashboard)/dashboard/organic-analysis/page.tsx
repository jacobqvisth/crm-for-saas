import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { OrganicAnalysisContent } from "@/components/ceo/organic-analysis-content";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getOrganicAnalysisData } from "@/lib/ceo/data/organic-analysis";
import {
  formatRangeDateSpan,
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "@/lib/ceo/time-ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function OrganicAnalysisPanel({ rangeKey }: { rangeKey: string }) {
  const range = resolveDashboardTimeRange(
    normalizeDashboardTimeRangeKey(rangeKey),
  );
  const data = await getOrganicAnalysisData(range, formatRangeDateSpan(range));
  return <OrganicAnalysisContent data={data} />;
}

export default async function OrganicAnalysisPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);

  const data = await getDashboardData(params.range);

  return (
    <DashboardShell data={data} section="organic-analysis">
      <Suspense fallback={<CeoPanelSkeleton />}>
        <OrganicAnalysisPanel rangeKey={rangeKey} />
      </Suspense>
    </DashboardShell>
  );
}

import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { PilotStatsContent } from "@/components/ceo/pilot-stats-content";
import { getPilotStatsData } from "@/lib/ceo/data/pilot-stats";
import { normalizeDashboardTimeRangeKey } from "@/lib/ceo/time-ranges";

export const dynamic = "force-dynamic";

async function PilotStatsPanel() {
  const pilot = await getPilotStatsData();
  return <PilotStatsContent pilot={pilot} />;
}

export default async function PilotStatsPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);

  return (
    <DashboardShell rangeKey={rangeKey} section="pilot-stats">
      <Suspense fallback={<CeoPanelSkeleton />}>
        <PilotStatsPanel />
      </Suspense>
    </DashboardShell>
  );
}

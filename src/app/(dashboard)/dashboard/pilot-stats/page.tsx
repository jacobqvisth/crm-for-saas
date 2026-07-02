import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { PilotStatsContent } from "@/components/ceo/pilot-stats-content";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getPilotStatsData } from "@/lib/ceo/data/pilot-stats";

export const dynamic = "force-dynamic";

async function PilotStatsPanel() {
  const pilot = await getPilotStatsData();
  return <PilotStatsContent pilot={pilot} />;
}

export default async function PilotStatsPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const data = await getDashboardData(params.range);

  return (
    <DashboardShell data={data} section="pilot-stats">
      <Suspense fallback={<CeoPanelSkeleton />}>
        <PilotStatsPanel />
      </Suspense>
    </DashboardShell>
  );
}

import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { PilotStatsContent } from "@/components/ceo/pilot-stats-content";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getPilotStatsData } from "@/lib/ceo/data/pilot-stats";

export const dynamic = "force-dynamic";

export default async function PilotStatsPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const [data, pilot] = await Promise.all([
    getDashboardData(params.range),
    getPilotStatsData(),
  ]);

  return (
    <DashboardShell data={data} section="pilot-stats">
      <PilotStatsContent pilot={pilot} />
    </DashboardShell>
  );
}

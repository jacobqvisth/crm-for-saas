import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { DomainHealthContent } from "@/components/ceo/domain-health-content";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getDomainHealthData } from "@/lib/ceo/data/domain-health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function DomainHealthPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const [data, domainHealth] = await Promise.all([
    getDashboardData(params.range),
    getDomainHealthData(),
  ]);

  return (
    <DashboardShell data={data} section="domain-health">
      <DomainHealthContent data={domainHealth} />
    </DashboardShell>
  );
}

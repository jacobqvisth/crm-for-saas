import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { DomainHealthContent } from "@/components/ceo/domain-health-content";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getAllDomainHealthData } from "@/lib/ceo/data/domain-health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function DomainHealthPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const [data, domains] = await Promise.all([
    getDashboardData(params.range),
    getAllDomainHealthData(),
  ]);

  return (
    <DashboardShell data={data} section="domain-health">
      <div className="space-y-12">
        {domains.map((d) => (
          <DomainHealthContent key={d.domain} data={d} />
        ))}
      </div>
    </DashboardShell>
  );
}

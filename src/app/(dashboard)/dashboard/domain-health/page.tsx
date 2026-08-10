import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { DomainHealthContent } from "@/components/ceo/domain-health-content";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { getAllDomainHealthData } from "@/lib/ceo/data/domain-health";
import { normalizeDashboardTimeRangeKey } from "@/lib/ceo/time-ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function DomainHealthPanel() {
  const domains = await getAllDomainHealthData();
  return (
    <div className="space-y-12">
      {domains.map((d) => (
        <DomainHealthContent key={d.domain} data={d} />
      ))}
    </div>
  );
}

export default async function DomainHealthPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);

  return (
    <DashboardShell rangeKey={rangeKey} section="domain-health">
      <Suspense fallback={<CeoPanelSkeleton />}>
        <DomainHealthPanel />
      </Suspense>
    </DashboardShell>
  );
}

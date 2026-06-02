import { Suspense } from "react";
import {
  CtaClicksContent,
  CtaHostTabs,
} from "@/components/ceo/cta-clicks-content";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import {
  getCtaClicksData,
  normalizeCtaHost,
  type CtaClicksHostFilter,
} from "@/lib/ceo/data/cta-clicks";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import {
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "@/lib/ceo/time-ranges";
import { refreshCtaClicksAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type CtaClicksPageProps = DashboardRoutePageProps & {
  searchParams: Promise<{
    range?: string | string[];
    host?: string | string[];
  }>;
};

async function CtaClicksPanel({
  rangeKey,
  host,
}: {
  rangeKey: string;
  host: CtaClicksHostFilter;
}) {
  const cta = await getCtaClicksData(
    resolveDashboardTimeRange(normalizeDashboardTimeRangeKey(rangeKey)),
    host,
  );
  return <CtaClicksContent data={cta} />;
}

export default async function CtaClicksPage({
  searchParams,
}: CtaClicksPageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const host = normalizeCtaHost(params.host);

  const data = await getDashboardData(params.range);

  return (
    <DashboardShell
      data={data}
      section="cta-clicks"
      headerActions={<CtaHostTabs rangeKey={rangeKey} active={host} />}
      headerSubtext={
        <form action={refreshCtaClicksAction}>
          <UpdateButton />
        </form>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <CtaClicksPanel rangeKey={rangeKey} host={host} />
      </Suspense>
    </DashboardShell>
  );
}

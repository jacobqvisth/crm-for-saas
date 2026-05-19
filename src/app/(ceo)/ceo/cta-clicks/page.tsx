import {
  CtaClicksContent,
  CtaHostTabs,
} from "@/components/ceo/cta-clicks-content";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { UpdateButton } from "@/components/ceo/update-button";
import {
  getCtaClicksData,
  normalizeCtaHost,
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

export default async function CtaClicksPage({
  searchParams,
}: CtaClicksPageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const host = normalizeCtaHost(params.host);
  const resolvedRange = resolveDashboardTimeRange(rangeKey);

  const [data, cta] = await Promise.all([
    getDashboardData(params.range),
    getCtaClicksData(resolvedRange, host),
  ]);

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
      <CtaClicksContent data={cta} />
    </DashboardShell>
  );
}

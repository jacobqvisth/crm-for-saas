import { ConversionsContent } from "@/components/ceo/conversions-content";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { getConversionsData } from "@/lib/ceo/data/conversions";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import {
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "@/lib/ceo/time-ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ConversionsPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const resolvedRange = resolveDashboardTimeRange(rangeKey);
  const sinceIso = (resolvedRange.start ?? new Date(0)).toISOString();

  const [data, conversions] = await Promise.all([
    getDashboardData(params.range),
    getConversionsData(sinceIso),
  ]);

  return (
    <DashboardShell data={data} section="conversions">
      <ConversionsContent data={conversions} />
    </DashboardShell>
  );
}

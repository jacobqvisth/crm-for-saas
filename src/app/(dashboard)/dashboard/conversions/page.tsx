import { Suspense } from "react";
import { ConversionsContent } from "@/components/ceo/conversions-content";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { getConversionsData } from "@/lib/ceo/data/conversions";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import {
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "@/lib/ceo/time-ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function ConversionsPanel({ sinceIso }: { sinceIso: string }) {
  const conversions = await getConversionsData(sinceIso);
  return <ConversionsContent data={conversions} />;
}

export default async function ConversionsPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const resolvedRange = resolveDashboardTimeRange(rangeKey);
  const sinceIso = (resolvedRange.start ?? new Date(0)).toISOString();

  // Render the shell from the (cached) shared dashboard data, then stream the
  // RPC-backed conversions panel so the chrome paints first.
  const data = await getDashboardData(params.range);

  return (
    <DashboardShell data={data} section="conversions">
      <Suspense fallback={<CeoPanelSkeleton />}>
        <ConversionsPanel sinceIso={sinceIso} />
      </Suspense>
    </DashboardShell>
  );
}

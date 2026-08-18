import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { ValdemarContent } from "@/components/ceo/valdemar-content";
import {
  VALDEMAR_DEFAULT_RANGE_KEY,
  getValdemarStatsData,
  normalizeValdemarRangeKey,
} from "@/lib/ceo/data/valdemar";
import type { ValdemarTab } from "@/lib/ceo/valdemar-shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function normalizeTab(value: string | string[] | undefined): ValdemarTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "emails" ? "emails" : "calls";
}

async function ValdemarPanel({
  rangeKey,
  tab,
}: {
  rangeKey: string;
  tab: ValdemarTab;
}) {
  const data = await getValdemarStatsData(rangeKey);
  return <ValdemarContent data={data} initialTab={tab} />;
}

export default async function ValdemarStatsPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeValdemarRangeKey(params.range);
  const tab = normalizeTab(params.tab);

  return (
    <DashboardShell
      rangeKey={rangeKey}
      section="valdemar"
      defaultRangeKey={VALDEMAR_DEFAULT_RANGE_KEY}
      headerSubtext={
        <span>
          Live CRM data, refreshed on every load. Rolling ranges include today
          (calls and emails land here the moment they happen).
        </span>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <ValdemarPanel rangeKey={rangeKey} tab={tab} />
      </Suspense>
    </DashboardShell>
  );
}

import { Suspense } from "react";
import {
  AppUsageContent,
  AppUsagePlatformTabs,
} from "@/components/ceo/app-usage-content";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import {
  getAppUsageData,
  normalizeAppUsagePlatform,
  type AppUsagePlatform,
} from "@/lib/ceo/data/app-usage";
import {
  formatStockholmTime,
  getCoreAppLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import {
  listInternalTestUsers,
  listInternalTestWorkshops,
} from "@/lib/ceo/internal-test/loader";
import {
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "@/lib/ceo/time-ranges";
import { refreshAppUsageAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function AppUsagePanel({
  rangeKey,
  platform,
}: {
  rangeKey: string;
  platform: AppUsagePlatform;
}) {
  const [usage, internalTestUsers, internalTestWorkshops] = await Promise.all([
    getAppUsageData(
      resolveDashboardTimeRange(normalizeDashboardTimeRangeKey(rangeKey)),
      platform,
    ),
    listInternalTestUsers(),
    listInternalTestWorkshops(),
  ]);

  return (
    <AppUsageContent
      usage={usage}
      internalTestUsers={internalTestUsers}
      internalTestWorkshops={internalTestWorkshops}
    />
  );
}

export default async function AppUsagePage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const platform = normalizeAppUsagePlatform(params.platform);

  // Shell + header render from cached/cheap data; the GA4 runReport panel
  // streams in behind a skeleton.
  const [data, lastSyncedAt] = await Promise.all([
    getDashboardData(params.range),
    getCoreAppLastSyncedAt(),
  ]);

  return (
    <DashboardShell
      data={data}
      section="usage"
      headerActions={
        <AppUsagePlatformTabs rangeKey={rangeKey} active={platform} />
      }
      headerSubtext={
        <>
          <span>Last updated {formatStockholmTime(lastSyncedAt)} (Stockholm)</span>
          <form action={refreshAppUsageAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <AppUsagePanel rangeKey={rangeKey} platform={platform} />
      </Suspense>
    </DashboardShell>
  );
}

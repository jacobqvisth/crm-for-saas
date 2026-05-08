import {
  AppUsageContent,
  AppUsagePlatformTabs,
} from "@/components/ceo/app-usage-content";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { UpdateButton } from "@/components/ceo/update-button";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import {
  getAppUsageData,
  normalizeAppUsagePlatform,
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

export default async function AppUsagePage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const platform = normalizeAppUsagePlatform(params.platform);
  const resolvedRange = resolveDashboardTimeRange(rangeKey);
  const [
    data,
    usage,
    lastSyncedAt,
    internalTestUsers,
    internalTestWorkshops,
  ] = await Promise.all([
    getDashboardData(params.range),
    getAppUsageData(resolvedRange, platform),
    getCoreAppLastSyncedAt(),
    listInternalTestUsers(),
    listInternalTestWorkshops(),
  ]);

  return (
    <DashboardShell
      data={data}
      section="usage"
      headerActions={
        <AppUsagePlatformTabs rangeKey={rangeKey} active={usage.platform} />
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
      <AppUsageContent
        usage={usage}
        internalTestUsers={internalTestUsers}
        internalTestWorkshops={internalTestWorkshops}
      />
    </DashboardShell>
  );
}

import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { NewUsersContent } from "@/components/ceo/new-users-content";
import { UpdateButton } from "@/components/ceo/update-button";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getNewUsersData } from "@/lib/ceo/data/new-users";
import {
  formatStockholmTime,
  getCoreAppLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import {
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "@/lib/ceo/time-ranges";
import { refreshNewUsersAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function NewUsersPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const resolvedRange = resolveDashboardTimeRange(rangeKey);
  const [data, newUsers, lastSyncedAt] = await Promise.all([
    getDashboardData(params.range),
    getNewUsersData(resolvedRange),
    getCoreAppLastSyncedAt(),
  ]);

  return (
    <DashboardShell
      data={data}
      section="new-users"
      headerSubtext={
        <>
          <span>Last updated {formatStockholmTime(lastSyncedAt)} (Stockholm)</span>
          <form action={refreshNewUsersAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <NewUsersContent data={newUsers} />
    </DashboardShell>
  );
}

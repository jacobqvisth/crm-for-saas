import { Suspense } from "react";
import { ActiveUsersContent } from "@/components/ceo/active-users-content";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import {
  ACTIVE_USERS_DEFAULT_RANGE_KEY,
  getActiveUsersData,
  normalizeActiveUsersRangeKey,
} from "@/lib/ceo/data/active-users";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import {
  formatStockholmTime,
  getCoreAppLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import { refreshActiveUsersAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function ActiveUsersPanel({ rangeKey }: { rangeKey: string }) {
  const data = await getActiveUsersData(rangeKey);
  return <ActiveUsersContent data={data} />;
}

export default async function ActiveUsersPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeActiveUsersRangeKey(params.range);

  // Shell + header render from cached/cheap data; the GA4 + diagnostics panel
  // streams in behind a skeleton. Pass the resolved key (default: yesterday)
  // into getDashboardData so the time-range picker highlights correctly.
  const [data, lastSyncedAt] = await Promise.all([
    getDashboardData(rangeKey),
    getCoreAppLastSyncedAt(),
  ]);

  return (
    <DashboardShell
      data={data}
      section="active-users"
      defaultRangeKey={ACTIVE_USERS_DEFAULT_RANGE_KEY}
      headerSubtext={
        <>
          <span>
            Last updated {formatStockholmTime(lastSyncedAt)} (Stockholm)
          </span>
          <form action={refreshActiveUsersAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <ActiveUsersPanel rangeKey={rangeKey} />
      </Suspense>
    </DashboardShell>
  );
}

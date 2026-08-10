import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { ToplistsContent } from "@/components/ceo/toplists-content";
import { UpdateButton } from "@/components/ceo/update-button";
import { normalizeDashboardCountry } from "@/lib/ceo/countries";
import {
  TOPLISTS_DEFAULT_RANGE_KEY,
  getToplistsData,
  normalizeToplistsRangeKey,
} from "@/lib/ceo/data/toplists";
import {
  formatStockholmTime,
  getCoreAppLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import {
  listInternalTestUsers,
  listInternalTestWorkshops,
} from "@/lib/ceo/internal-test/loader";
import { refreshToplistsAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function ToplistsPanel({
  rangeKey,
  country,
}: {
  rangeKey: string;
  country: string | null;
}) {
  const [data, internalTestUsers, internalTestWorkshops] = await Promise.all([
    getToplistsData(rangeKey, country),
    listInternalTestUsers(),
    listInternalTestWorkshops(),
  ]);
  return (
    <ToplistsContent
      data={data}
      internalTestUsers={internalTestUsers}
      internalTestWorkshops={internalTestWorkshops}
    />
  );
}

export default async function ToplistsPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeToplistsRangeKey(params.range);
  const country = normalizeDashboardCountry(params.country);

  // Shell + header render instantly from the range key; the leaderboard panels
  // stream in behind a skeleton.
  const lastSyncedAt = await getCoreAppLastSyncedAt();

  return (
    <DashboardShell
      rangeKey={rangeKey}
      section="toplists"
      defaultRangeKey={TOPLISTS_DEFAULT_RANGE_KEY}
      headerSubtext={
        <>
          <span>
            Last updated {formatStockholmTime(lastSyncedAt)} (Stockholm)
          </span>
          <form action={refreshToplistsAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <ToplistsPanel rangeKey={rangeKey} country={country} />
      </Suspense>
    </DashboardShell>
  );
}

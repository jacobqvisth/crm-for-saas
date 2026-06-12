import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { NewUsersContent } from "@/components/ceo/new-users-content";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import { normalizeDashboardCountry } from "@/lib/ceo/countries";
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
import {
  listInternalTestUsers,
  listInternalTestWorkshops,
} from "@/lib/ceo/internal-test/loader";
import { InternalTestExclusionsPanel } from "@/components/ceo/internal-test-exclusions";
import { refreshNewUsersAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NEW_USERS_EXCLUSION_DESCRIPTION = (
  <>
    Sign-ups, activations, and first-diagnosis counts exclude internal/test
    users (manual list + anyone signed up with an <code>@wrenchlane.com</code>{" "}
    email, auto-flagged at every core_app sync) and any internal/test workshop.{" "}
    <strong>iOS / Android downloads and web first-visits</strong> come from GA4
    / app-store aggregates that can&apos;t be mapped back to the internal-test
    list, so they may still include internal traffic. Manage the list at{" "}
    <a href="/dashboard/settings">/dashboard/settings</a>.
  </>
);

async function NewUsersPanel({
  rangeKey,
  country,
}: {
  rangeKey: string;
  country: string | null;
}) {
  const [newUsers, internalTestUsers, internalTestWorkshops] =
    await Promise.all([
      getNewUsersData(
        resolveDashboardTimeRange(normalizeDashboardTimeRangeKey(rangeKey)),
        country,
      ),
      listInternalTestUsers(),
      listInternalTestWorkshops(),
    ]);
  return (
    <div className="section-stack">
      <NewUsersContent data={newUsers} />
      <InternalTestExclusionsPanel
        users={internalTestUsers}
        workshops={internalTestWorkshops}
        description={NEW_USERS_EXCLUSION_DESCRIPTION}
      />
    </div>
  );
}

export default async function NewUsersPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const country = normalizeDashboardCountry(params.country);

  // getDashboardData + the "last synced" stamp are cached and cheap — await
  // them so the shell + header render immediately, then stream the heavier
  // new-users aggregation panel.
  const [data, lastSyncedAt] = await Promise.all([
    getDashboardData(params.range),
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
      <Suspense fallback={<CeoPanelSkeleton />}>
        <NewUsersPanel rangeKey={rangeKey} country={country} />
      </Suspense>
    </DashboardShell>
  );
}

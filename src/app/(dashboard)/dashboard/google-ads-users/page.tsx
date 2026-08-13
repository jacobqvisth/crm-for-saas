import { Suspense } from "react";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { GoogleAdsUsersContent } from "@/components/ceo/google-ads-users-content";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import { getGoogleAdsUsersData } from "@/lib/ceo/data/google-ads-users";
import {
  formatStockholmTime,
  getCoreAppLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import { refreshGoogleAdsUsersAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function GoogleAdsUsersPanel() {
  const data = await getGoogleAdsUsersData();
  return <GoogleAdsUsersContent data={data} />;
}

export default async function GoogleAdsUsersPage() {
  // Cohorts always span all synced history, so the page sits in
  // FIXED_ALL_HISTORY_SECTIONS (range pills hidden) - no getDashboardData()
  // read needed for the shell chrome.
  const lastSyncedAt = await getCoreAppLastSyncedAt();

  return (
    <DashboardShell
      section="google-ads-users"
      headerSubtext={
        <>
          <span>
            Last updated {formatStockholmTime(lastSyncedAt)} (Stockholm)
          </span>
          <form action={refreshGoogleAdsUsersAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <GoogleAdsUsersPanel />
      </Suspense>
    </DashboardShell>
  );
}

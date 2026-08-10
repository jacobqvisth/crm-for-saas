import { Suspense } from "react";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { FreeUsersContent } from "@/components/ceo/free-users-content";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import { getFreeUsersData } from "@/lib/ceo/data/free-users";
import {
  formatStockholmTime,
  getCoreAppLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import { refreshFreeUsersAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function FreeUsersPanel() {
  const data = await getFreeUsersData();
  return <FreeUsersContent data={data} />;
}

export default async function FreeUsersPage() {
  // The page always reads all synced history and fixed 7/30-day windows, so
  // it sits in FIXED_ALL_HISTORY_SECTIONS (range pills hidden anyway) — no
  // getDashboardData() read needed for the shell chrome.
  const lastSyncedAt = await getCoreAppLastSyncedAt();

  return (
    <DashboardShell
      section="free-users"
      headerSubtext={
        <>
          <span>
            Last updated {formatStockholmTime(lastSyncedAt)} (Stockholm)
          </span>
          <form action={refreshFreeUsersAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <FreeUsersPanel />
      </Suspense>
    </DashboardShell>
  );
}

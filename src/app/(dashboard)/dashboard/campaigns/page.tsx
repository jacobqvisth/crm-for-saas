import { Suspense } from "react";
import { CampaignsContent } from "@/components/ceo/campaigns-content";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import { getCampaignsData } from "@/lib/ceo/data/campaigns";
import {
  formatStockholmTime,
  getCoreAppLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import { refreshCampaignsAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function CampaignsPanel() {
  const data = await getCampaignsData();
  return <CampaignsContent data={data} />;
}

export default async function CampaignsPage() {
  // The page carries its own 30/90/all-time switcher over the full spend
  // history, so it sits in FIXED_ALL_HISTORY_SECTIONS (shell range pills
  // hidden) and needs no getDashboardData() read for the chrome.
  const lastSyncedAt = await getCoreAppLastSyncedAt();

  return (
    <DashboardShell
      section="campaigns"
      headerSubtext={
        <>
          <span>
            Last updated {formatStockholmTime(lastSyncedAt)} (Stockholm)
          </span>
          <form action={refreshCampaignsAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <CampaignsPanel />
      </Suspense>
    </DashboardShell>
  );
}

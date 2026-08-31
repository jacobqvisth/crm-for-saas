import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { BestAdsContent } from "@/components/ceo/best-ads-content";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import { formatStockholmTime } from "@/lib/ceo/data/sync-freshness";
import { getBestAdsData } from "@/lib/ceo/data/best-ads";
import { BEST_ADS_TABS, type BestAdsTab } from "@/lib/ceo/best-ads/types";
import { refreshBestAdsAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function normalizeTab(value: string | string[] | undefined): BestAdsTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  const match = BEST_ADS_TABS.find((tab) => tab.key === candidate);
  return match ? match.key : "playbook";
}

async function BestAdsPanel({ tab }: { tab: BestAdsTab }) {
  const data = await getBestAdsData();
  return <BestAdsContent data={data} initialTab={tab} />;
}

export default async function BestAdsPage({ searchParams }: DashboardRoutePageProps) {
  const params = await searchParams;
  const tab = normalizeTab(params.tab);

  // The page carries its own range tabs over four pre-computed windows, so it
  // sits in FIXED_ALL_HISTORY_SECTIONS and never reads the shell's range. An
  // asset's whole point is that it is reusable, and half the lessons in this
  // account come from campaigns that have been paused for months, so a default
  // 30-day view would hide most of what the page exists to show.
  const data = await getBestAdsData();

  return (
    <DashboardShell
      section="best-ads"
      headerSubtext={
        <>
          <span>
            {data.lastSyncedAt
              ? `Google Ads assets last synced ${formatStockholmTime(data.lastSyncedAt)} (Stockholm).`
              : "Google Ads assets have not been synced yet."}
          </span>
          <form action={refreshBestAdsAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <BestAdsPanel tab={tab} />
      </Suspense>
    </DashboardShell>
  );
}

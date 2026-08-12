import { Suspense } from "react";
import { CacLtvContent } from "@/components/ceo/cac-ltv-content";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import { getCacLtvData } from "@/lib/ceo/data/cac-ltv";
import {
  formatStockholmTime,
  getCoreAppLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import { refreshCacLtvAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function CacLtvPanel({ rangeKey }: { rangeKey?: string }) {
  const data = await getCacLtvData(rangeKey);
  return <CacLtvContent data={data} />;
}

export default async function CacLtvPage({
  searchParams,
}: {
  // `?window=` rather than `?range=`, so it cannot collide with the shell's own
  // range pills (which this page hides) if they are ever re-enabled here.
  searchParams: Promise<{ window?: string }>;
}) {
  // Reads all synced history (the model is cohort-based and the spend series is
  // only four months long), so it sits in FIXED_ALL_HISTORY_SECTIONS and the
  // range pills are hidden — no getDashboardData() read needed for the chrome.
  const [lastSyncedAt, params] = await Promise.all([
    getCoreAppLastSyncedAt(),
    searchParams,
  ]);

  return (
    <DashboardShell
      section="cac-ltv"
      headerSubtext={
        <>
          <span>Last updated {formatStockholmTime(lastSyncedAt)} (Stockholm)</span>
          <form action={refreshCacLtvAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />} key={params.window ?? "default"}>
        <CacLtvPanel rangeKey={params.window} />
      </Suspense>
    </DashboardShell>
  );
}

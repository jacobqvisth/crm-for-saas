import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { TrialUsersContent } from "@/components/ceo/trial-users-content";
import { UpdateButton } from "@/components/ceo/update-button";
import {
  formatStockholmTime,
  getStripeLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import { getTrialUsersData } from "@/lib/ceo/data/trial-users";
import { TRIAL_TABS, type TrialTab } from "@/lib/ceo/trial-users-shared";
import { refreshTrialUsersAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function normalizeTab(value: string | string[] | undefined): TrialTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  const match = TRIAL_TABS.find((tab) => tab.key === candidate);
  return match ? match.key : "overview";
}

async function TrialUsersPanel({ tab }: { tab: TrialTab }) {
  const data = await getTrialUsersData();
  return <TrialUsersContent data={data} initialTab={tab} />;
}

export default async function TrialUsersPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const tab = normalizeTab(params.tab);

  // Trials are all-history by nature — a trial that lapsed in March is still
  // the thing being audited — so this page sits in FIXED_ALL_HISTORY_SECTIONS
  // and never reads getDashboardData().
  //
  // The freshness stamp is the STRIPE one, not core_app: the trial rows, their
  // outcomes and metadata.trial_start are all written by the Stripe sync, so
  // core_app's timestamp would overstate how current the conversion numbers are.
  const lastSyncedAt = await getStripeLastSyncedAt();

  return (
    <DashboardShell
      section="trial-users"
      headerSubtext={
        <>
          <span>
            Stripe last synced {formatStockholmTime(lastSyncedAt)} (Stockholm).
            Product and outreach data is read live.
          </span>
          <form action={refreshTrialUsersAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <TrialUsersPanel tab={tab} />
      </Suspense>
    </DashboardShell>
  );
}

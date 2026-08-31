import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { PayingCustomersContent } from "@/components/ceo/paying-customers-content";
import { UpdateButton } from "@/components/ceo/update-button";
import { formatStockholmTime } from "@/lib/ceo/data/sync-freshness";
import { getPayingCustomersData } from "@/lib/ceo/data/paying-customers";
import { PAYING_TABS, type PayingTab } from "@/lib/ceo/paying-customers/shared";
import { refreshPayingCustomersAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function normalizeTab(value: string | string[] | undefined): PayingTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  const match = PAYING_TABS.find((tab) => tab.key === candidate);
  return match ? match.key : "funnel";
}

async function PayingCustomersPanel({ tab }: { tab: PayingTab }) {
  const data = await getPayingCustomersData();
  return <PayingCustomersContent data={data} initialTab={tab} />;
}

export default async function PayingCustomersPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const tab = normalizeTab(params.tab);

  // Every rate here is a cohort measured from the first ad onward, and the
  // named customer list is all-history by nature, so the page never reads the
  // shell's range: it sits in FIXED_ALL_HISTORY_SECTIONS and scopes its own
  // window with an explicit maturity cut-off it states on screen.
  const data = await getPayingCustomersData();

  return (
    <DashboardShell
      section="paying-customers"
      headerSubtext={
        <>
          <span>
            {data.adsLastSyncedAt
              ? `Google Ads conversions last synced ${formatStockholmTime(data.adsLastSyncedAt)} (Stockholm). Stripe and product data read live.`
              : "Google Ads conversions have not been synced yet. Stripe and product data read live."}
          </span>
          <form action={refreshPayingCustomersAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <PayingCustomersPanel tab={tab} />
      </Suspense>
    </DashboardShell>
  );
}

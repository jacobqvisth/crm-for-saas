import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { PromoUsersContent } from "@/components/ceo/promo-users-content";
import { UpdateButton } from "@/components/ceo/update-button";
import { getPromoUsersData } from "@/lib/ceo/data/promo-users";
import {
  formatStockholmTime,
  getStripeLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import { PROMO_TABS, type PromoTab } from "@/lib/ceo/promo-users-shared";
import { refreshPromoUsersAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function normalizeTab(value: string | string[] | undefined): PromoTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  const match = PROMO_TABS.find((tab) => tab.key === candidate);
  return match ? match.key : "overview";
}

async function PromoUsersPanel({ tab }: { tab: PromoTab }) {
  const data = await getPromoUsersData();
  return <PromoUsersContent data={data} initialTab={tab} />;
}

export default async function PromoUsersPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const tab = normalizeTab(params.tab);

  // Promo grants are all-history by nature — a coupon handed out in 2025 is
  // still the thing being audited — so this page sits in
  // FIXED_ALL_HISTORY_SECTIONS and never reads getDashboardData().
  //
  // The freshness stamp is the STRIPE one, not core_app: grants are written by
  // the Stripe sync, so core_app's timestamp would overstate how current the
  // discount numbers are.
  const lastSyncedAt = await getStripeLastSyncedAt();

  return (
    <DashboardShell
      section="promo-users"
      headerSubtext={
        <>
          <span>
            Stripe last synced {formatStockholmTime(lastSyncedAt)} (Stockholm).
            Product and outreach data is read live.
          </span>
          <form action={refreshPromoUsersAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <PromoUsersPanel tab={tab} />
      </Suspense>
    </DashboardShell>
  );
}

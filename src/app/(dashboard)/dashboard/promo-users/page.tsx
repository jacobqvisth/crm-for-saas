import { Suspense } from "react";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { PromoUsersContent } from "@/components/ceo/promo-users-content";
import { UpdateButton } from "@/components/ceo/update-button";
import { getPromoUsersData } from "@/lib/ceo/data/promo-users";
import {
  formatStockholmTime,
  getStripeLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import { refreshPromoUsersAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function PromoUsersPanel() {
  const data = await getPromoUsersData();
  return <PromoUsersContent data={data} />;
}

export default async function PromoUsersPage() {
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
            Stripe last synced {formatStockholmTime(lastSyncedAt)} (Stockholm)
          </span>
          <form action={refreshPromoUsersAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <Suspense fallback={<CeoPanelSkeleton />}>
        <PromoUsersPanel />
      </Suspense>
    </DashboardShell>
  );
}

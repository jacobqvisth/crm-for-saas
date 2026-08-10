import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { PaymentMethodsContent } from "@/components/ceo/payment-methods-content";
import { getPaymentMethodsData } from "@/lib/ceo/data/payment-methods";
import { normalizeDashboardTimeRangeKey } from "@/lib/ceo/time-ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function PaymentMethodsPanel() {
  const paymentData = await getPaymentMethodsData();
  return <PaymentMethodsContent data={paymentData} />;
}

export default async function PaymentMethodsPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);

  return (
    <DashboardShell rangeKey={rangeKey} section="payment-methods">
      <Suspense fallback={<CeoPanelSkeleton />}>
        <PaymentMethodsPanel />
      </Suspense>
    </DashboardShell>
  );
}

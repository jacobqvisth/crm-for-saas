import { Suspense } from "react";
import { type DashboardRoutePageProps } from "@/components/ceo/dashboard-page";
import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { MonthPicker } from "@/components/ceo/month-picker";
import { MonthlyReviewContent } from "@/components/ceo/monthly-review-content";
import { CeoPanelSkeleton } from "@/components/ceo/panel-skeleton";
import { UpdateButton } from "@/components/ceo/update-button";
import { normalizeDashboardCountry } from "@/lib/ceo/countries";
import {
  getMonthlyReviewData,
  listMonthOptions,
  normalizeMonthKey,
} from "@/lib/ceo/data/monthly-review";
import {
  formatStockholmTime,
  getCoreAppLastSyncedAt,
} from "@/lib/ceo/data/sync-freshness";
import { normalizeDashboardTimeRangeKey } from "@/lib/ceo/time-ranges";
import { refreshMonthlyReviewAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function MonthlyReviewPanel({
  month,
  country,
}: {
  month: string;
  country: string | null;
}) {
  const data = await getMonthlyReviewData(month, country);
  return <MonthlyReviewContent data={data} />;
}

export default async function MonthlyReviewPage({
  searchParams,
}: DashboardRoutePageProps) {
  const params = await searchParams;
  const month = normalizeMonthKey(params.month);
  const country = normalizeDashboardCountry(params.country);
  const monthOptions = listMonthOptions();

  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const lastSyncedAt = await getCoreAppLastSyncedAt();

  return (
    <DashboardShell
      rangeKey={rangeKey}
      section="monthly-review"
      headerSubtext={
        <>
          <span>
            Last updated {formatStockholmTime(lastSyncedAt)} (Stockholm)
          </span>
          <form action={refreshMonthlyReviewAction}>
            <UpdateButton />
          </form>
        </>
      }
    >
      <div className="section-stack">
        <MonthPicker
          options={monthOptions}
          selected={month}
          country={country}
        />
        <Suspense key={`${month}:${country ?? ""}`} fallback={<CeoPanelSkeleton />}>
          <MonthlyReviewPanel month={month} country={country} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

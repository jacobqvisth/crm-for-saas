import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { DtcCodesContent } from "@/components/ceo/dtc-codes-content";
import { normalizeDashboardCountry } from "@/lib/ceo/countries";
import { getDiagnosticsDrilldownList } from "@/lib/ceo/data/diagnostics";
import { analyseDtcCodes } from "@/lib/ceo/dtc/analyse";
import { resolveDashboardTimeRange } from "@/lib/ceo/time-ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DtcCodesPageProps = {
  searchParams: Promise<{
    country?: string | string[];
    showInternal?: string | string[];
  }>;
};

function asString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function asBool(value: string | string[] | undefined) {
  const next = asString(value).trim().toLowerCase();
  return next === "1" || next === "true" || next === "on";
}

export default async function DtcCodesPage({ searchParams }: DtcCodesPageProps) {
  const params = await searchParams;
  const country = normalizeDashboardCountry(params.country);
  const showInternal = asBool(params.showInternal);

  // Same shape as the sibling Search Terms page, and for the same reasons.
  //
  // The diagnostics read is always all-history: code-frequency analysis over a
  // 30-day slice is too thin to be useful, and the read is cheap (~2.4k rows).
  // The shell renders from the default range key alone (pills are hidden via
  // FIXED_ALL_HISTORY_SECTIONS anyway) — no getDashboardData() read needed.
  const diagnostics = await getDiagnosticsDrilldownList({
    range: resolveDashboardTimeRange("all_time"),
    includeInternal: showInternal,
  });

  const scoped = country
    ? diagnostics.filter(
        (item) => (item.country ?? "").trim().toUpperCase() === country,
      )
    : diagnostics;

  const analysis = analyseDtcCodes(scoped);

  return (
    <DashboardShell section="dtc-codes">
      <DtcCodesContent analysis={analysis} showInternal={showInternal} />
    </DashboardShell>
  );
}

import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { SearchTermsContent } from "@/components/ceo/search-terms-content";
import { normalizeDashboardCountry } from "@/lib/ceo/countries";
import { getDiagnosticsDrilldownList } from "@/lib/ceo/data/diagnostics";
import { analyseSearchTerms } from "@/lib/ceo/search-terms";
import { resolveDashboardTimeRange } from "@/lib/ceo/time-ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SearchTermsPageProps = {
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

export default async function DiagnosticSearchTermsPage({
  searchParams,
}: SearchTermsPageProps) {
  const params = await searchParams;
  const country = normalizeDashboardCountry(params.country);
  const showInternal = asBool(params.showInternal);

  // This page has no time-range filter: keyword analysis over a 30-day slice is
  // not meaningful, so the diagnostics read is always all-history. That read is
  // cheap — ~2.4k rows, ~2s. The shell renders from the default range key alone
  // (pills are hidden via FIXED_ALL_HISTORY_SECTIONS anyway) — no
  // getDashboardData() read needed.
  const diagnostics = await getDiagnosticsDrilldownList({
    range: resolveDashboardTimeRange("all_time"),
    includeInternal: showInternal,
  });

  const scoped = country
    ? diagnostics.filter(
        (item) => (item.country ?? "").trim().toUpperCase() === country,
      )
    : diagnostics;

  const analysis = analyseSearchTerms(scoped);

  return (
    <DashboardShell section="diagnostic-search-terms">
      <SearchTermsContent analysis={analysis} showInternal={showInternal} />
    </DashboardShell>
  );
}

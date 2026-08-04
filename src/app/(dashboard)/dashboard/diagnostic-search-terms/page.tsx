import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { SearchTermsContent } from "@/components/ceo/search-terms-content";
import { normalizeDashboardCountry } from "@/lib/ceo/countries";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getDiagnosticsDrilldownList } from "@/lib/ceo/data/diagnostics";
import { analyseSearchTerms } from "@/lib/ceo/search-terms";
import {
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "@/lib/ceo/time-ranges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SearchTermsPageProps = {
  searchParams: Promise<{
    range?: string | string[];
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
  // Text analysis is only meaningful with volume, so this page defaults to
  // all-time rather than the dashboard-wide last-30-days.
  const rangeKey = normalizeDashboardTimeRangeKey(params.range ?? "all_time");
  const resolvedRange = resolveDashboardTimeRange(rangeKey);
  const country = normalizeDashboardCountry(params.country);
  const showInternal = asBool(params.showInternal);

  const [data, diagnostics] = await Promise.all([
    getDashboardData(params.range ?? "all_time"),
    getDiagnosticsDrilldownList({
      range: resolvedRange,
      includeInternal: showInternal,
    }),
  ]);

  const scoped = country
    ? diagnostics.filter(
        (item) => (item.country ?? "").trim().toUpperCase() === country,
      )
    : diagnostics;

  const analysis = analyseSearchTerms(scoped);

  return (
    <DashboardShell
      data={data}
      section="diagnostic-search-terms"
      defaultRangeKey="all_time"
    >
      <SearchTermsContent
        analysis={analysis}
        rangeKey={rangeKey}
        showInternal={showInternal}
      />
    </DashboardShell>
  );
}

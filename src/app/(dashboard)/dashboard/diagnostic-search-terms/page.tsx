import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { SearchTermsContent } from "@/components/ceo/search-terms-content";
import { normalizeDashboardCountry } from "@/lib/ceo/countries";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
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
  // cheap — ~2.4k rows, ~2s.
  //
  // getDashboardData is a different story and must NOT be asked for "all_time".
  // It pages every row of dashboard_metric_snapshots — 161k rows / 87 MB as of
  // 2026-08-04, going back to 2025-06-27 — needing ~160 sequential round trips
  // to eu-north-1 from a us-east function, which blew the 60s limit and is what
  // made this page fail on first deploy. It is used here only for shell chrome
  // (title, banners, country list), so it takes the cheap default range while
  // the pills are hidden via FIXED_ALL_HISTORY_SECTIONS.
  const [data, diagnostics] = await Promise.all([
    getDashboardData(),
    getDiagnosticsDrilldownList({
      range: resolveDashboardTimeRange("all_time"),
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
    <DashboardShell data={data} section="diagnostic-search-terms">
      <SearchTermsContent analysis={analysis} showInternal={showInternal} />
    </DashboardShell>
  );
}

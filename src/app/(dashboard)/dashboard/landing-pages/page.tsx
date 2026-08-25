import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { LandingPagesContent } from "@/components/ceo/landing-pages-content";
import { normalizeDashboardCountry } from "@/lib/ceo/countries";
import { getDiagnosticsDrilldownList } from "@/lib/ceo/data/diagnostics";
import { analyseDtcCodes } from "@/lib/ceo/dtc/analyse";
import { hasGoogleAdsApiCredentials } from "@/lib/ceo/sync/google-ads-client";
import { resolveDashboardTimeRange } from "@/lib/ceo/time-ranges";
import { buildLandingPlan } from "@/lib/landing/plan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type LandingPagesPageProps = {
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

export default async function LandingPagesPage({
  searchParams,
}: LandingPagesPageProps) {
  const params = await searchParams;
  const country = normalizeDashboardCountry(params.country);
  const showInternal = asBool(params.showInternal);

  // Same read as the DTC Codes page, for the same reasons: the demand signal
  // behind the whole programme is code frequency over all history, a 30-day
  // slice of it is too thin to rank anything by, and the read is cheap. The
  // shell renders from the default range key alone, so no getDashboardData()
  // call is needed. See reference: never hand getDashboardData an all_time range.
  const diagnostics = await getDiagnosticsDrilldownList({
    range: resolveDashboardTimeRange("all_time"),
    includeInternal: showInternal,
  });

  // The loader has no country argument; the DTC Codes page filters in memory
  // after the read and this does the same, so the two pages cannot disagree
  // about what a country-scoped code count means.
  const scoped = country
    ? diagnostics.filter(
        (item) => (item.country ?? "").trim().toUpperCase() === country,
      )
    : diagnostics;

  const plan = buildLandingPlan(analyseDtcCodes(scoped));

  return (
    <DashboardShell section="landing-pages">
      <LandingPagesContent
        plan={plan}
        diagnosticsRead={scoped.length}
        adsApiConfigured={hasGoogleAdsApiCredentials()}
      />
    </DashboardShell>
  );
}

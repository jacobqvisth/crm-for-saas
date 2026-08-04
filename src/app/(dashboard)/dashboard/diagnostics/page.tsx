import { DashboardShell } from "@/components/ceo/dashboard-shell";
import { DiagnosticsContent } from "@/components/ceo/diagnostics-content";
import { InternalTestExclusionsPanel } from "@/components/ceo/internal-test-exclusions";
import { normalizeDashboardCountry } from "@/lib/ceo/countries";
import { getDashboardData } from "@/lib/ceo/data/dashboard";
import { getDiagnosticsDrilldownList } from "@/lib/ceo/data/diagnostics";
import { dtcsMatchAllCodes, parseDtcCodeFilter } from "@/lib/ceo/dtc/match";
import {
  listInternalTestUsers,
  listInternalTestWorkshops,
} from "@/lib/ceo/internal-test/loader";
import {
  normalizeDashboardTimeRangeKey,
  resolveDashboardTimeRange,
} from "@/lib/ceo/time-ranges";

export const dynamic = "force-dynamic";

const DIAGNOSTICS_EXCLUSION_DESCRIPTION = (
  <>
    This list excludes diagnostics from internal/test users (manual list +
    anyone signed up with an <code>@wrenchlane.com</code> email, auto-flagged at
    every core_app sync) and any internal/test workshop. Toggle{" "}
    <strong>Show internal</strong> above to include them. Manage the list at{" "}
    <a href="/dashboard/settings">/dashboard/settings</a>.
  </>
);
export const maxDuration = 60;

type DiagnosticsPageProps = {
  searchParams: Promise<{
    range?: string | string[];
    country?: string | string[];
    q?: string | string[];
    codes?: string | string[];
    status?: string | string[];
    showInternal?: string | string[];
    d?: string | string[];
  }>;
};

function asString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function asBool(value: string | string[] | undefined) {
  const next = asString(value).trim().toLowerCase();
  return next === "1" || next === "true" || next === "on";
}

export default async function DiagnosticsPage({
  searchParams,
}: DiagnosticsPageProps) {
  const params = await searchParams;
  const rangeKey = normalizeDashboardTimeRangeKey(params.range);
  const resolvedRange = resolveDashboardTimeRange(rangeKey);
  const country = normalizeDashboardCountry(params.country);
  const rawQuery = asString(params.q).trim();
  const query = rawQuery.toLowerCase();
  // `codes=` is the combination filter the DTC Codes page links to: every listed
  // code must be in the session, which free-text `q` cannot express because the
  // codes sit in separate entries of the same array.
  const codeFilter = parseDtcCodeFilter(asString(params.codes));
  const status = asString(params.status) || "all";
  const showInternal = asBool(params.showInternal);
  const selectedDiagnosticId = asString(params.d).trim() || null;

  // A code combination is counted on the DTC Codes page over all synced history,
  // so the drilldown has to search the same span or a pair listed there opens on
  // an empty table — only 7 of the 30 currently listed pairs have a session
  // inside the default 30-day window, and 27 inside 90 days. Widening costs
  // nothing: getDiagnosticsDrilldownList already reads every row and applies the
  // range in memory. Deliberately only the *list* widens — getDashboardData keeps
  // the requested range, because handing it all_time makes it read every metric
  // snapshot ever synced and time out.
  const listRange =
    codeFilter.length > 0 ? resolveDashboardTimeRange("all_time") : resolvedRange;

  const [data, diagnostics, internalTestUsers, internalTestWorkshops] =
    await Promise.all([
      getDashboardData(params.range),
      getDiagnosticsDrilldownList({
        range: listRange,
        includeInternal: showInternal,
      }),
      listInternalTestUsers(),
      listInternalTestWorkshops(),
    ]);

  const filtered = diagnostics.filter((item) => {
    if (status !== "all" && item.status !== status) {
      return false;
    }
    // Each item carries its workshop's country (ISO-2) — rows with no
    // resolvable country are hidden while a country filter is active.
    if (country && (item.country ?? "").trim().toUpperCase() !== country) {
      return false;
    }
    if (!dtcsMatchAllCodes(item.dtcs, codeFilter)) {
      return false;
    }
    if (!query) {
      return true;
    }
    const haystack = [
      item.username ?? "",
      item.userName ?? "",
      item.workshopName ?? "",
      item.country ?? "",
      item.language ?? "",
      item.carMake ?? "",
      item.carModel ?? "",
      item.carYear ? String(item.carYear) : "",
      item.description ?? "",
      item.topCause?.name ?? "",
      ...item.dtcs,
      ...item.symptoms,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  return (
    <DashboardShell data={data} section="diagnostics">
      <div className="section-stack">
        <DiagnosticsContent
          items={filtered}
          selectedDiagnosticId={selectedDiagnosticId}
          query={rawQuery}
          codes={codeFilter}
          status={status}
          showInternal={showInternal}
          rangeKey={rangeKey}
        />
        {showInternal ? null : (
          <InternalTestExclusionsPanel
            users={internalTestUsers}
            workshops={internalTestWorkshops}
            description={DIAGNOSTICS_EXCLUSION_DESCRIPTION}
          />
        )}
      </div>
    </DashboardShell>
  );
}

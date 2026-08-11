import type { ReactNode } from "react";
import {
  DEFAULT_TIME_RANGE_KEY,
  getDashboardTimeRangeOptions,
  type DashboardTimeRangeKey,
} from "@/lib/ceo/time-ranges";
import { getDashboardCountryOptions } from "@/lib/ceo/countries";
import { hasSupabaseConfig } from "@/lib/ceo/env";
import type { DashboardData } from "@/lib/ceo/metrics/types";
import {
  DASHBOARD_SECTIONS,
  getDashboardSectionConfig,
  type DashboardSectionKey,
} from "./dashboard-sections";
import { DashboardShellNav } from "./dashboard-shell-nav";

// Sections whose loaders honor the ?country= filter. Everything else shows
// the dropdown disabled (the selection still travels in the URL so it's
// intact when you navigate back to a supported tab).
const COUNTRY_FILTER_SECTIONS: ReadonlySet<DashboardSectionKey> = new Set<
  DashboardSectionKey
>([
  "usage",
  "active-users",
  "feature-usage",
  "plan-stats",
  "toplists",
  "new-users",
  "diagnostics",
  "diagnostic-search-terms",
  "dtc-codes",
  "workshops",
]);

// Sections that deliberately ignore the time-range pills and always read all
// synced history. Keyword/text analysis over a 30-day slice is not meaningful,
// and asking getDashboardData() for "all_time" is prohibitively expensive: it
// pages every row of dashboard_metric_snapshots (161k rows / 87 MB as of
// 2026-08-04) and times the function out. These pages therefore take the cheap
// default range for the shell chrome and scope their own reads themselves.
const FIXED_ALL_HISTORY_SECTIONS: ReadonlySet<DashboardSectionKey> = new Set<
  DashboardSectionKey
>(["diagnostic-search-terms", "dtc-codes", "free-users", "cac-ltv"]);

type DashboardShellProps = {
  // Full warehouse read — only pass this when the page CONTENT actually uses
  // it (/dashboard, settings). Pages that just need the chrome should pass
  // `rangeKey` instead: the range pills are a pure function of the key, and
  // getDashboardData() cold-loads ~70 paged Supabase requests (metric
  // snapshots), which used to block the whole route render on range switches.
  data?: DashboardData;
  // Lightweight alternative to `data`: the normalized active range key.
  rangeKey?: DashboardTimeRangeKey;
  section: DashboardSectionKey;
  children: ReactNode;
  headerActions?: ReactNode;
  headerSubtext?: ReactNode;
  // Per-page default range. The "bare" (no ?range=) URL means this key, so the
  // time-range pill for it links to the clean URL. Defaults to the
  // dashboard-wide default (last_30_days).
  defaultRangeKey?: DashboardTimeRangeKey;
};

export async function DashboardShell({
  data,
  rangeKey,
  section,
  children,
  headerActions,
  headerSubtext,
  defaultRangeKey = DEFAULT_TIME_RANGE_KEY,
}: DashboardShellProps) {
  const page = getDashboardSectionConfig(section);
  const countryOptions = await getDashboardCountryOptions();

  const selectedRange = data?.selectedRange ?? rangeKey ?? DEFAULT_TIME_RANGE_KEY;
  const timeRangeOptions =
    data?.timeRangeOptions ?? getDashboardTimeRangeOptions(selectedRange);
  const setupMode = data ? data.setupMode : !hasSupabaseConfig();

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {page.title}
            </h1>
            {headerSubtext ? (
              <div className="mt-1 text-sm text-slate-500">{headerSubtext}</div>
            ) : null}
          </div>
          {headerActions ? (
            <div className="flex items-center gap-2">{headerActions}</div>
          ) : null}
        </div>
      </header>

      <DashboardShellNav
        tabs={DASHBOARD_SECTIONS.map((item) => ({
          key: item.key,
          label: item.label,
          href: item.href,
        }))}
        activeTabKey={section}
        pageHref={page.href}
        selectedRange={selectedRange}
        defaultRangeKey={defaultRangeKey}
        rangePills={timeRangeOptions.map((option) => ({
          key: option.key,
          label: option.label,
          description: option.description,
          active: option.active,
        }))}
        countryOptions={countryOptions}
        supportsCountry={COUNTRY_FILTER_SECTIONS.has(section)}
        supportsTimeRange={!FIXED_ALL_HISTORY_SECTIONS.has(section)}
      />

      {setupMode ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong className="font-semibold">Setup mode:</strong> add Supabase
          and source API environment variables to replace demo metrics with
          live WrenchLane data.
        </div>
      ) : null}

      {data?.hasLimitedHistory ? (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <strong className="font-semibold">Limited synced history:</strong>{" "}
          this range has little or no stored data yet. The dashboard will fill
          in as hourly syncs accumulate or after a backfill is run.
        </div>
      ) : null}

      {children}
    </div>
  );
}

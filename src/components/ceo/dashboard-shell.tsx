import type { ReactNode } from "react";
import {
  DEFAULT_TIME_RANGE_KEY,
  type DashboardTimeRangeKey,
} from "@/lib/ceo/time-ranges";
import { getDashboardCountryOptions } from "@/lib/ceo/countries";
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
  "toplists",
  "new-users",
  "diagnostics",
  "workshops",
]);

type DashboardShellProps = {
  data: DashboardData;
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
  section,
  children,
  headerActions,
  headerSubtext,
  defaultRangeKey = DEFAULT_TIME_RANGE_KEY,
}: DashboardShellProps) {
  const page = getDashboardSectionConfig(section);
  const countryOptions = await getDashboardCountryOptions();

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
        selectedRange={data.selectedRange}
        defaultRangeKey={defaultRangeKey}
        rangePills={data.timeRangeOptions.map((option) => ({
          key: option.key,
          label: option.label,
          description: option.description,
          active: option.active,
        }))}
        countryOptions={countryOptions}
        supportsCountry={COUNTRY_FILTER_SECTIONS.has(section)}
      />

      {data.setupMode ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong className="font-semibold">Setup mode:</strong> add Supabase
          and source API environment variables to replace demo metrics with
          live WrenchLane data.
        </div>
      ) : null}

      {data.hasLimitedHistory ? (
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

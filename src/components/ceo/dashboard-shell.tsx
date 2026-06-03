import type { ReactNode } from "react";
import Link from "next/link";
import {
  DEFAULT_TIME_RANGE_KEY,
  type DashboardTimeRangeKey,
} from "@/lib/ceo/time-ranges";
import type { DashboardData } from "@/lib/ceo/metrics/types";
import {
  DASHBOARD_SECTIONS,
  getDashboardSectionConfig,
  type DashboardSectionKey,
} from "./dashboard-sections";

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

function hrefWithRange(
  href: string,
  range: string,
  defaultRange: string = DEFAULT_TIME_RANGE_KEY,
) {
  return range === defaultRange ? href : `${href}?range=${range}`;
}

export function DashboardShell({
  data,
  section,
  children,
  headerActions,
  headerSubtext,
  defaultRangeKey = DEFAULT_TIME_RANGE_KEY,
}: DashboardShellProps) {
  const page = getDashboardSectionConfig(section);

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

      <nav
        className="mb-6 flex flex-wrap gap-1 border-b border-slate-200"
        aria-label="Dashboard sections"
      >
        {DASHBOARD_SECTIONS.map((item) => {
          const isActive = item.key === section;
          return (
            <Link
              key={item.key}
              href={hrefWithRange(item.href, data.selectedRange)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div
        className="mb-6 flex flex-wrap gap-1"
        role="tablist"
        aria-label="Choose time frame"
      >
        {data.timeRangeOptions.map((option) => (
          <Link
            key={option.key}
            href={hrefWithRange(page.href, option.key, defaultRangeKey)}
            aria-current={option.active ? "page" : undefined}
            title={option.description}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              option.active
                ? "bg-indigo-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {option.label}
          </Link>
        ))}
      </div>

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

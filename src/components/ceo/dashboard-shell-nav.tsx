"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DashboardCountryOption } from "@/lib/ceo/countries";
import { DEFAULT_TIME_RANGE_KEY } from "@/lib/ceo/time-ranges";

// Client half of the dashboard shell: section tabs, time-range pills, and the
// country dropdown. Lives client-side so every link can carry the *current*
// URL state (range, country, page-local params like platform/q/status)
// without each page having to thread searchParams into the shell.

type TabItem = {
  key: string;
  label: string;
  href: string;
};

type RangePill = {
  key: string;
  label: string;
  description: string;
  active: boolean;
};

type DashboardShellNavProps = {
  tabs: TabItem[];
  activeTabKey: string;
  pageHref: string;
  selectedRange: string;
  // Per-page default range — the pill for it links to a URL without ?range=.
  defaultRangeKey: string;
  rangePills: RangePill[];
  countryOptions: DashboardCountryOption[];
  // Whether the active page's data actually honors the country filter.
  supportsCountry: boolean;
};

function normalizeCountryParam(value: string | null): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function DashboardShellNav({
  tabs,
  activeTabKey,
  pageHref,
  selectedRange,
  defaultRangeKey,
  rangePills,
  countryOptions,
  supportsCountry,
}: DashboardShellNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedCountry = normalizeCountryParam(searchParams.get("country"));

  // Cross-section links carry only the shared filters (range + country) —
  // page-local params like q/status/platform don't travel between sections.
  const tabHref = (href: string) => {
    const params = new URLSearchParams();
    if (selectedRange !== DEFAULT_TIME_RANGE_KEY) {
      params.set("range", selectedRange);
    }
    if (selectedCountry) params.set("country", selectedCountry);
    const qs = params.toString();
    return qs ? `${href}?${qs}` : href;
  };

  // Range pills stay on the page, so they preserve every current param and
  // only swap the range (dropping it for the page's default → clean URL).
  const pillHref = (rangeKey: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (rangeKey === defaultRangeKey) {
      params.delete("range");
    } else {
      params.set("range", rangeKey);
    }
    const qs = params.toString();
    return qs ? `${pageHref}?${qs}` : pageHref;
  };

  const onCountryChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const code = normalizeCountryParam(value);
    if (code) {
      params.set("country", code);
    } else {
      params.delete("country");
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <>
      <nav
        className="mb-6 flex flex-wrap gap-1 border-b border-slate-200"
        aria-label="Dashboard sections"
      >
        {tabs.map((item) => {
          const isActive = item.key === activeTabKey;
          return (
            <Link
              key={item.key}
              href={tabHref(item.href)}
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

      <div className="mb-6 flex flex-wrap items-center gap-1">
        <div role="tablist" aria-label="Choose time frame" className="flex flex-wrap gap-1">
          {rangePills.map((option) => (
            <Link
              key={option.key}
              href={pillHref(option.key)}
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

        {countryOptions.length > 0 ? (
          <div className="ml-auto flex items-center gap-2">
            {selectedCountry && !supportsCountry ? (
              <span className="text-xs text-amber-600">not applied here</span>
            ) : null}
            <select
              value={selectedCountry ?? "all"}
              onChange={(event) => onCountryChange(event.target.value)}
              disabled={!supportsCountry}
              title={
                supportsCountry
                  ? "Filter this page by workshop country"
                  : "This page's data has no country attribution — the filter is kept in the URL but not applied"
              }
              aria-label="Filter by country"
              className={`rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 ${
                supportsCountry ? "" : "opacity-50 cursor-not-allowed"
              }`}
            >
              <option value="all">All countries</option>
              {countryOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label} ({option.users})
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </>
  );
}

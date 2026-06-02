import {
  addStockholmDays,
  addStockholmMonths,
  startOfStockholmDay,
  startOfStockholmIsoWeek,
  startOfStockholmMonth,
  toStockholmIsoDate,
} from "@/lib/ceo/dates";

export const DASHBOARD_TIME_RANGES = [
  {
    key: "today",
    label: "Today",
    shortLabel: "Today",
    description: "Since midnight (Stockholm)",
  },
  {
    key: "yesterday",
    label: "Yesterday",
    shortLabel: "Yesterday",
    description: "Previous day (Stockholm)",
  },
  {
    key: "last_7_days",
    label: "Last 7 days",
    shortLabel: "7D",
    description: "7 complete days ending yesterday",
  },
  {
    key: "last_week",
    label: "Last week",
    shortLabel: "Last wk.",
    description: "Previous Mon–Sun (ISO week)",
  },
  {
    key: "this_month",
    label: "This month",
    shortLabel: "MTD",
    description: "Month to date",
  },
  {
    key: "last_month",
    label: "Last month",
    shortLabel: "Last mo.",
    description: "Completed month",
  },
  {
    key: "last_30_days",
    label: "Last 30 days",
    shortLabel: "30D",
    description: "Default view",
  },
  {
    key: "last_90_days",
    label: "Last 90 days",
    shortLabel: "90D",
    description: "Quarter view",
  },
  {
    key: "all_time",
    label: "All time",
    shortLabel: "All",
    description: "Since first synced metric",
  },
] as const;

export type DashboardTimeRangeKey =
  (typeof DASHBOARD_TIME_RANGES)[number]["key"];

export type DashboardTimeRangeOption = {
  key: DashboardTimeRangeKey;
  label: string;
  shortLabel: string;
  description: string;
  href: string;
  active: boolean;
};

export type ResolvedDashboardRange = {
  key: DashboardTimeRangeKey;
  label: string;
  start: Date | null;
  end: Date;
};

export const DEFAULT_TIME_RANGE_KEY: DashboardTimeRangeKey = "last_30_days";

const TIME_RANGE_KEYS = new Set<string>(
  DASHBOARD_TIME_RANGES.map((range) => range.key),
);

export function isDashboardTimeRangeKey(
  value: string | undefined,
): value is DashboardTimeRangeKey {
  return Boolean(value && TIME_RANGE_KEYS.has(value));
}

export function normalizeDashboardTimeRangeKey(
  value: string | string[] | undefined,
): DashboardTimeRangeKey {
  const candidate = Array.isArray(value) ? value[0] : value;

  return isDashboardTimeRangeKey(candidate)
    ? candidate
    : DEFAULT_TIME_RANGE_KEY;
}

export function getDashboardTimeRangeOptions(
  activeKey: DashboardTimeRangeKey,
): DashboardTimeRangeOption[] {
  return DASHBOARD_TIME_RANGES.map((range) => ({
    ...range,
    href:
      range.key === DEFAULT_TIME_RANGE_KEY
        ? "/dashboard"
        : `/dashboard?range=${range.key}`,
    active: range.key === activeKey,
  }));
}

export function resolveDashboardTimeRange(
  key: DashboardTimeRangeKey,
  now = new Date(),
): ResolvedDashboardRange {
  // All boundaries are Stockholm civil-day midnights (see dates.ts). `end` is
  // always EXCLUSIVE — the half-open interval [start, end).
  const today = startOfStockholmDay(now);
  const tomorrow = addStockholmDays(today, 1);
  const monthStart = startOfStockholmMonth(now);
  const lastMonthStart = addStockholmMonths(monthStart, -1);
  // ISO week — Monday-anchored (Jacob is in Sweden, ISO 8601).
  const thisWeekMonday = startOfStockholmIsoWeek(now);
  const lastWeekMonday = addStockholmDays(thisWeekMonday, -7);
  const definition = DASHBOARD_TIME_RANGES.find((range) => range.key === key)!;

  switch (key) {
    case "today":
      return { key, label: definition.label, start: today, end: tomorrow };
    case "yesterday":
      return {
        key,
        label: definition.label,
        start: addStockholmDays(today, -1),
        end: today,
      };
    // Rolling windows are N complete days ending YESTERDAY (end = start of
    // today, exclusive). Today is intentionally excluded — it's a partial,
    // still-syncing day; use the "Today" filter to see it on its own.
    case "last_7_days":
      return {
        key,
        label: definition.label,
        start: addStockholmDays(today, -7),
        end: today,
      };
    case "last_week":
      return {
        key,
        label: definition.label,
        start: lastWeekMonday,
        end: thisWeekMonday,
      };
    case "this_month":
      return { key, label: definition.label, start: monthStart, end: tomorrow };
    case "last_month":
      return {
        key,
        label: definition.label,
        start: lastMonthStart,
        end: monthStart,
      };
    case "last_90_days":
      return {
        key,
        label: definition.label,
        start: addStockholmDays(today, -90),
        end: today,
      };
    case "all_time":
      return { key, label: definition.label, start: null, end: tomorrow };
    case "last_30_days":
    default:
      return {
        key: "last_30_days",
        label: "Last 30 days",
        start: addStockholmDays(today, -30),
        end: today,
      };
  }
}

export function formatRangeDateSpan(
  range: Pick<ResolvedDashboardRange, "start" | "end" | "key">,
  firstSyncedAt?: string | null,
) {
  if (range.key === "all_time") {
    return firstSyncedAt
      ? `Since ${toStockholmIsoDate(new Date(firstSyncedAt))}`
      : "Waiting for first synced metric";
  }

  if (!range.start) {
    return "All synced history";
  }

  // `end` is exclusive (start of the day after the range) → step back one
  // Stockholm day to get the last day actually included.
  const inclusiveEnd = addStockholmDays(range.end, -1);

  if (toStockholmIsoDate(range.start) === toStockholmIsoDate(inclusiveEnd)) {
    return toStockholmIsoDate(range.start);
  }

  return `${toStockholmIsoDate(range.start)} to ${toStockholmIsoDate(inclusiveEnd)}`;
}

import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import {
  getActiveUsersData,
  type ActiveUserAction,
  type IdentitySource,
} from "@/lib/ceo/data/active-users";
import {
  inCountryWith,
  loadCountryFilterSets,
} from "@/lib/ceo/countries";
import {
  isInternalTestUserOrWorkshopWith,
  loadInternalTestSets,
} from "@/lib/ceo/internal-test/loader";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { TABLES } from "@/lib/ceo/tables";
import { pageAll } from "@/lib/supabase-paging";
import {
  formatRangeDateSpan,
  isDashboardTimeRangeKey,
  resolveDashboardTimeRange,
  type DashboardTimeRangeKey,
} from "@/lib/ceo/time-ranges";

// A leaderboard reads best over a cumulative window, not a single day — so this
// page defaults to last_30_days (every range, incl. all_time, is selectable).
export const TOPLISTS_DEFAULT_RANGE_KEY: DashboardTimeRangeKey = "last_30_days";

// How many rows each leaderboard returns. We slice on the server by a combined
// activity signal so neither heavy-diagnosers nor heavy-clickers get dropped;
// the client re-sorts and re-ranks by whichever column the viewer picks.
const TOP_USERS_LIMIT = 100;
const TOP_CARS_LIMIT = 100;
const TOP_DTCS_PER_CAR = 4;

export function normalizeToplistsRangeKey(
  value: string | string[] | undefined,
): DashboardTimeRangeKey {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isDashboardTimeRangeKey(candidate)
    ? candidate
    : TOPLISTS_DEFAULT_RANGE_KEY;
}

export type TopUserRow = {
  crmUserId: string;
  matched: boolean;
  identitySource: IdentitySource;
  appUsername: string | null;
  workshopId: string | null;
  appRole: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  plan: string | null;
  lifecycleStage: string | null;
  // First-party product action
  diagnostics: number;
  // GA4 web-app engagement (the "car select / button clicks / etc." signal —
  // surfaced as the raw eventName breakdown in topActions)
  events: number;
  sessions: number;
  pageViews: number;
  engagedSeconds: number;
  topActions: ActiveUserAction[];
};

export type TopCarDtc = {
  code: string;
  count: number;
};

export type TopCarRow = {
  key: string;
  make: string | null;
  model: string | null;
  label: string;
  topYear: number | null;
  yearSpan: string | null;
  diagnostics: number;
  distinctUsers: number;
  distinctWorkshops: number;
  completed: number;
  completionRate: number;
  avgCauses: number;
  withChat: number;
  topDtcs: TopCarDtc[];
};

export type ToplistsData = {
  rangeKey: DashboardTimeRangeKey;
  rangeLabel: string;
  rangeSpan: string;
  ga4Available: boolean;
  note: string | null;
  totals: {
    activeUsers: number;
    diagnostics: number;
    distinctCars: number;
  };
  topUsers: TopUserRow[];
  topCars: TopCarRow[];
};

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

// --- Top users -------------------------------------------------------------
// Reuses the active-users loader: GA4 per-user engagement (keyed on
// customUser:crm_user_id, web-app host only) unioned with first-party
// diagnostics, internal-test accounts already excluded.
async function buildTopUsers(
  rangeKey: DashboardTimeRangeKey,
  country: string | null,
): Promise<{
  rows: TopUserRow[];
  totals: { activeUsers: number; diagnostics: number };
  ga4Available: boolean;
  note: string | null;
}> {
  const active = await getActiveUsersData(rangeKey, country);

  const rows: TopUserRow[] = active.rows.map((row) => ({
    crmUserId: row.crmUserId,
    matched: row.matched,
    identitySource: row.identitySource,
    appUsername: row.appUsername,
    workshopId: row.workshopId,
    appRole: row.appRole,
    name: row.name,
    email: row.email,
    company: row.company,
    plan: row.plan,
    lifecycleStage: row.lifecycleStage,
    diagnostics: row.diagnostics,
    events: row.events,
    sessions: row.sessions,
    pageViews: row.pageViews,
    engagedSeconds: row.engagedSeconds,
    topActions: row.topActions,
  }));

  // Slice by a combined signal (events + diagnostics) so both the busiest
  // clickers and the busiest diagnosers survive the cut; the client decides
  // the actual display order.
  rows.sort((a, b) => b.events + b.diagnostics - (a.events + a.diagnostics));

  return {
    rows: rows.slice(0, TOP_USERS_LIMIT),
    totals: {
      activeUsers: active.totals.activeUsers,
      diagnostics: active.totals.diagnostics,
    },
    ga4Available: active.ga4Available,
    note: active.note,
  };
}

// --- Top cars --------------------------------------------------------------
// GA4 events carry no vehicle dimension, so a car can only be identified from
// dashboard_diagnostics.metadata (car_make / car_model / car_year). This
// leaderboard is therefore diagnostics-driven.
type CarDiagnosticRow = {
  internal_user_id: string | null;
  workshop_id: string | null;
  status: string | null;
  completed_at: string | null;
  num_causes: number | null;
  has_chat: boolean | null;
  metadata: Record<string, unknown> | null;
};

type CarAccumulator = {
  make: string | null;
  model: string | null;
  diagnostics: number;
  completed: number;
  causeSum: number;
  withChat: number;
  users: Set<string>;
  workshops: Set<string>;
  years: Map<number, number>;
  dtcs: Map<string, number>;
};

async function buildTopCars(
  rangeKey: DashboardTimeRangeKey,
  country: string | null,
): Promise<{
  rows: TopCarRow[];
  distinctCars: number;
}> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return { rows: [], distinctCars: 0 };

  const range = resolveDashboardTimeRange(rangeKey);
  const startIso = range.start?.toISOString();
  const endIso = range.end.toISOString();
  const [sets, countrySets] = await Promise.all([
    loadInternalTestSets(),
    loadCountryFilterSets(country),
  ]);

  const result = await pageAll<CarDiagnosticRow>(({ from, to }) => {
    let q = supabase
      .from(TABLES.diagnostics)
      .select(
        "internal_user_id, workshop_id, status, completed_at, num_causes, has_chat, metadata",
      )
      .lt("created_at", endIso)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (startIso) q = q.gte("created_at", startIso);
    return q;
  });

  if (result.error) {
    console.error("Top cars diagnostics read failed", result.error);
    return { rows: [], distinctCars: 0 };
  }

  const cars = new Map<string, CarAccumulator>();

  for (const row of result.data) {
    if (
      isInternalTestUserOrWorkshopWith(
        sets,
        row.internal_user_id,
        row.workshop_id,
      )
    ) {
      continue;
    }
    if (
      countrySets &&
      !inCountryWith(countrySets, row.internal_user_id, row.workshop_id)
    ) {
      continue;
    }

    const metadata = row.metadata ?? {};
    const make = asString(metadata.car_make);
    const model = asString(metadata.car_model);
    // A row with neither make nor model can't be attributed to a car.
    if (!make && !model) continue;

    const key = `${(make ?? "").toLowerCase()}|||${(model ?? "").toLowerCase()}`;
    let car = cars.get(key);
    if (!car) {
      car = {
        make,
        model,
        diagnostics: 0,
        completed: 0,
        causeSum: 0,
        withChat: 0,
        users: new Set<string>(),
        workshops: new Set<string>(),
        years: new Map<number, number>(),
        dtcs: new Map<string, number>(),
      };
      cars.set(key, car);
    }

    car.diagnostics += 1;
    if (row.completed_at) car.completed += 1;
    car.causeSum += Number(row.num_causes ?? 0);
    if (row.has_chat) car.withChat += 1;
    if (row.internal_user_id) car.users.add(row.internal_user_id);
    if (row.workshop_id) car.workshops.add(row.workshop_id);

    const year = asNumber(metadata.car_year);
    if (year !== null) {
      car.years.set(year, (car.years.get(year) ?? 0) + 1);
    }
    for (const code of asStringArray(metadata.dtcs)) {
      const dtc = code.toUpperCase();
      car.dtcs.set(dtc, (car.dtcs.get(dtc) ?? 0) + 1);
    }
  }

  const rows: TopCarRow[] = [...cars.entries()].map(([key, car]) => {
    const yearEntries = [...car.years.entries()];
    const topYear =
      yearEntries.length > 0
        ? yearEntries.sort((a, b) => b[1] - a[1])[0][0]
        : null;
    const years = yearEntries.map(([year]) => year);
    const minYear = years.length ? Math.min(...years) : null;
    const maxYear = years.length ? Math.max(...years) : null;
    const yearSpan =
      minYear !== null && maxYear !== null && minYear !== maxYear
        ? `${minYear}–${maxYear}`
        : null;

    const label = [car.make, car.model].filter(Boolean).join(" ") || "Unknown";

    return {
      key,
      make: car.make,
      model: car.model,
      label,
      topYear,
      yearSpan,
      diagnostics: car.diagnostics,
      distinctUsers: car.users.size,
      distinctWorkshops: car.workshops.size,
      completed: car.completed,
      completionRate: car.diagnostics
        ? (car.completed / car.diagnostics) * 100
        : 0,
      avgCauses: car.diagnostics ? car.causeSum / car.diagnostics : 0,
      withChat: car.withChat,
      topDtcs: [...car.dtcs.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_DTCS_PER_CAR),
    };
  });

  const distinctCars = rows.length;
  rows.sort((a, b) => b.diagnostics - a.diagnostics);

  return { rows: rows.slice(0, TOP_CARS_LIMIT), distinctCars };
}

async function getToplistsDataUncached(
  rangeKey: DashboardTimeRangeKey,
  country: string | null,
): Promise<ToplistsData> {
  const range = resolveDashboardTimeRange(rangeKey);
  const rangeSpan = formatRangeDateSpan(range);

  const [users, cars] = await Promise.all([
    buildTopUsers(rangeKey, country),
    buildTopCars(rangeKey, country),
  ]);

  return {
    rangeKey,
    rangeLabel: range.label,
    rangeSpan,
    ga4Available: users.ga4Available,
    note: users.note,
    totals: {
      activeUsers: users.totals.activeUsers,
      diagnostics: users.totals.diagnostics,
      distinctCars: cars.distinctCars,
    },
    topUsers: users.rows,
    topCars: cars.rows,
  };
}

const getToplistsDataCached = unstable_cache(
  (rangeKey: string, country: string | null) =>
    getToplistsDataUncached(rangeKey as DashboardTimeRangeKey, country),
  ["ceo-toplists-data"],
  CEO_CACHE_OPTIONS,
);

export function getToplistsData(
  rangeParam?: string | string[],
  country: string | null = null,
): Promise<ToplistsData> {
  return getToplistsDataCached(normalizeToplistsRangeKey(rangeParam), country);
}

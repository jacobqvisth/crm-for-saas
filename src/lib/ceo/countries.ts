import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { pageAll } from "@/lib/supabase-paging";
import { TABLES } from "@/lib/ceo/tables";

// Country filter for the /dashboard/* statistics pages.
//
// The canonical country signal is dashboard_workshops.country (ISO 3166-1
// alpha-2, straight from the codeoc export). Users inherit their workshop's
// country via dashboard_users.workshop_id — 836/837 users link to a workshop,
// so a user→country map built from that join covers effectively everyone.
// GA4-based metrics that have no user identity (anonymous traffic) filter on
// GA4's own `countryId` dimension instead, which is IP-geo rather than
// workshop country — close enough in practice, but not identical by
// construction.

export type DashboardCountryOption = {
  code: string;
  label: string;
  users: number;
};

// The selected country is carried as `?country=SE` on every /dashboard/* URL
// (absent = all countries), mirroring how `range` works.
export function normalizeDashboardCountry(
  value: string | string[] | undefined,
): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return null;
  const code = candidate.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryDisplayLabel(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

type WorkshopCountryRow = {
  workshop_id: string;
  country: string | null;
};

type UserWorkshopRow = {
  internal_user_id: string;
  workshop_id: string | null;
};

// Dropdown options: every country that has at least one app user, ordered by
// user count. Cached like the other dashboard loaders so the shell render
// stays cheap.
const getDashboardCountryOptionsCached = unstable_cache(
  async (): Promise<DashboardCountryOption[]> => {
    const supabase = createSupabaseServiceClient();
    if (!supabase) return [];

    const [workshopsResult, usersResult] = await Promise.all([
      pageAll<WorkshopCountryRow>(({ from, to }) =>
        supabase
          .from(TABLES.workshops)
          .select("workshop_id, country")
          .order("workshop_id", { ascending: true })
          .range(from, to),
      ),
      pageAll<UserWorkshopRow>(({ from, to }) =>
        supabase
          .from(TABLES.users)
          .select("internal_user_id, workshop_id")
          .order("internal_user_id", { ascending: true })
          .range(from, to),
      ),
    ]);

    if (workshopsResult.error || usersResult.error) {
      console.error("Country options read failed", {
        workshops: workshopsResult.error,
        users: usersResult.error,
      });
      return [];
    }

    const countryByWorkshop = new Map<string, string>();
    for (const row of workshopsResult.data) {
      const code = row.country?.trim().toUpperCase();
      if (code && /^[A-Z]{2}$/.test(code)) {
        countryByWorkshop.set(row.workshop_id, code);
      }
    }

    const usersByCountry = new Map<string, number>();
    for (const row of usersResult.data) {
      const code = row.workshop_id
        ? countryByWorkshop.get(row.workshop_id)
        : undefined;
      if (!code) continue;
      usersByCountry.set(code, (usersByCountry.get(code) ?? 0) + 1);
    }

    return [...usersByCountry.entries()]
      .map(([code, users]) => ({
        code,
        label: countryDisplayLabel(code),
        users,
      }))
      .sort((a, b) => b.users - a.users || a.label.localeCompare(b.label));
  },
  ["ceo-country-options"],
  CEO_CACHE_OPTIONS,
);

export function getDashboardCountryOptions(): Promise<
  DashboardCountryOption[]
> {
  return getDashboardCountryOptionsCached();
}

export type CountryFilterSets = {
  country: string;
  // Cognito subs (dashboard_users.internal_user_id = contacts.wl_user_id =
  // GA4 customUser:crm_user_id) of every user in the country.
  userIds: Set<string>;
  // wl workshop ids in the country.
  workshopIds: Set<string>;
};

// Id sets for one country, for loaders to filter user/workshop-keyed rows.
// Deliberately NOT wrapped in unstable_cache (Sets don't survive its JSON
// round-trip) — every caller is itself a cached loader whose key includes the
// country, so this runs at most once per (loader, range, country) per TTL.
export async function loadCountryFilterSets(
  country: string | null,
): Promise<CountryFilterSets | null> {
  if (!country) return null;
  const supabase = createSupabaseServiceClient();
  if (!supabase) return null;

  const workshopsResult = await pageAll<WorkshopCountryRow>(({ from, to }) =>
    supabase
      .from(TABLES.workshops)
      .select("workshop_id, country")
      .ilike("country", country)
      .order("workshop_id", { ascending: true })
      .range(from, to),
  );
  if (workshopsResult.error) {
    console.error("Country filter workshops read failed", workshopsResult.error);
    return { country, userIds: new Set(), workshopIds: new Set() };
  }
  const workshopIds = new Set(
    workshopsResult.data.map((row) => row.workshop_id),
  );

  // ~850 users total — page them all and join locally rather than chunking a
  // potentially-hundreds-long .in() list into PostgREST URLs.
  const usersResult = await pageAll<UserWorkshopRow>(({ from, to }) =>
    supabase
      .from(TABLES.users)
      .select("internal_user_id, workshop_id")
      .order("internal_user_id", { ascending: true })
      .range(from, to),
  );
  if (usersResult.error) {
    console.error("Country filter users read failed", usersResult.error);
    return { country, userIds: new Set(), workshopIds };
  }
  const userIds = new Set(
    usersResult.data
      .filter((row) => row.workshop_id && workshopIds.has(row.workshop_id))
      .map((row) => row.internal_user_id),
  );

  return { country, userIds, workshopIds };
}

// True when the row (keyed by user and/or workshop) belongs to the country.
// Rows with neither key resolvable are dropped while a filter is active —
// "unknown" is not the same as the selected country.
export function inCountryWith(
  sets: CountryFilterSets,
  internalUserId: string | null | undefined,
  workshopId: string | null | undefined,
): boolean {
  if (internalUserId && sets.userIds.has(internalUserId)) return true;
  if (workshopId && sets.workshopIds.has(workshopId)) return true;
  return false;
}

// User profile helpers for route generation: origin resolution, working calendar.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type WorkingDays = Record<DayKey, boolean>;

export const DEFAULT_WORKING_DAYS: WorkingDays = {
  mon: true,
  tue: true,
  wed: true,
  thu: true,
  fri: true,
  sat: false,
  sun: false,
};

const DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type ResolvedOrigin = {
  address: string;
  lat: number;
  lng: number;
  /** Where the origin came from. */
  source: "user_profile" | "env_default";
};

function envDefaultOrigin(): ResolvedOrigin | null {
  const address = process.env.ROUTE_DEFAULT_ORIGIN_ADDRESS;
  const lat = Number(process.env.ROUTE_DEFAULT_ORIGIN_LAT ?? "");
  const lng = Number(process.env.ROUTE_DEFAULT_ORIGIN_LNG ?? "");
  if (!address || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { address, lat, lng, source: "env_default" };
}

/**
 * Resolve a user's origin in this order:
 *   1. user_profiles.origin_* if all three (address, lat, lng) are set
 *   2. ROUTE_DEFAULT_ORIGIN_* env vars
 *
 * The explicit override (one-off start address from generate request) is
 * handled by the caller — this only resolves the per-user vs env fallback.
 */
export async function getUserOrigin(
  userId: string,
  supabase: SupabaseClient<Database>,
): Promise<ResolvedOrigin | null> {
  const { data } = await supabase
    .from("user_profiles")
    .select("origin_address, origin_latitude, origin_longitude")
    .eq("user_id", userId)
    .maybeSingle();

  if (
    data?.origin_address &&
    data.origin_latitude != null &&
    data.origin_longitude != null
  ) {
    return {
      address: data.origin_address,
      lat: data.origin_latitude,
      lng: data.origin_longitude,
      source: "user_profile",
    };
  }

  return envDefaultOrigin();
}

export function parseWorkingDays(raw: unknown): WorkingDays {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_WORKING_DAYS;
  }
  const r = raw as Record<string, unknown>;
  const out: WorkingDays = { ...DEFAULT_WORKING_DAYS };
  for (const key of Object.keys(out) as DayKey[]) {
    if (typeof r[key] === "boolean") out[key] = r[key] as boolean;
  }
  return out;
}

export async function getWorkingDays(
  userId: string,
  supabase: SupabaseClient<Database>,
): Promise<WorkingDays> {
  const { data } = await supabase
    .from("user_profiles")
    .select("working_days")
    .eq("user_id", userId)
    .maybeSingle();
  return parseWorkingDays(data?.working_days ?? null);
}

/** "YYYY-MM-DD" → DayKey (UTC day). */
export function dayKeyForIsoDate(isoDate: string): DayKey {
  // Parse as UTC noon to avoid TZ off-by-one on midnight boundaries.
  const d = new Date(`${isoDate}T12:00:00Z`);
  return DAY_KEYS[d.getUTCDay()];
}

export type UnavailableReason =
  | { kind: "non_working_day"; day: DayKey }
  | { kind: "pto"; reason: string | null };

/**
 * Returns truthy reason if the user can't work this date — non-working day
 * (per their working_days JSON) or has a user_unavailable_dates row.
 */
export async function isUnavailable(
  userId: string,
  isoDate: string,
  supabase: SupabaseClient<Database>,
): Promise<UnavailableReason | null> {
  const day = dayKeyForIsoDate(isoDate);
  const working = await getWorkingDays(userId, supabase);
  if (!working[day]) return { kind: "non_working_day", day };

  const { data } = await supabase
    .from("user_unavailable_dates")
    .select("reason")
    .eq("user_id", userId)
    .eq("date", isoDate)
    .maybeSingle();

  if (data) return { kind: "pto", reason: data.reason ?? null };
  return null;
}

import { cache } from "react";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";

// Internal-test exclusions used to live in src/config/ceo/internal-test-users.ts
// as static const lists. They now live in the database (dashboard_users.is_internal_test,
// dashboard_workshops.is_internal_test, dashboard_internal_test_patterns) so the
// CEO can manage them from /ceo/settings without a redeploy.
//
// `loadInternalTestSets` is cached per request via React `cache()` so every data
// query that needs to filter rows pays the round-trip exactly once per render.

export type InternalTestSets = {
  userIds: Set<string>;
  workshopIds: Set<string>;
  exemptUserIds: Set<string>;
  emails: Set<string>;
  usernames: Set<string>;
};

export type InternalTestUserRecord = {
  internalUserId: string;
  workshopId: string | null;
  isInternalTest: boolean;
  isInternalTestExempt: boolean;
  internalTestNote: string | null;
  internalTestSetAt: string | null;
  internalTestSetBy: string | null;
};

export type InternalTestWorkshopRecord = {
  workshopId: string;
  name: string | null;
  isInternalTest: boolean;
  internalTestNote: string | null;
  internalTestSetAt: string | null;
  internalTestSetBy: string | null;
};

export type InternalTestPatternRecord = {
  id: string;
  kind: "email" | "username";
  value: string;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
};

const EMPTY_SETS: InternalTestSets = {
  userIds: new Set(),
  workshopIds: new Set(),
  exemptUserIds: new Set(),
  emails: new Set(),
  usernames: new Set(),
};

export const loadInternalTestSets = cache(
  async (): Promise<InternalTestSets> => {
    const supabase = createSupabaseServiceClient();
    if (!supabase) return EMPTY_SETS;

    const [usersResult, workshopsResult, patternsResult] = await Promise.all([
      supabase
        .from("dashboard_users")
        .select("internal_user_id, is_internal_test, is_internal_test_exempt")
        .or("is_internal_test.eq.true,is_internal_test_exempt.eq.true"),
      supabase
        .from("dashboard_workshops")
        .select("workshop_id, is_internal_test")
        .eq("is_internal_test", true),
      supabase
        .from("dashboard_internal_test_patterns")
        .select("kind, value"),
    ]);

    const userIds = new Set<string>();
    const exemptUserIds = new Set<string>();
    const workshopIds = new Set<string>();
    const emails = new Set<string>();
    const usernames = new Set<string>();

    for (const row of (usersResult.data ?? []) as Array<{
      internal_user_id: string | null;
      is_internal_test: boolean | null;
      is_internal_test_exempt: boolean | null;
    }>) {
      const id = row.internal_user_id;
      if (!id) continue;
      if (row.is_internal_test) userIds.add(id);
      if (row.is_internal_test_exempt) exemptUserIds.add(id);
    }

    for (const row of (workshopsResult.data ?? []) as Array<{
      workshop_id: string | null;
      is_internal_test: boolean | null;
    }>) {
      if (row.workshop_id && row.is_internal_test) {
        workshopIds.add(row.workshop_id);
      }
    }

    for (const row of (patternsResult.data ?? []) as Array<{
      kind: string | null;
      value: string | null;
    }>) {
      if (!row.value) continue;
      const normalized = row.value.trim().toLowerCase();
      if (!normalized) continue;
      if (row.kind === "email") emails.add(normalized);
      else if (row.kind === "username") usernames.add(normalized);
    }

    return { userIds, workshopIds, exemptUserIds, emails, usernames };
  },
);

function asKey(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

export function isInternalTestExemptUserIdWith(
  sets: InternalTestSets,
  userId: string | number | null | undefined,
): boolean {
  const id = asKey(userId);
  return Boolean(id && sets.exemptUserIds.has(id));
}

export function isInternalTestUserIdWith(
  sets: InternalTestSets,
  userId: string | number | null | undefined,
): boolean {
  const id = asKey(userId);
  return Boolean(id && sets.userIds.has(id));
}

export function isInternalTestWorkshopIdWith(
  sets: InternalTestSets,
  workshopId: string | number | null | undefined,
): boolean {
  const id = asKey(workshopId);
  return Boolean(id && sets.workshopIds.has(id));
}

export function isInternalTestEmailWith(
  sets: InternalTestSets,
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return sets.emails.has(email.trim().toLowerCase());
}

export function isInternalTestUsernameWith(
  sets: InternalTestSets,
  username: string | null | undefined,
): boolean {
  if (!username) return false;
  return sets.usernames.has(username.trim().toLowerCase());
}

// Combined check used at every per-row exclusion site. Honors the per-user
// exempt set so an individual user inside an internal workshop can still be
// counted.
export function isInternalTestUserOrWorkshopWith(
  sets: InternalTestSets,
  userId: string | number | null | undefined,
  workshopId: string | number | null | undefined,
): boolean {
  if (isInternalTestExemptUserIdWith(sets, userId)) return false;
  return (
    isInternalTestUserIdWith(sets, userId) ||
    isInternalTestWorkshopIdWith(sets, workshopId)
  );
}

export function isInternalTestUserWith(
  sets: InternalTestSets,
  input: {
    internalUserId?: string | number | null;
    workshopId?: string | number | null;
    email?: string | null;
    username?: string | null;
  },
): boolean {
  if (isInternalTestExemptUserIdWith(sets, input.internalUserId)) return false;
  return (
    isInternalTestUserIdWith(sets, input.internalUserId) ||
    isInternalTestWorkshopIdWith(sets, input.workshopId) ||
    isInternalTestEmailWith(sets, input.email) ||
    isInternalTestUsernameWith(sets, input.username)
  );
}

// Unfiltered detail-row loaders for the /ceo/settings management UI.
// The settings page wants to see ALL users + workshops (filtered or not), with
// metadata for editing — not the boolean-only sets the data layer needs.

export async function listInternalTestUsers(): Promise<
  InternalTestUserRecord[]
> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("dashboard_users")
    .select(
      "internal_user_id, workshop_id, is_internal_test, is_internal_test_exempt, internal_test_note, internal_test_set_at, internal_test_set_by",
    )
    .or("is_internal_test.eq.true,is_internal_test_exempt.eq.true")
    .order("internal_test_set_at", { ascending: false });

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    internalUserId: String(row.internal_user_id ?? ""),
    workshopId: row.workshop_id == null ? null : String(row.workshop_id),
    isInternalTest: Boolean(row.is_internal_test),
    isInternalTestExempt: Boolean(row.is_internal_test_exempt),
    internalTestNote:
      row.internal_test_note == null ? null : String(row.internal_test_note),
    internalTestSetAt:
      row.internal_test_set_at == null
        ? null
        : String(row.internal_test_set_at),
    internalTestSetBy:
      row.internal_test_set_by == null
        ? null
        : String(row.internal_test_set_by),
  }));
}

export async function listInternalTestWorkshops(): Promise<
  InternalTestWorkshopRecord[]
> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("dashboard_workshops")
    .select(
      "workshop_id, name, is_internal_test, internal_test_note, internal_test_set_at, internal_test_set_by",
    )
    .eq("is_internal_test", true)
    .order("internal_test_set_at", { ascending: false });

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    workshopId: String(row.workshop_id ?? ""),
    name: row.name == null ? null : String(row.name),
    isInternalTest: Boolean(row.is_internal_test),
    internalTestNote:
      row.internal_test_note == null ? null : String(row.internal_test_note),
    internalTestSetAt:
      row.internal_test_set_at == null
        ? null
        : String(row.internal_test_set_at),
    internalTestSetBy:
      row.internal_test_set_by == null
        ? null
        : String(row.internal_test_set_by),
  }));
}

export type SettingsUserSearchRow = {
  internalUserId: string;
  workshopId: string | null;
  name: string | null;
  customerIoId: string | null;
  emailDomain: string | null;
  username: string | null;
  isInternalTest: boolean;
  isInternalTestExempt: boolean;
  internalTestNote: string | null;
};

export type SettingsWorkshopSearchRow = {
  workshopId: string;
  name: string | null;
  country: string | null;
  isInternalTest: boolean;
  internalTestNote: string | null;
};

export async function searchDashboardUsers(
  query: string,
  limit = 50,
): Promise<SettingsUserSearchRow[]> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];

  const trimmed = query.trim();
  let request = supabase
    .from("dashboard_users")
    .select(
      "internal_user_id, workshop_id, name, customer_io_id, metadata, is_internal_test, is_internal_test_exempt, internal_test_note",
    )
    .order("internal_test_set_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (trimmed.length > 0) {
    const escaped = trimmed.replaceAll("%", "").replaceAll(",", "");
    // Search across the canonical id columns + the human-readable name + any
    // note we've already attached. PostgREST .or() ilikes are case-insensitive.
    request = request.or(
      [
        `internal_user_id.ilike.%${escaped}%`,
        `workshop_id.ilike.%${escaped}%`,
        `name.ilike.%${escaped}%`,
        `internal_test_note.ilike.%${escaped}%`,
        `customer_io_id.ilike.%${escaped}%`,
      ].join(","),
    );
  }

  const { data } = await request;

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return {
      internalUserId: String(row.internal_user_id ?? ""),
      workshopId: row.workshop_id == null ? null : String(row.workshop_id),
      name: row.name == null ? null : String(row.name),
      customerIoId:
        row.customer_io_id == null ? null : String(row.customer_io_id),
      emailDomain:
        metadata.email_domain == null ? null : String(metadata.email_domain),
      username:
        metadata.username == null ? null : String(metadata.username),
      isInternalTest: Boolean(row.is_internal_test),
      isInternalTestExempt: Boolean(row.is_internal_test_exempt),
      internalTestNote:
        row.internal_test_note == null
          ? null
          : String(row.internal_test_note),
    };
  });
}

export async function searchDashboardWorkshops(
  query: string,
  limit = 50,
): Promise<SettingsWorkshopSearchRow[]> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];

  const trimmed = query.trim();
  let request = supabase
    .from("dashboard_workshops")
    .select(
      "workshop_id, name, country, is_internal_test, internal_test_note",
    )
    .order("internal_test_set_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (trimmed.length > 0) {
    const escaped = trimmed.replaceAll("%", "").replaceAll(",", "");
    request = request.or(
      [
        `workshop_id.ilike.%${escaped}%`,
        `name.ilike.%${escaped}%`,
        `internal_test_note.ilike.%${escaped}%`,
        `country.ilike.%${escaped}%`,
      ].join(","),
    );
  }

  const { data } = await request;

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    workshopId: String(row.workshop_id ?? ""),
    name: row.name == null ? null : String(row.name),
    country: row.country == null ? null : String(row.country),
    isInternalTest: Boolean(row.is_internal_test),
    internalTestNote:
      row.internal_test_note == null ? null : String(row.internal_test_note),
  }));
}

export async function listInternalTestPatterns(): Promise<
  InternalTestPatternRecord[]
> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("dashboard_internal_test_patterns")
    .select("id, kind, value, note, created_at, created_by")
    .order("kind", { ascending: true })
    .order("value", { ascending: true });

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id ?? ""),
    kind: (row.kind === "email" ? "email" : "username") as "email" | "username",
    value: String(row.value ?? ""),
    note: row.note == null ? null : String(row.note),
    createdAt: String(row.created_at ?? ""),
    createdBy: row.created_by == null ? null : String(row.created_by),
  }));
}

// After a successful `core_app` sync, push the freshly-written `dashboard_users`
// and `dashboard_workshops` rows into the CRM's `contacts` and `companies`
// tables. UPDATE-only: we never insert or unlink, we only refresh fields on
// rows that are already linked via `wl_user_id` / `wl_workshop_id`.
//
// New links can't be created here — `dashboard_users.email_hash` is hashed,
// so the only safe join is by an already-known wl_user_id.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { deriveLifecycleStage } from "@/lib/wl-sync/matching";

const PAGE_SIZE = 1000;
const CHUNK_IN = 200;
const UPDATE_BATCH = 50;

export type PropagationResult = {
  contactsUpdated: number;
  companiesUpdated: number;
  diagnosticsContactsRefreshed: number;
  diagnosticsCompaniesRefreshed: number;
};

export async function propagateDashboardToCrm(
  supabase: SupabaseClient<Database>,
): Promise<PropagationResult> {
  const [contactsUpdated, companiesUpdated] = await Promise.all([
    propagateUsersToContacts(supabase),
    propagateWorkshopsToCompanies(supabase),
  ]);
  const { diagnosticsContactsRefreshed, diagnosticsCompaniesRefreshed } =
    await refreshDiagnosticsAggregates(supabase);
  return {
    contactsUpdated,
    companiesUpdated,
    diagnosticsContactsRefreshed,
    diagnosticsCompaniesRefreshed,
  };
}

// Recomputes contacts.diagnostics_* and companies.diagnostics_* from
// dashboard_diagnostics via the refresh_diagnostics_aggregates() SQL RPC.
// Runs after the user/workshop propagation so aggregates line up with the
// latest S3-synced rows.
async function refreshDiagnosticsAggregates(
  supabase: SupabaseClient<Database>,
): Promise<{
  diagnosticsContactsRefreshed: number;
  diagnosticsCompaniesRefreshed: number;
}> {
  const { data, error } = await supabase.rpc("refresh_diagnostics_aggregates");
  if (error) throw error;
  const payload = (data ?? {}) as {
    contacts_updated?: number;
    companies_updated?: number;
  };
  return {
    diagnosticsContactsRefreshed: payload.contacts_updated ?? 0,
    diagnosticsCompaniesRefreshed: payload.companies_updated ?? 0,
  };
}

async function propagateUsersToContacts(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const contacts = await fetchAll(supabase, async (offset) =>
    supabase
      .from("contacts")
      .select("id, wl_user_id")
      .not("wl_user_id", "is", null)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1),
  );

  const linkedIds = contacts
    .map((c) => c.wl_user_id)
    .filter((v): v is string => !!v);
  if (linkedIds.length === 0) return 0;

  const usersById = new Map<string, DashboardUserShape>();
  for (let i = 0; i < linkedIds.length; i += CHUNK_IN) {
    const slice = linkedIds.slice(i, i + CHUNK_IN);
    const { data, error } = await supabase
      .from("dashboard_users")
      .select(
        "internal_user_id, last_seen_at, name, phone, core_stripe_customer_id, metadata",
      )
      .in("internal_user_id", slice);
    if (error) throw error;
    for (const u of data ?? []) {
      if (!u.internal_user_id) continue;
      usersById.set(u.internal_user_id, u as DashboardUserShape);
    }
  }

  let updated = 0;
  for (let i = 0; i < contacts.length; i += UPDATE_BATCH) {
    const batch = contacts.slice(i, i + UPDATE_BATCH);
    await Promise.all(
      batch.map(async (contact) => {
        if (!contact.wl_user_id) return;
        const u = usersById.get(contact.wl_user_id);
        if (!u) return;
        const meta = readMetadata(u.metadata);
        const update = {
          app_username: meta.username,
          app_role: normalizeAppRole(meta.user_role),
          last_active_at: u.last_seen_at,
          login_count: meta.login_count,
          credits_remaining: meta.credits_remaining,
          user_plan_type: meta.plan_type,
          user_subscription_status: meta.subscription_status,
          user_stripe_customer_id:
            u.core_stripe_customer_id ?? meta.stripe_customer_id,
          user_stripe_subscription_id: meta.stripe_subscription_id,
        };
        const { error } = await supabase
          .from("contacts")
          .update(update)
          .eq("id", contact.id);
        if (error) throw error;
        updated += 1;
      }),
    );
  }
  return updated;
}

async function propagateWorkshopsToCompanies(
  supabase: SupabaseClient<Database>,
): Promise<number> {
  const companies = await fetchAll(supabase, async (offset) =>
    supabase
      .from("companies")
      .select("id, wl_workshop_id")
      .not("wl_workshop_id", "is", null)
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1),
  );

  const linkedIds = companies
    .map((c) => c.wl_workshop_id)
    .filter((v): v is string => !!v);
  if (linkedIds.length === 0) return 0;

  const workshopsById = new Map<string, DashboardWorkshopShape>();
  for (let i = 0; i < linkedIds.length; i += CHUNK_IN) {
    const slice = linkedIds.slice(i, i + CHUNK_IN);
    const { data, error } = await supabase
      .from("dashboard_workshops")
      .select(
        "workshop_id, name, country, activated_at, plan_key, core_subscription_status, payment_status, trial_end, core_stripe_customer_id, core_stripe_subscription_id, metadata",
      )
      .in("workshop_id", slice);
    if (error) throw error;
    for (const w of data ?? []) {
      if (!w.workshop_id) continue;
      workshopsById.set(w.workshop_id, w as DashboardWorkshopShape);
    }
  }

  let updated = 0;
  for (let i = 0; i < companies.length; i += UPDATE_BATCH) {
    const batch = companies.slice(i, i + UPDATE_BATCH);
    await Promise.all(
      batch.map(async (company) => {
        if (!company.wl_workshop_id) return;
        const w = workshopsById.get(company.wl_workshop_id);
        if (!w) return;
        const meta = readMetadata(w.metadata);
        const customerStatus = deriveCustomerStatus(
          w.core_subscription_status,
          w.activated_at,
        );
        // Keep lifecycle_stage in sync with the live subscription + plan so it
        // never drifts from the plan column (active free → 'freemium', active
        // paid → 'paying', etc.). Only applied when the derivation is
        // conclusive — past_due / unknown statuses preserve the existing stage.
        const lifecycleStage = deriveLifecycleStage(
          w.core_subscription_status,
          w.plan_key,
        );
        const memberCount =
          typeof meta.member_count === "number" ? meta.member_count : null;
        const update = {
          activated_at: w.activated_at,
          subscription_status: w.core_subscription_status,
          payment_status: w.payment_status,
          trial_ends_at: w.trial_end,
          plan: w.plan_key,
          stripe_customer_id: w.core_stripe_customer_id,
          stripe_subscription_id: w.core_stripe_subscription_id,
          customer_status: customerStatus,
          member_count: memberCount,
          ...(lifecycleStage ? { lifecycle_stage: lifecycleStage } : {}),
        };
        const { error } = await supabase
          .from("companies")
          .update(update)
          .eq("id", company.id);
        if (error) throw error;
        updated += 1;
      }),
    );
  }
  return updated;
}

// ---------------------------------------------------------------------------

type DashboardUserShape = {
  internal_user_id: string | null;
  last_seen_at: string | null;
  name: string | null;
  phone: string | null;
  core_stripe_customer_id: string | null;
  metadata: Json | null;
};

type DashboardWorkshopShape = {
  workshop_id: string | null;
  name: string | null;
  country: string | null;
  activated_at: string | null;
  plan_key: string | null;
  core_subscription_status: string | null;
  payment_status: string | null;
  trial_end: string | null;
  core_stripe_customer_id: string | null;
  core_stripe_subscription_id: string | null;
  metadata: Json | null;
};

type MetadataShape = {
  username: string | null;
  user_role: string | null;
  login_count: number | null;
  credits_remaining: number | null;
  plan_type: string | null;
  subscription_status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  member_count: number | null;
};

function readMetadata(raw: Json | null): MetadataShape {
  const empty: MetadataShape = {
    username: null,
    user_role: null,
    login_count: null,
    credits_remaining: null,
    plan_type: null,
    subscription_status: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    member_count: null,
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const obj = raw as Record<string, Json>;
  return {
    username: stringOr(obj.username),
    user_role: stringOr(obj.user_role),
    login_count: numberOr(obj.login_count),
    credits_remaining: numberOr(obj.credits_remaining),
    plan_type: stringOr(obj.plan_type),
    subscription_status: stringOr(obj.subscription_status),
    stripe_customer_id: stringOr(obj.stripe_customer_id),
    stripe_subscription_id: stringOr(obj.stripe_subscription_id),
    member_count: numberOr(obj.member_count),
  };
}

function stringOr(v: Json | undefined): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function numberOr(v: Json | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeAppRole(v: string | null): string | null {
  if (!v) return null;
  const lower = v.trim().toLowerCase();
  if (lower === "admin" || lower === "mechanic") return lower;
  return null;
}

function deriveCustomerStatus(
  coreSubscriptionStatus: string | null,
  activatedAt: string | null,
): string | null {
  const s = coreSubscriptionStatus?.toLowerCase() ?? null;
  if (s === "trialing") return "trialing";
  if (s === "active" || s === "past_due") return "active";
  if (s === "canceled" || s === "incomplete_expired" || s === "unpaid") {
    return activatedAt ? "inactive" : null;
  }
  return null;
}

type RangeQuery<T> = (offset: number) => PromiseLike<{
  data: T[] | null;
  error: unknown;
}>;

async function fetchAll<T>(
  _supabase: SupabaseClient<Database>,
  range: RangeQuery<T>,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await range(offset);
    if (error) throw error;
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

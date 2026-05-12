// Discover newly-signed-up WL-app users and link them into the CRM.
//
// The existing `core_app` sync (src/lib/ceo/sync/sources/core-app.ts) writes
// fresh rows to `dashboard_*` tables. The propagator
// (src/lib/ceo/sync/propagate-to-crm.ts) then UPDATEs `contacts`/`companies`
// for rows already linked via `wl_user_id`/`wl_workshop_id`. By design, it
// never inserts — `dashboard_users.email_hash` is hashed, so the propagator
// has no way to construct a plaintext email for a new contact.
//
// This module fills that gap. It fetches `latest/user_stats.json.gz` from S3
// (which DOES carry plaintext email) and INSERTs CRM rows for workshops /
// users that aren't yet linked. For email collisions with existing prospect
// contacts, it merges in place: sets `wl_user_id` + `source='wl-app'` on the
// existing row instead of creating a duplicate.
//
// Internal-test workshops (`dashboard_workshops.is_internal_test = true`) are
// skipped — same exclusion list the CEO dashboard uses.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { gunzipSync } from "node:zlib";
import { createClient as createUntypedClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0"; // wrenchlane.com workspace
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DiscoverResult = {
  newCompanies: number;
  newContacts: number;
  mergedContacts: number;
  skippedInternalTest: number;
  errors: number;
  s3RowsValid: number;
  cioRowsFetched: number;
  cioOnlyWorkshops: number;
};

type UserStatRow = {
  user_id: string;
  username: string | null;
  email: string | null;
  name: string | null;
  phone: string | null;
  user_role: string | null;
  workshop_id: string | null;
  company_name: string | null;
  country: string | null;
  language: string | null;
  subscription_status: string | null;
  workshop_created_at: string | null;
};

async function fetchUserStats(): Promise<UserStatRow[]> {
  const client = new S3Client({ region: process.env.AWS_REGION ?? "eu-north-1" });
  const cmd = new GetObjectCommand({
    Bucket: process.env.DATA_BUCKET ?? "codeoc-dashboard-prod",
    Key: "latest/user_stats.json.gz",
  });
  const res = await client.send(cmd);
  if (!res.Body) throw new Error("Empty body from S3");
  const buf = Buffer.from(await res.Body.transformToByteArray());
  return JSON.parse(gunzipSync(buf).toString("utf8")) as UserStatRow[];
}

// Customer.io App API customer shape — only the attributes we care about.
type CioCustomer = {
  id?: string;
  attributes?: {
    id?: string;
    email?: string;
    workshop_id?: string;
    company_name?: string;
    country?: string;
    language?: string;
    user_role?: string;
    subscription_status?: string;
    plan_type?: string;
    phone?: string;
    name?: string;
  };
};

function getCustomerIoBaseUrl(): string {
  return process.env.CUSTOMER_IO_REGION?.toLowerCase() === "eu"
    ? "https://api-eu.customer.io/v1"
    : "https://api.customer.io/v1";
}

type CioSegmentMember = { id: string; cio_id: string; email: string };
type CioSegmentMembershipResponse = {
  segment_id?: number;
  identifiers?: CioSegmentMember[];
  next?: string | null;
};

// Paginate the "All Users" segment (id=1, dynamic, always up-to-date) and
// return the cio_id + external_id + email for every member. The App API does
// NOT support listing customers without an email filter, but segment
// membership IS enumerable — so this is the supported path.
async function listCioSegmentMembers(apiKey: string, segmentId = 1): Promise<CioSegmentMember[]> {
  const collected: CioSegmentMember[] = [];
  let next: string | null = null;
  const MAX_PAGES = 50; // 50 × ~100 = ~5000 members, safety cap
  for (let i = 0; i < MAX_PAGES; i++) {
    const url = new URL(`${getCustomerIoBaseUrl()}/segments/${segmentId}/membership`);
    url.searchParams.set("limit", "100");
    if (next) url.searchParams.set("start", next);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    });
    if (!res.ok) {
      console.error(`[discover-new] CIO segment membership failed status=${res.status}`);
      break;
    }
    const body = (await res.json()) as CioSegmentMembershipResponse;
    for (const m of body.identifiers ?? []) {
      if (m.id && m.cio_id && m.email) collected.push(m);
    }
    if (!body.next) break;
    next = body.next;
  }
  return collected;
}

// Fetch full attributes for one CIO customer by cio_id.
async function fetchCioCustomer(apiKey: string, cioId: string): Promise<CioCustomer | null> {
  const url = `${getCustomerIoBaseUrl()}/customers/${encodeURIComponent(cioId)}/attributes`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { customer?: CioCustomer } | CioCustomer;
  // Endpoint shape: some accounts get { customer: { attributes: {...} } }, others { attributes: {...} }.
  if ("customer" in body && body.customer) return body.customer;
  return body as CioCustomer;
}

// Fetch CIO data for WL signups not already represented in `s3UserIds`.
// Enumerates segment 1 ("All Users") membership, filters to external_ids
// that look like UUIDs and aren't already in S3, then attribute-fetches
// each candidate. Typical run: ~5-10 segment pages + 0-3 attribute fetches.
async function fetchCioNewWlUsers(s3UserIds: Set<string>): Promise<UserStatRow[]> {
  const apiKey = process.env.CUSTOMER_IO_APP_API_KEY;
  if (!apiKey) return [];

  const members = await listCioSegmentMembers(apiKey);
  const candidates = members.filter((m) => UUID_RE.test(m.id) && !s3UserIds.has(m.id));

  const rows: UserStatRow[] = [];
  for (const m of candidates) {
    const c = await fetchCioCustomer(apiKey, m.cio_id);
    const a = c?.attributes ?? {};
    if (!a.workshop_id || !a.email) continue;
    const externalId = a.id ?? m.id;
    if (!UUID_RE.test(externalId)) continue;
    rows.push({
      user_id: externalId,
      username: null,
      email: a.email,
      name: a.name ?? null,
      phone: a.phone ?? null,
      user_role: a.user_role ?? null,
      workshop_id: a.workshop_id,
      company_name: a.company_name ?? null,
      country: a.country ?? null,
      language: a.language ?? null,
      subscription_status: a.subscription_status ?? null,
      workshop_created_at: null,
    });
  }
  return rows;
}

function normalizeAppRole(role: string | null): string | null {
  if (role === "admin" || role === "mechanic") return role;
  return null;
}

function deriveLeadStatus(subStatus: string | null): "customer" | "churned" {
  if (subStatus === "paused" || subStatus === "inactive" || subStatus === "past_due") {
    return "churned";
  }
  return "customer";
}

export async function discoverNewWlUsers(
  supabase: SupabaseClient<Database>,
): Promise<DiscoverResult> {
  const result: DiscoverResult = {
    newCompanies: 0,
    newContacts: 0,
    mergedContacts: 0,
    skippedInternalTest: 0,
    errors: 0,
    s3RowsValid: 0,
    cioRowsFetched: 0,
    cioOnlyWorkshops: 0,
  };

  // 1. Pull the latest S3 snapshot first — it carries 343+ users in one
  //    file, fast. Then ask CIO for any signups that aren't already in that
  //    snapshot (most cron runs: 0-3 candidates). S3 refreshes only twice a
  //    day (02:00 + 10:00 UTC); CIO is real-time, so this folds in any
  //    signup that landed after the most recent S3 export.
  const s3Rows = await fetchUserStats();
  const s3UserIds = new Set(s3Rows.map((r) => r.user_id).filter((id): id is string => !!id));
  const cioRows = await fetchCioNewWlUsers(s3UserIds);

  // 2. Filter to rows we can act on (UUID user_id + email + workshop_id).
  const s3WorkshopIds = new Set(s3Rows.map((r) => r.workshop_id).filter((id): id is string => !!id));
  const allRows = [...s3Rows, ...cioRows];
  const validRows = allRows.filter(
    (r) => r.user_id && UUID_RE.test(r.user_id) && r.email && r.workshop_id,
  );
  result.s3RowsValid = s3Rows.filter(
    (r) => r.user_id && UUID_RE.test(r.user_id) && r.email && r.workshop_id,
  ).length;
  result.cioRowsFetched = cioRows.length;
  result.cioOnlyWorkshops = cioRows.filter(
    (r) => r.workshop_id && !s3WorkshopIds.has(r.workshop_id),
  ).length;

  // 3. Group by workshop. First-seen-wins for the workshop meta — the JSON
  //    sometimes carries the same workshop with two users; their workshop-
  //    level fields are identical so picking the first is fine. S3 rows
  //    come first in `allRows`, so when S3 has the workshop, S3 wins (it
  //    carries `workshop_created_at` which CIO doesn't). CIO-only workshops
  //    (brand-new signups not yet in S3) get added to the same Map.
  const workshops = new Map<string, { meta: UserStatRow; users: UserStatRow[] }>();
  for (const r of validRows) {
    if (!r.workshop_id) continue;
    let w = workshops.get(r.workshop_id);
    if (!w) {
      w = { meta: r, users: [] };
      workshops.set(r.workshop_id, w);
    } else if (!w.users.some((u) => u.user_id === r.user_id)) {
      w.users.push(r);
    }
  }

  // 4. Find which workshops are already in the CRM (skip — propagator owns them).
  const workshopIds = [...workshops.keys()];
  const existingCompanyByWlId = new Map<string, string>(); // wl_workshop_id → companies.id
  for (let i = 0; i < workshopIds.length; i += 200) {
    const chunk = workshopIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("companies")
      .select("id, wl_workshop_id")
      .in("wl_workshop_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.wl_workshop_id) existingCompanyByWlId.set(row.wl_workshop_id, row.id);
    }
  }

  // 5. Find which workshops are flagged as internal/test (skip those).
  //    `dashboard_workshops.is_internal_test` exists in prod (PR #164) but
  //    isn't in the generated database.types yet — same situation
  //    `src/lib/ceo/supabase.ts` works around. Use an untyped client for this
  //    one query.
  const internalTestIds = new Set<string>();
  const untyped = createUntypedClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  for (let i = 0; i < workshopIds.length; i += 200) {
    const chunk = workshopIds.slice(i, i + 200);
    const { data, error } = await untyped
      .from("dashboard_workshops")
      .select("workshop_id, is_internal_test")
      .in("workshop_id", chunk)
      .eq("is_internal_test", true);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ workshop_id: string }>) {
      internalTestIds.add(row.workshop_id);
    }
  }

  // 6. For each new workshop, INSERT a company and then its users as contacts
  //    (with email-merge fallback for existing prospects).
  for (const [workshopId, w] of workshops) {
    if (existingCompanyByWlId.has(workshopId)) continue;
    if (internalTestIds.has(workshopId)) {
      result.skippedInternalTest++;
      continue;
    }

    const { meta } = w;
    const { data: company, error: coErr } = await supabase
      .from("companies")
      .insert({
        workspace_id: WORKSPACE_ID,
        wl_workshop_id: workshopId,
        name: meta.company_name ?? `Workshop ${workshopId.slice(0, 8)}`,
        country_code: meta.country,
        source: "wl-app",
        industry: "Automotive",
      })
      .select("id")
      .single();

    if (coErr || !company) {
      result.errors++;
      continue;
    }
    result.newCompanies++;
    const companyId = company.id;

    for (const u of w.users) {
      if (!u.email) continue;
      const appRole = normalizeAppRole(u.user_role);
      const leadStatus = deriveLeadStatus(u.subscription_status);

      // Email-merge: if an existing CRM contact has this email (e.g. a
      // discovery prospect that just signed up for the app), update it in
      // place instead of inserting a duplicate.
      const { data: existing } = await supabase
        .from("contacts")
        .select("id, wl_user_id")
        .eq("workspace_id", WORKSPACE_ID)
        .ilike("email", u.email)
        .maybeSingle();

      if (existing) {
        // Don't touch existing rows that already have a wl_user_id — those
        // are owned by the propagator.
        if (existing.wl_user_id) continue;
        const { error: upErr } = await supabase
          .from("contacts")
          .update({
            wl_user_id: u.user_id,
            app_username: u.username,
            app_role: appRole,
            source: "wl-app",
            lead_status: leadStatus,
            company_id: companyId,
            country_code: u.country,
            language: u.language,
            phone: u.phone ?? undefined,
          })
          .eq("id", existing.id);
        if (upErr) result.errors++;
        else result.mergedContacts++;
        continue;
      }

      const { error: ctErr } = await supabase.from("contacts").insert({
        workspace_id: WORKSPACE_ID,
        wl_user_id: u.user_id,
        company_id: companyId,
        email: u.email,
        phone: u.phone,
        country_code: u.country,
        language: u.language,
        app_username: u.username,
        app_role: appRole,
        is_primary: u.user_role === "admin",
        source: "wl-app",
        lead_status: leadStatus,
        status: "active",
        tags: ["owner"],
      });
      if (ctErr) result.errors++;
      else result.newContacts++;
    }
  }

  return result;
}

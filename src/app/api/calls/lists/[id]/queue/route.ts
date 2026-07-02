import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveListContactIds } from "@/lib/lists/filter-query";
import {
  ALWAYS_ON_CALLING,
  mergeExclusions,
  parseListExclusions,
  resolveExcludedContactIds,
} from "@/lib/lists/exclusions";

// Keep .in() lists short — PostgREST encodes them in the URL and long lists
// 414 / silently truncate. Chunk every id-based fetch.
const IN_CHUNK = 100;

// GET /api/calls/lists/[id]/queue — the call-through worklist for one list:
// each member contact with their phone, lead status, customer flag, and the
// most recent call logged against them. Paginated via offset/limit.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: listId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: list, error: listErr } = await supabase
    .from("contact_lists")
    .select("id, name, description, is_dynamic, filters, workspace_id, purpose, exclusions")
    .eq("id", listId)
    .maybeSingle();
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", list.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 100, 200);
  const offset = Number(searchParams.get("offset")) || 0;

  // Calling worklist: always drop the never-call list, plus whatever exclusion
  // sources this list opted into. Excludes are subtracted from the FULL member
  // set (before pagination) so `total` and paging stay correct.
  const resolvedIds = await resolveListContactIds(supabase, list);
  const exclusions = mergeExclusions(ALWAYS_ON_CALLING, parseListExclusions(list.exclusions));
  const excluded = await resolveExcludedContactIds(supabase, list.workspace_id, exclusions, {
    excludeSelfListId: list.id,
  });
  const allIds = excluded.size > 0 ? resolvedIds.filter((id) => !excluded.has(id)) : resolvedIds;
  const total = allIds.length;
  const pageIds = allIds.slice(offset, offset + limit);

  if (pageIds.length === 0) {
    return NextResponse.json({ list: { id: list.id, name: list.name, description: list.description, is_dynamic: list.is_dynamic }, queue: [], total });
  }

  // Contacts for this page (chunked .in()).
  type ContactRow = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    phone: string | null;
    all_phones: string[] | null;
    all_emails: string[] | null;
    title: string | null;
    city: string | null;
    country: string | null;
    country_code: string | null;
    language: string | null;
    lead_status: string | null;
    tags: string[] | null;
    notes: string | null;
    wl_user_id: string | null;
    app_role: string | null;
    user_plan_type: string | null;
    user_subscription_status: string | null;
    diagnostics_total: number | null;
    diagnostics_last_30d: number | null;
    last_active_at: string | null;
    last_login_at: string | null;
    last_contacted_at: string | null;
    company_id: string | null;
    companies: { name: string | null; phone: string | null; city: string | null } | null;
  };
  const contacts: ContactRow[] = [];
  for (let i = 0; i < pageIds.length; i += IN_CHUNK) {
    const chunk = pageIds.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, email, phone, all_phones, all_emails, title, city, country, country_code, language, lead_status, tags, notes, wl_user_id, app_role, user_plan_type, user_subscription_status, diagnostics_total, diagnostics_last_30d, last_active_at, last_login_at, last_contacted_at, company_id, companies(name, phone, city)",
      )
      .in("id", chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    contacts.push(...((data ?? []) as unknown as ContactRow[]));
  }

  // Most-recent call per contact on this page (chunked .in()). Keep the agent's
  // user_id so we can show who made the last call.
  const lastCallByContact = new Map<
    string,
    { outcome: string | null; created_at: string | null; userId: string | null }
  >();
  for (let i = 0; i < pageIds.length; i += IN_CHUNK) {
    const chunk = pageIds.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("activities")
      .select("contact_id, outcome, created_at, user_id")
      .eq("workspace_id", list.workspace_id)
      .eq("type", "call")
      .in("contact_id", chunk)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of data ?? []) {
      if (row.contact_id && !lastCallByContact.has(row.contact_id)) {
        lastCallByContact.set(row.contact_id, {
          outcome: row.outcome,
          created_at: row.created_at,
          userId: row.user_id,
        });
      }
    }
  }

  // Resolve the agent (who made the last call) to a display name. user_profiles
  // RLS only exposes the caller's own row, so use the service client — scoped to
  // the agent ids present in this page (same pattern as /api/calls).
  const agentIds = [
    ...new Set(
      [...lastCallByContact.values()].map((v) => v.userId).filter((id): id is string => !!id),
    ),
  ];
  const agentNameById = new Map<string, string | null>();
  const agentAvatarById = new Map<string, string | null>();
  if (agentIds.length) {
    const admin = createServiceClient();
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name, avatar_url")
      .in("user_id", agentIds);
    for (const p of profiles ?? []) {
      agentNameById.set(p.user_id, p.full_name);
      agentAvatarById.set(p.user_id, p.avatar_url);
    }
  }

  // Preserve list order; attach call state + customer flag.
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const queue = pageIds
    .map((cid) => byId.get(cid))
    .filter((c): c is ContactRow => Boolean(c))
    .map((c) => ({
      contactId: c.id,
      name: [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || c.email,
      email: c.email,
      phone: c.phone,
      allPhones: (c.all_phones ?? []).filter((p): p is string => Boolean(p && p.trim())),
      allEmails: (c.all_emails ?? []).filter((e): e is string => Boolean(e && e.trim())),
      title: c.title,
      city: c.city,
      country: c.country,
      countryCode: c.country_code,
      language: c.language,
      leadStatus: c.lead_status,
      tags: (c.tags ?? []).filter((t): t is string => Boolean(t && t.trim())),
      notes: c.notes,
      companyId: c.company_id,
      companyName: c.companies?.name ?? null,
      companyPhone: c.companies?.phone ?? null,
      companyCity: c.companies?.city ?? null,
      isCustomer: c.wl_user_id != null,
      appRole: c.app_role,
      planType: c.user_plan_type,
      subscriptionStatus: c.user_subscription_status,
      diagnosticsTotal: c.diagnostics_total,
      diagnosticsLast30d: c.diagnostics_last_30d,
      lastActiveAt: c.last_active_at,
      lastLoginAt: c.last_login_at,
      lastContactedAt: c.last_contacted_at,
      lastCall: (() => {
        const lc = lastCallByContact.get(c.id);
        if (!lc) return null;
        return {
          outcome: lc.outcome,
          created_at: lc.created_at,
          agentName: lc.userId ? agentNameById.get(lc.userId)?.trim() || null : null,
          agentAvatarUrl: lc.userId ? agentAvatarById.get(lc.userId) || null : null,
        };
      })(),
    }));

  return NextResponse.json({
    list: { id: list.id, name: list.name, description: list.description, is_dynamic: list.is_dynamic },
    queue,
    total,
  });
}

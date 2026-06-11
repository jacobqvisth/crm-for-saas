import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveListContactIds } from "@/lib/lists/filter-query";

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
    .select("id, name, description, is_dynamic, filters, workspace_id, purpose")
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

  const allIds = await resolveListContactIds(supabase, list);
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
    lead_status: string | null;
    wl_user_id: string | null;
    last_contacted_at: string | null;
    company_id: string | null;
    companies: { name: string | null } | null;
  };
  const contacts: ContactRow[] = [];
  for (let i = 0; i < pageIds.length; i += IN_CHUNK) {
    const chunk = pageIds.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, email, phone, lead_status, wl_user_id, last_contacted_at, company_id, companies(name)",
      )
      .in("id", chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    contacts.push(...((data ?? []) as unknown as ContactRow[]));
  }

  // Most-recent call per contact on this page (chunked .in()).
  const lastCallByContact = new Map<string, { outcome: string | null; created_at: string | null }>();
  for (let i = 0; i < pageIds.length; i += IN_CHUNK) {
    const chunk = pageIds.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("activities")
      .select("contact_id, outcome, created_at")
      .eq("workspace_id", list.workspace_id)
      .eq("type", "call")
      .in("contact_id", chunk)
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of data ?? []) {
      if (row.contact_id && !lastCallByContact.has(row.contact_id)) {
        lastCallByContact.set(row.contact_id, { outcome: row.outcome, created_at: row.created_at });
      }
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
      leadStatus: c.lead_status,
      companyId: c.company_id,
      companyName: c.companies?.name ?? null,
      isCustomer: c.wl_user_id != null,
      lastContactedAt: c.last_contacted_at,
      lastCall: lastCallByContact.get(c.id) ?? null,
    }));

  return NextResponse.json({
    list: { id: list.id, name: list.name, description: list.description, is_dynamic: list.is_dynamic },
    queue,
    total,
  });
}

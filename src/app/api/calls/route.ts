import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/calls — recent calls feed (activities of type 'call').
// Filters: outcome (comma list), contact_id, company_id, since, until.
// Paginated via limit/offset.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const outcome = searchParams.get("outcome");
  const contactId = searchParams.get("contact_id");
  const companyId = searchParams.get("company_id");
  const since = searchParams.get("since");
  const until = searchParams.get("until");
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const offset = Number(searchParams.get("offset")) || 0;

  let query = supabase
    .from("activities")
    .select(
      "id, created_at, outcome, subject, body, metadata, contact_id, company_id, user_id, " +
        "contacts(first_name, last_name, email, phone, lead_status, wl_user_id), " +
        "companies(name)",
      { count: "exact" },
    )
    .eq("workspace_id", membership.workspace_id)
    .eq("type", "call")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (outcome) query = query.in("outcome", outcome.split(","));
  if (contactId) query = query.eq("contact_id", contactId);
  if (companyId) query = query.eq("company_id", companyId);
  if (since) query = query.gte("created_at", since);
  if (until) query = query.lte("created_at", until);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ calls: data ?? [], total: count ?? 0 });
}

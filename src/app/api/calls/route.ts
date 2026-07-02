import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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
      // NOTE: keep this a single string literal — postgrest-js only infers row
      // types (so r.user_id etc. resolve) from a literal select; concatenating
      // with `+` degrades every row to GenericStringError and fails the build.
      "id, created_at, outcome, subject, body, metadata, contact_id, company_id, user_id, contacts(first_name, last_name, email, phone, lead_status, wl_user_id), companies(name)",
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

  // Type the rows explicitly. postgrest-js's row inference over this nested
  // select is deep enough that the production `next build` type-checker can fall
  // back to `GenericStringError` (where `.user_id` doesn't exist and the build
  // fails), even though local `tsc` infers it fine. Pinning the shape we read
  // makes the handler compile regardless of that fallback.
  const rows = (data ?? []) as Array<Record<string, unknown> & { user_id: string | null }>;

  // Attach the agent (the CRM user who made/received the call) so the feed can
  // show who called who. user_profiles RLS only exposes the caller's own row,
  // so resolve other agents' names via the service client (same pattern as
  // /api/settings/calls). Scoped to the ids present in this page of results.
  const agentIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id))];
  const agentNameById = new Map<string, string | null>();
  if (agentIds.length) {
    const admin = createServiceClient();
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", agentIds);
    for (const p of profiles ?? []) agentNameById.set(p.user_id, p.full_name);
  }

  const calls = rows.map((r) => ({
    ...r,
    agent_name: r.user_id ? agentNameById.get(r.user_id)?.trim() || null : null,
  }));

  return NextResponse.json({ calls, total: count ?? 0 });
}

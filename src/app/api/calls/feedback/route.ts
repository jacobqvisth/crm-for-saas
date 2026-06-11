import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/calls/feedback — product feedback captured on calls, for triage.
// Filters: status, category. Paginated via limit/offset.
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
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const offset = Number(searchParams.get("offset")) || 0;

  let query = supabase
    .from("call_feedback")
    .select(
      "id, category, severity, title, body, status, created_at, updated_at, activity_id, " +
        "contact_id, company_id, user_id, " +
        "contacts(first_name, last_name, email), companies(name)",
      { count: "exact" },
    )
    .eq("workspace_id", membership.workspace_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.in("status", status.split(","));
  if (category) query = query.in("category", category.split(","));

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ feedback: data ?? [], total: count ?? 0 });
}

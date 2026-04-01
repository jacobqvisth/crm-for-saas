import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const page = parseInt(searchParams.get("page") || "0");
  const limit = parseInt(searchParams.get("limit") || "50");
  const reason = searchParams.get("reason") || "";
  const search = searchParams.get("search") || "";

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let query = supabase
    .from("suppressions")
    .select("*", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);

  if (reason) {
    query = query.eq("reason", reason);
  }

  if (search) {
    query = query.or(`email.ilike.%${search}%,domain.ilike.%${search}%`);
  }

  const { data: items, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get reason breakdown counts for stats
  const { data: reasonCounts } = await supabase
    .from("suppressions")
    .select("reason")
    .eq("workspace_id", workspaceId)
    .eq("active", true);

  const breakdown: Record<string, number> = {};
  for (const row of reasonCounts || []) {
    breakdown[row.reason] = (breakdown[row.reason] || 0) + 1;
  }

  return NextResponse.json({
    items: items || [],
    total: count || 0,
    breakdown,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { workspaceId, email, domain, reason, source } = body;

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  if (!email && !domain) {
    return NextResponse.json(
      { error: "At least one of email or domain is required" },
      { status: 400 }
    );
  }

  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Check if already suppressed
  if (email) {
    const { data: existing } = await supabase
      .from("suppressions")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("email", email)
      .eq("active", true)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "This email is already suppressed" }, { status: 409 });
    }
  }

  if (domain && !email) {
    const { data: existing } = await supabase
      .from("suppressions")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("domain", domain)
      .eq("active", true)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "This domain is already suppressed" }, { status: 409 });
    }
  }

  const { data, error } = await supabase
    .from("suppressions")
    .insert({
      workspace_id: workspaceId,
      email: email || null,
      domain: domain || null,
      reason,
      source: source || "manual entry",
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item: data });
}

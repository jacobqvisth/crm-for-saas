import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 403 });

  const workspaceId = membership.workspace_id;
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") ?? "all";
  const contactId = searchParams.get("contact_id");

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  let query = supabase
    .from("tasks")
    .select(
      "*, contacts(first_name, last_name, email, title, company_id)",
      { count: "exact" }
    )
    .eq("workspace_id", workspaceId);

  if (contactId) {
    query = query.eq("contact_id", contactId);
  }

  switch (filter) {
    case "overdue":
      query = query
        .lt("due_date", now.toISOString())
        .is("completed_at", null)
        .or(`snoozed_until.is.null,snoozed_until.lt.${now.toISOString()}`);
      break;
    case "due_today":
      query = query
        .gte("due_date", todayStart)
        .lt("due_date", tomorrowStart)
        .is("completed_at", null);
      break;
    case "upcoming":
      query = query
        .gte("due_date", tomorrowStart)
        .is("completed_at", null);
      break;
    case "completed":
      query = query.not("completed_at", "is", null);
      break;
    // "all" — no status/date filter
  }

  query = query.order("due_date", { ascending: true, nullsFirst: false });

  const { data: tasks, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ tasks: tasks ?? [], count: count ?? 0 });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 403 });

  const body = await request.json() as {
    title: string;
    type?: 'email' | 'call' | 'linkedin' | 'generic';
    description?: string;
    due_date?: string;
    priority?: 'low' | 'medium' | 'high';
    contact_id?: string;
    company_id?: string;
    deal_id?: string;
    enrollment_id?: string;
  };

  if (!body.title?.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      workspace_id: membership.workspace_id,
      title: body.title.trim(),
      type: body.type ?? "generic",
      description: body.description ?? null,
      due_date: body.due_date ?? null,
      priority: body.priority ?? "medium",
      contact_id: body.contact_id ?? null,
      company_id: body.company_id ?? null,
      deal_id: body.deal_id ?? null,
      enrollment_id: body.enrollment_id ?? null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ task }, { status: 201 });
}

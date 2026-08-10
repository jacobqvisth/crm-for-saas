import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { taskSource, TASK_SOURCE_TITLE_PREFIX, type TaskSource } from "@/lib/tasks/source";

const TASK_TYPES = ["email", "call", "linkedin", "generic"] as const;
type TaskType = (typeof TASK_TYPES)[number];

/** Row shape needed to bucket a task into the tab counts. */
type CountRow = {
  type: TaskType;
  title: string;
  due_date: string | null;
  completed_at: string | null;
  snoozed_until: string | null;
  created_by: string | null;
  enrollment_id: string | null;
};

/**
 * Tab counts for the whole workspace, so every tab shows a number regardless of
 * which one is active. Deliberately one slim read rather than a count-per-tab
 * fan-out; revisit if `tasks` ever outgrows the 1000-row PostgREST ceiling.
 */
function buildCounts(rows: CountRow[], todayStart: string, tomorrowStart: string, now: string) {
  const status = { all: 0, due_today: 0, overdue: 0, upcoming: 0, completed: 0 };
  const type: Record<TaskType, number> = { email: 0, call: 0, linkedin: 0, generic: 0 };
  const source: Record<TaskSource, number> = { hot_lead: 0, reply: 0, manual: 0 };

  for (const r of rows) {
    status.all++;
    if (r.completed_at) {
      status.completed++;
    } else if (r.due_date) {
      const notSnoozed = !r.snoozed_until || r.snoozed_until < now;
      if (r.due_date < now && notSnoozed) status.overdue++;
      if (r.due_date >= todayStart && r.due_date < tomorrowStart) status.due_today++;
      if (r.due_date >= tomorrowStart) status.upcoming++;
    }
    if (r.type in type) type[r.type]++;
    source[taskSource(r)]++;
  }

  return { status, type, source };
}

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
  const typeParam = searchParams.get("type");
  const sourceParam = searchParams.get("source");
  const sortParam = searchParams.get("sort") === "oldest" ? "oldest" : "newest";

  const now = new Date();
  const nowIso = now.toISOString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  let query = supabase
    .from("tasks")
    .select(
      "*, contacts(first_name, last_name, email, title, phone, company_id, companies(name))",
      { count: "exact" }
    )
    .eq("workspace_id", workspaceId);

  if (contactId) {
    query = query.eq("contact_id", contactId);
  }

  if (typeParam && (TASK_TYPES as readonly string[]).includes(typeParam)) {
    query = query.eq("type", typeParam);
  }

  // Source has no column of its own — filter on the same signals taskSource() reads.
  switch (sourceParam) {
    case "hot_lead":
      query = query.ilike("title", `${TASK_SOURCE_TITLE_PREFIX.hot_lead}%`);
      break;
    case "reply":
      // Both remaining auto-generators are reply-driven, so "auto and not a hot
      // lead" is the same set as matching their title prefixes — and avoids
      // quoting spaced ilike patterns inside an .or().
      query = query
        .is("created_by", null)
        .not("title", "ilike", `${TASK_SOURCE_TITLE_PREFIX.hot_lead}%`);
      break;
    case "manual":
      query = query.not("created_by", "is", null);
      break;
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

  // Newest first by default — the list is dominated by auto-generated tasks and
  // the useful end is the recent one. `id` breaks ties so paging stays stable.
  const ascending = sortParam === "oldest";
  query = query
    .order("due_date", { ascending, nullsFirst: false })
    .order("id", { ascending });

  const [{ data: tasks, count, error }, { data: countRows, error: countError }] =
    await Promise.all([
      query,
      supabase
        .from("tasks")
        .select("type, title, due_date, completed_at, snoozed_until, created_by, enrollment_id")
        .eq("workspace_id", workspaceId),
    ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });

  return NextResponse.json({
    tasks: tasks ?? [],
    count: count ?? 0,
    counts: buildCounts((countRows ?? []) as CountRow[], todayStart, tomorrowStart, nowIso),
  });
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

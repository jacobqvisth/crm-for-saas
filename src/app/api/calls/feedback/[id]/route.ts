import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const PatchBody = z.object({
  status: z.enum(["new", "triaged", "planned", "shipped", "wont_do"]).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).nullish(),
  category: z.enum(["bug", "feature_request", "complaint", "praise", "other"]).optional(),
  title: z.string().max(200).nullish(),
  body: z.string().min(1).max(2000).optional(),
});

// PATCH /api/calls/feedback/[id] — triage a feedback item (status etc.).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: row, error: rowErr } = await supabase
    .from("call_feedback")
    .select("id, workspace_id")
    .eq("id", id)
    .maybeSingle();
  if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", row.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = PatchBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const update: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("call_feedback")
    .update(update)
    .eq("id", id)
    .select("id, status, severity, category, title, body, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ feedback: data });
}

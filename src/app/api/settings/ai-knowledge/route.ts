import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_KNOWLEDGE, loadWrenchlaneKnowledge } from "@/lib/inbox/load-knowledge";

/**
 * GET /api/settings/ai-knowledge
 * Returns the workspace's editable AI product knowledge (DB) or the seed fallback,
 * with metadata for the settings UI.
 */
export async function GET() {
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
  if (!membership) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  const knowledge = await loadWrenchlaneKnowledge(supabase, membership.workspace_id);

  // Surface the editor's email if a DB row exists.
  let updatedByEmail: string | null = null;
  if (knowledge.source === "db") {
    const { data: row } = await supabase
      .from("workspace_ai_knowledge")
      .select("updated_by")
      .eq("workspace_id", membership.workspace_id)
      .maybeSingle();
    if (row?.updated_by) {
      const { data: profile } = await supabase
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", membership.workspace_id)
        .eq("user_id", row.updated_by)
        .maybeSingle();
      // Best-effort — we don't expose auth.users via REST; the UI shows "(saved)".
      updatedByEmail = profile ? null : null;
    }
  }

  return NextResponse.json({
    content_md: knowledge.contentMd,
    source: knowledge.source,
    updated_at: knowledge.updatedAt,
    updated_by_email: updatedByEmail,
    default_md: DEFAULT_KNOWLEDGE,
  });
}

/**
 * PATCH /api/settings/ai-knowledge
 * Upserts the workspace's knowledge row.
 * Body: { content_md: string }
 */
export async function PATCH(request: NextRequest) {
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
  if (!membership) {
    return NextResponse.json({ error: "No workspace found" }, { status: 404 });
  }

  let payload: { content_md?: unknown } = {};
  try {
    payload = (await request.json()) as { content_md?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (typeof payload.content_md !== "string" || !payload.content_md.trim()) {
    return NextResponse.json({ error: "content_md is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("workspace_ai_knowledge")
    .upsert(
      {
        workspace_id: membership.workspace_id,
        content_md: payload.content_md,
        updated_by: user.id,
      },
      { onConflict: "workspace_id" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

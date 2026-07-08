import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { generateForumReply } from "@/lib/forums/reply-generate";
import type { ForumReply, ReplySource } from "@/lib/forums/replies";

const patchSchema = z.object({
  status: z.enum(["draft", "posted", "archived"]).optional(),
  posted_url: z.string().max(2000).nullable().optional(),
  generated_body: z.string().max(20000).optional(),
  mention_level: z.enum(["none", "subtle", "explicit"]).optional(),
  // When true, re-draft the reply from the stored source (optionally with a new
  // mention_level passed alongside).
  regenerate: z.boolean().optional(),
});

// PATCH /api/forums/replies/[id] → { reply }
// Edit the reply text, mark it posted (with the comment URL), archive it, or
// regenerate it from the stored source post. status=posted stamps posted_at.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { regenerate, status, mention_level, ...rest } = parsed.data;

  const update: Record<string, unknown> = { ...rest };
  if (mention_level) update.mention_level = mention_level;
  if (status) {
    update.status = status;
    if (status === "posted") update.posted_at = new Date().toISOString();
  }

  if (regenerate) {
    const { data: row } = await supabase
      .from("forum_replies")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const existing = row as unknown as ForumReply;

    const source: ReplySource = {
      url: existing.source_url,
      subreddit: existing.source_subreddit,
      title: existing.source_title ?? "",
      body: existing.source_body,
      author: existing.source_author,
      score: existing.source_score,
      num_comments: existing.source_num_comments,
    };
    const level = mention_level ?? existing.mention_level;
    const result = await generateForumReply({ source, mentionLevel: level });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 502 });
    update.generated_body = result.body;
    update.model = result.model;
    update.mention_level = level;
  }

  const { data: reply, error } = await supabase
    .from("forum_replies")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!reply) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ reply: reply as unknown as ForumReply });
}

// DELETE /api/forums/replies/[id] → { ok: true }
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const { error } = await supabase
    .from("forum_replies")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { getForumTarget } from "@/lib/forums/targets";
import { generateForumPost } from "@/lib/forums/generate";
import type {
  ForumMentionLevel,
  ForumPost,
  ForumPostType,
  ForumScenario,
} from "@/lib/forums/types";

const patchSchema = z.object({
  status: z.enum(["idea", "drafted", "posted", "archived"]).optional(),
  posted_url: z.string().max(2000).nullable().optional(),
  generated_title: z.string().max(500).nullable().optional(),
  generated_body: z.string().max(20000).nullable().optional(),
  // When true, re-run the model from the post's stored scenario + settings.
  regenerate: z.boolean().optional(),
});

// PATCH /api/forums/[id] → { post }
// Edit a post (status / posted URL / hand-edited title+body), or regenerate it
// from its frozen scenario_snapshot. Marking status=posted stamps posted_at.
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
  const { regenerate, status, ...rest } = parsed.data;

  const update: Record<string, unknown> = { ...rest };
  if (status) {
    update.status = status;
    if (status === "posted") update.posted_at = new Date().toISOString();
  }

  if (regenerate) {
    const { data: existing, error: readErr } = await supabase
      .from("forum_posts")
      .select("*")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .single();
    if (readErr || !existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const target = getForumTarget(existing.forum_target);
    if (!target) {
      return NextResponse.json({ error: "Unknown forum target" }, { status: 400 });
    }
    const result = await generateForumPost({
      scenario: existing.scenario_snapshot as unknown as ForumScenario,
      target,
      postType: existing.post_type as ForumPostType,
      mentionLevel: existing.mention_level as ForumMentionLevel,
      language: target.language,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 502 });
    }
    update.generated_title = result.title;
    update.generated_body = result.body;
    update.model = result.model;
  }

  const { data: post, error } = await supabase
    .from("forum_posts")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post: post as unknown as ForumPost });
}

// DELETE /api/forums/[id] → { ok: true }
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const { error } = await supabase
    .from("forum_posts")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

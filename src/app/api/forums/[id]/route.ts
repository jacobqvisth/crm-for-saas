import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { getForumTarget } from "@/lib/forums/targets";
import { generateForumPost } from "@/lib/forums/generate";
import { fetchRedditTraction } from "@/lib/forums/reddit";
import { notifyForumPosted } from "@/lib/forums/notify-posted";
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
  // When true, re-fetch this post's traction (upvotes/comments) from Reddit.
  refresh: z.boolean().optional(),
  // Manual traction entry (used when auto-fetch is blocked).
  score: z.number().int().nullable().optional(),
  num_comments: z.number().int().nullable().optional(),
  traction_note: z.string().max(2000).nullable().optional(),
  // When true, (re)post this to #forum-posts and redraft the suggested comment.
  resend_slack: z.boolean().optional(),
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
  const { regenerate, refresh, resend_slack, status, ...rest } = parsed.data;

  const update: Record<string, unknown> = { ...rest };
  if (status) {
    update.status = status;
    if (status === "posted") update.posted_at = new Date().toISOString();
  }

  // Manual traction entry — stamp the check time and clear any error note.
  if (!refresh && (rest.score !== undefined || rest.num_comments !== undefined)) {
    update.last_checked_at = new Date().toISOString();
    if (rest.traction_note === undefined) update.traction_note = null;
  }

  if (refresh) {
    // Pull live traction. Prefer an incoming posted_url (e.g. just marked
    // posted), else read the stored one.
    let url = typeof rest.posted_url === "string" ? rest.posted_url : null;
    if (!url) {
      const { data: row } = await supabase
        .from("forum_posts")
        .select("posted_url")
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single();
      url = (row?.posted_url as string | null) ?? null;
    }
    update.last_checked_at = new Date().toISOString();
    if (!url) {
      update.traction_note = "No posted URL to check yet";
    } else {
      const result = await fetchRedditTraction(url);
      if (result.ok) {
        update.score = result.traction.score;
        update.num_comments = result.traction.num_comments;
        update.upvote_ratio = result.traction.upvote_ratio;
        update.traction_note = null;
      } else {
        update.traction_note = result.reason;
      }
    }
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

  const { data: updated, error } = await supabase
    .from("forum_posts")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let post = updated as unknown as ForumPost;

  // Fan out to #forum-posts when it's freshly marked posted, or on an explicit
  // resend. Best-effort — never fail the save on Slack/AI errors.
  const firstPost = status === "posted" && post.posted_url && !post.slack_notified_at;
  if ((firstPost || resend_slack) && post.posted_url && post.generated_title) {
    const target = getForumTarget(post.forum_target);
    const result = await notifyForumPosted({
      subreddit: target?.name ?? post.forum_target,
      tone: target?.tone,
      rulesNote: target?.rulesNote,
      title: post.generated_title,
      body: post.generated_body,
      url: post.posted_url,
      existingComment: post.suggested_comment,
      forceRegenerate: Boolean(resend_slack),
    });
    const postUpdate: Record<string, unknown> = {};
    if (result.comment && result.comment !== post.suggested_comment)
      postUpdate.suggested_comment = result.comment;
    if (result.notifiedAt) postUpdate.slack_notified_at = result.notifiedAt;
    if (Object.keys(postUpdate).length) {
      const { data: reUpdated } = await supabase
        .from("forum_posts")
        .update(postUpdate)
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .select()
        .single();
      if (reUpdated) post = reUpdated as unknown as ForumPost;
    }
  }

  return NextResponse.json({ post });
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

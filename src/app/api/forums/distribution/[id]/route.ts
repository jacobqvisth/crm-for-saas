import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { fetchRedditTraction, type DistributionRec } from "@/lib/forums/distribution";
import { notifyForumPosted } from "@/lib/forums/notify-posted";

const patchSchema = z.object({
  status: z.enum(["recommended", "posted", "skipped"]).optional(),
  posted_url: z.string().max(2000).nullable().optional(),
  // Which roster account posted this (picked when marking posted).
  posted_by_account_id: z.string().uuid().nullable().optional(),
  traction_note: z.string().max(2000).nullable().optional(),
  // Manual traction entry (used when auto-fetch is blocked).
  score: z.number().int().nullable().optional(),
  num_comments: z.number().int().nullable().optional(),
  // When true, re-fetch this post's traction from Reddit now.
  refresh: z.boolean().optional(),
  // When true, (re)post this to #forum-posts and redraft the suggested comment.
  resend_slack: z.boolean().optional(),
});

// PATCH /api/forums/distribution/[id] → { rec }
// Update a recommendation's tracking state: mark it posted (with URL), skip it,
// jot a traction note, or pull fresh upvote/comment counts from Reddit.
// Marking status=posted stamps posted_at.
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
  const { refresh, resend_slack, status, ...rest } = parsed.data;

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
    // Read the row to get the URL to check (may have just been set above, so
    // prefer the incoming posted_url when present).
    let url = typeof rest.posted_url === "string" ? rest.posted_url : null;
    if (!url) {
      const { data: row } = await supabase
        .from("forum_distribution")
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
        // Capture the real author handle as the source-of-truth poster.
        if (result.traction.author) update.posted_by_username = result.traction.author;
        update.traction_note = null;
      } else {
        update.traction_note = result.reason;
      }
    }
  }

  const { data: updated, error } = await supabase
    .from("forum_distribution")
    .update(update)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let rec = updated as unknown as DistributionRec;

  // Fan out to #forum-posts when it's freshly marked posted (first time), or on
  // an explicit resend. Best-effort — never fail the save on Slack/AI errors.
  const firstPost = status === "posted" && rec.posted_url && !rec.slack_notified_at;
  if ((firstPost || resend_slack) && rec.posted_url && rec.suggested_title) {
    const result = await notifyForumPosted({
      subreddit: rec.subreddit,
      tone: rec.recommended_angle,
      rulesNote: rec.rules_note,
      title: rec.suggested_title,
      body: rec.suggested_body,
      url: rec.posted_url,
      existingComment: rec.suggested_comment,
      forceRegenerate: Boolean(resend_slack),
    });
    const postUpdate: Record<string, unknown> = {};
    if (result.comment && result.comment !== rec.suggested_comment)
      postUpdate.suggested_comment = result.comment;
    if (result.notifiedAt) postUpdate.slack_notified_at = result.notifiedAt;
    if (Object.keys(postUpdate).length) {
      const { data: reUpdated } = await supabase
        .from("forum_distribution")
        .update(postUpdate)
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .select()
        .single();
      if (reUpdated) rec = reUpdated as unknown as DistributionRec;
    }
  }

  return NextResponse.json({ rec });
}

// DELETE /api/forums/distribution/[id] → { ok: true }
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const { id } = await params;

  const { error } = await supabase
    .from("forum_distribution")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

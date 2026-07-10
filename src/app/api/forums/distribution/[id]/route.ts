import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace, fetchAssignmentsBySource } from "@/lib/forums/server";
import { fetchRedditTraction, type DistributionRec } from "@/lib/forums/distribution";
import { draftForumComments, sendForumPostToSlack } from "@/lib/forums/notify-posted";
import { generationOptionsSchema, normalizeOptions } from "@/lib/forums/generation-options";

// A traction refresh may run via an Apify scrape (~30-90s); raise the timeout.
export const maxDuration = 300;

const patchSchema = z.object({
  status: z.enum(["recommended", "posted", "skipped"]).optional(),
  posted_url: z.string().max(2000).nullable().optional(),
  // Hand-edited post title/body.
  suggested_title: z.string().max(500).nullable().optional(),
  suggested_body: z.string().max(20000).nullable().optional(),
  // Which roster account posted this (picked when marking posted).
  posted_by_account_id: z.string().uuid().nullable().optional(),
  traction_note: z.string().max(2000).nullable().optional(),
  // Manual traction entry (used when auto-fetch is blocked).
  score: z.number().int().nullable().optional(),
  num_comments: z.number().int().nullable().optional(),
  // When true, re-fetch this post's traction from Reddit now.
  refresh: z.boolean().optional(),
  // Step 1: (re)generate the per-member comment drafts. No Slack.
  draft: z.boolean().optional(),
  // How the per-member comments should be written (mention + style axes).
  options: generationOptionsSchema.optional(),
  // Step 2: post the current drafts to #forum-posts.
  send_slack: z.boolean().optional(),
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
  const { refresh, draft, send_slack, status, options, ...rest } = parsed.data;
  const commentOptions = normalizeOptions(options);

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

  // Some actions carry no column changes (send_slack / draft on their own):
  // updating with an empty object makes PostgREST 500, so just read the row
  // instead and let the Slack/draft steps below run on it.
  const hasColumnChanges = Object.keys(update).length > 0;
  const { data: updated, error } = hasColumnChanges
    ? await supabase
        .from("forum_distribution")
        .update(update)
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .select()
        .single()
    : await supabase
        .from("forum_distribution")
        .select()
        .eq("id", id)
        .eq("workspace_id", workspaceId)
        .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let rec = updated as unknown as DistributionRec;

  // Two decoupled steps, both best-effort (never fail the save):
  //   • auto-draft once when freshly marked posted (fills the comments, no Slack)
  //   • `draft` redrafts everyone; `send_slack` posts the current drafts.
  const common = {
    supabase,
    workspaceId,
    source: "distribution" as const,
    sourceId: id,
    subreddit: rec.subreddit,
    tone: rec.recommended_angle,
    rulesNote: rec.rules_note,
    title: rec.suggested_title ?? rec.subreddit,
    body: rec.suggested_body,
    options: commentOptions,
  };
  const firstPost = status === "posted" && rec.posted_url;

  if (draft || firstPost) {
    await draftForumComments({ ...common, regenerate: Boolean(draft) });
  }

  // The Slack send is best-effort and never fails the save, but we return a
  // human-readable reason when it doesn't land so the UI can show it instead of
  // silently doing nothing.
  let slackReason: string | undefined;
  if (send_slack) {
    if (!rec.posted_url || !rec.suggested_title) {
      slackReason = "Mark this post as posted (with its Reddit URL) before sending to Slack.";
    } else {
      const result = await sendForumPostToSlack({ ...common, url: rec.posted_url });
      const postUpdate: Record<string, unknown> = {};
      if (result.notifiedAt) postUpdate.slack_notified_at = result.notifiedAt;
      if (result.threadTs) postUpdate.slack_thread_ts = result.threadTs;
      if (result.channelId) postUpdate.slack_channel_id = result.channelId;
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
      if (!result.notifiedAt) {
        slackReason = result.slackConfigured
          ? `Slack didn't accept the message: ${result.reason ?? "unknown error"}.`
          : "Slack isn't set up yet (SLACK_FORUM_POSTS_WEBHOOK_URL is missing on the server).";
      }
    }
  }

  const grouped = await fetchAssignmentsBySource(supabase, workspaceId, "distribution", [id]);
  rec.assignments = grouped.get(id) ?? [];

  return NextResponse.json(slackReason ? { rec, slackReason } : { rec });
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

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWorkspace, loadPersonaRoster } from "@/lib/forums/server";
import { fetchRedditThreadComments } from "@/lib/forums/reddit";
import { analyzeThreadReplies } from "@/lib/forums/thread-analyze";
import type { Database } from "@/lib/database.types";
import type { ForumThreadReply } from "@/lib/forums/types";

// Reading the live comment thread can run through an Apify scrape that
// cold-starts (~200s), so give the route the full window (matches the traction
// refresh routes).
export const maxDuration = 300;

const bodySchema = z.object({
  source: z.enum(["distribution", "post"]).default("distribution"),
  source_id: z.string().uuid(),
  max_picks: z.number().int().min(1).max(15).optional(),
});

// POST /api/forums/thread/analyze → { replies, analyzed, note? }
// Pull the real comments on this posted thread, decide which are worth replying
// to, draft a reply for each, assign the best-fit teammate, and persist as
// forum_thread_replies. Re-running refreshes the suggestions but never touches
// replies already marked posted or skipped.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { source, source_id, max_picks } = parsed.data;

  const table = source === "post" ? "forum_posts" : "forum_distribution";
  const { data: recRow, error: recErr } = await supabase
    .from(table)
    .select("*")
    .eq("id", source_id)
    .eq("workspace_id", workspaceId)
    .single();
  if (recErr || !recRow) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = recRow as Record<string, unknown>;

  // Normalize the two post shapes to what the analyzer needs.
  const postedUrl = (row.posted_url as string | null) ?? null;
  const subreddit =
    source === "post"
      ? (String(row.forum_target ?? "").split(":")[1] ?? "")
      : String(row.subreddit ?? "");
  const postTitle =
    (source === "post" ? (row.generated_title as string | null) : (row.suggested_title as string | null)) ??
    subreddit;
  const postBody =
    source === "post" ? (row.generated_body as string | null) : (row.suggested_body as string | null);

  if (!postedUrl) {
    return NextResponse.json(
      { error: "Mark this posted with its Reddit URL before analyzing the thread." },
      { status: 400 },
    );
  }

  // 1. Read the live thread.
  const thread = await fetchRedditThreadComments(postedUrl);
  if (!thread.ok) return NextResponse.json({ error: thread.reason }, { status: 502 });
  if (thread.comments.length === 0) {
    return NextResponse.json({ replies: await loadReplies(supabase, workspaceId, source, source_id), analyzed: 0, note: "No comments on the thread yet." });
  }

  // 2. Who can we assign to, and what may they say?
  const members = await loadPersonaRoster(supabase, workspaceId);
  if (members.length === 0) {
    return NextResponse.json(
      { error: "No active roster members — add the team in the Reddit accounts panel first." },
      { status: 400 },
    );
  }

  // 3. Analyze.
  const result = await analyzeThreadReplies({
    subreddit,
    postTitle,
    postBody,
    comments: thread.comments,
    members,
    maxPicks: max_picks,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 500 });

  // 4. Persist. Clear stale un-actioned suggestions, then upsert the fresh set;
  //    posted/skipped rows are preserved (their state columns are omitted from
  //    the payload, so the ON CONFLICT update leaves them untouched).
  await supabase
    .from("forum_thread_replies")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("source", source)
    .eq("source_id", source_id)
    .eq("status", "suggested");

  const upserts = result.picks.map((p) => ({
    workspace_id: workspaceId,
    source,
    source_id,
    reddit_comment_id: p.reddit_comment_id,
    reddit_comment_url: p.reddit_comment_url,
    comment_author: p.comment_author,
    comment_excerpt: p.comment_excerpt,
    comment_score: p.comment_score,
    why: p.why,
    priority: p.priority,
    assigned_owner_label: p.assigned_owner_label,
    account_id: p.account_id,
    mention_level: p.mention_level,
    reply_text: p.reply_text,
    model: result.model,
  }));
  const { error: upsertErr } = await supabase
    .from("forum_thread_replies")
    .upsert(upserts, { onConflict: "workspace_id,source,source_id,reddit_comment_id" });
  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

  return NextResponse.json({
    replies: await loadReplies(supabase, workspaceId, source, source_id),
    analyzed: thread.comments.length,
  });
}

async function loadReplies(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  source: string,
  sourceId: string,
): Promise<ForumThreadReply[]> {
  const { data } = await supabase
    .from("forum_thread_replies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("source", source)
    .eq("source_id", sourceId)
    .order("priority", { ascending: true });
  return (data ?? []) as unknown as ForumThreadReply[];
}

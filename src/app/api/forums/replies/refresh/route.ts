import { NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/forums/server";
import { fetchRedditTraction } from "@/lib/forums/reddit";
import type { ForumReply } from "@/lib/forums/replies";

// Bulk traction sweep — each row may run via an Apify scrape (~30-90s), so
// allow the full window (refreshes what it can within the limit at scale).
export const maxDuration = 300;

// POST /api/forums/replies/refresh → { replies: ForumReply[], checked }
// Pull fresh Reddit traction (upvotes + comments) for every posted reply that
// has a URL, in one click. Returns the full updated list so the client
// re-renders. Mirrors /api/forums/distribution/refresh.
export async function POST() {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const { data: rows, error } = await supabase
    .from("forum_replies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "posted")
    .not("posted_url", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date().toISOString();

  // Sequential — Reddit rate-limits anonymous bursts and the posted set is small.
  for (const row of rows ?? []) {
    const url = row.posted_url as string | null;
    if (!url) continue;
    const result = await fetchRedditTraction(url);
    const update: Record<string, unknown> = { last_checked_at: now };
    if (result.ok) {
      update.score = result.traction.score;
      update.num_comments = result.traction.num_comments;
      update.upvote_ratio = result.traction.upvote_ratio;
      if (result.traction.author) update.posted_by_username = result.traction.author;
      update.traction_note = null;
    } else {
      update.traction_note = result.reason;
    }
    await supabase
      .from("forum_replies")
      .update(update)
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
  }

  const { data: updated, error: reReadErr } = await supabase
    .from("forum_replies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (reReadErr) return NextResponse.json({ error: reReadErr.message }, { status: 500 });

  return NextResponse.json({
    replies: (updated ?? []) as unknown as ForumReply[],
    checked: (rows ?? []).length,
  });
}

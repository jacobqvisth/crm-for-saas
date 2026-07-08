import { NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/forums/server";
import { fetchRedditTraction } from "@/lib/forums/reddit";
import type { ForumPost } from "@/lib/forums/types";

// Bulk traction sweep — each row may run via an Apify scrape (~30-90s), so
// allow the full window. At low volume this finishes; a large backlog will
// refresh what it can within the limit.
export const maxDuration = 300;

// POST /api/forums/refresh → { posts: ForumPost[], checked: number }
// Pull fresh Reddit traction (upvotes + comments) for every posted generated
// post in the workspace, one click. Returns the full updated list.
export async function POST() {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const { data: rows, error } = await supabase
    .from("forum_posts")
    .select("id, posted_url")
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
      update.traction_note = null;
    } else {
      update.traction_note = result.reason;
    }
    await supabase
      .from("forum_posts")
      .update(update)
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
  }

  const { data: updated, error: reReadErr } = await supabase
    .from("forum_posts")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (reReadErr) return NextResponse.json({ error: reReadErr.message }, { status: 500 });

  return NextResponse.json({
    posts: (updated ?? []) as unknown as ForumPost[],
    checked: (rows ?? []).length,
  });
}

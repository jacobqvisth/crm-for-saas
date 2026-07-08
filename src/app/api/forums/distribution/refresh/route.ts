import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspace } from "@/lib/forums/server";
import {
  DEFAULT_TOPIC,
  fetchRedditTraction,
  type DistributionRec,
} from "@/lib/forums/distribution";

// POST /api/forums/distribution/refresh?topic=... → { recs: DistributionRec[] }
// Pull fresh Reddit traction (upvotes + comments) for every posted row in the
// topic, one click. Returns the full updated list so the client can re-render.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const topic = request.nextUrl.searchParams.get("topic") || DEFAULT_TOPIC;

  const { data: rows, error } = await supabase
    .from("forum_distribution")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("topic", topic)
    .eq("status", "posted")
    .not("posted_url", "is", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date().toISOString();

  // Fetch traction for each posted row (sequentially — Reddit rate-limits
  // anonymous bursts, and the posted set is small).
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
      .from("forum_distribution")
      .update(update)
      .eq("id", row.id)
      .eq("workspace_id", workspaceId);
  }

  // Return the full, freshly-updated list in posting order.
  const { data: updated, error: reReadErr } = await supabase
    .from("forum_distribution")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("topic", topic)
    .order("sort_order", { ascending: true });
  if (reReadErr) return NextResponse.json({ error: reReadErr.message }, { status: 500 });

  return NextResponse.json({
    recs: (updated ?? []) as unknown as DistributionRec[],
    checked: (rows ?? []).length,
  });
}

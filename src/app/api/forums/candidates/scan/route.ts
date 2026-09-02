import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { SHARED_FORUMS_WORKSPACE_ID } from "@/lib/forums/server";
import { REPLY_SUBREDDITS } from "@/lib/forums/replies";
import { isApifyConfigured, apifySearchRedditPosts } from "@/lib/forums/reddit-apify";
import { fromRedditPost, upsertCandidates, type DiscoveredPost } from "@/lib/forums/candidates";
import { fetchGaragetBoards, GARAGET_BOARDS } from "@/lib/forums/garaget";
import { cronGate } from "@/lib/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cold Apify scrape can run ~200s; give the whole scan the max window.
export const maxDuration = 300;

// Questions older than this that nobody answered or skipped are dropped. The
// thread has moved on, and keeping them would grow the queue forever. Answered
// and skipped rows are kept: they're the memory that prevents repeat work.
const PRUNE_AFTER_DAYS = 30;

// How many posts to pull per scan, spread across the subreddits.
const SCAN_LIMIT = 25;

// Garaget serves 60 topics on a board's first page and orders by latest
// activity, so 30 is a full day's worth on even the busiest board with room to
// spare. Costs nothing either way; the cap just keeps the upsert payload sane.
const GARAGET_LIMIT_PER_BOARD = 30;

// Same SYNC_SECRET / CRON_SECRET Bearer auth as the rest of the cron routes —
// the scan spends Apify credits, so it must not be publicly triggerable.
function isAuthorized(request: NextRequest): boolean {
  const syncSecret = process.env.SYNC_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = bearer || request.headers.get("x-sync-secret");
  if (!syncSecret && !cronSecret) return process.env.NODE_ENV !== "production";
  return (
    (Boolean(syncSecret) && provided === syncSecret) ||
    (Boolean(cronSecret) && provided === cronSecret)
  );
}

// GET /api/forums/candidates/scan
//
// Vercel Cron hits this daily (crons are GET, and Vercel sends the CRON_SECRET
// bearer). Browses the diagnostic boards for new questions and banks them in
// forum_candidates, so /forums/answers already has a fresh queue when someone
// opens it instead of making them sit through a ~2 min scrape.
//
// Two sources, with very different costs:
//   Garaget  plain HTTP reads, no token, no spend. Always attempted.
//   Reddit   one Apify actor run per subreddit (5 today) against a $5/month
//            cap, which is why FORUM_CANDIDATE_SCAN_ENABLED exists.
//
// The flag still gates the whole route rather than just the Reddit half. It
// reads as "should the daily scan run at all", and someone switching it off to
// stop the spend would not expect a scan to keep writing rows. Turning Garaget
// on therefore means setting FORUM_CANDIDATE_SCAN_ENABLED=true, even though
// Garaget itself costs nothing.
//
// Uses the service-role client so the cron isn't tied to a user session; all
// forum tables share one workspace (SHARED_FORUMS_WORKSPACE_ID).
export async function GET(request: NextRequest) {
  // Feature gate. 200 rather than an error: a switched-off feature is not
  // a failure, and a cron that fails on a schedule buries the alert channel.
  const skip = await cronGate("forums");
  if (skip) return skip;

  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.FORUM_CANDIDATE_SCAN_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "FORUM_CANDIDATE_SCAN_ENABLED is not 'true'" });
  }

  const supabase = createServiceClient() as unknown as SupabaseClient;
  const workspaceId = SHARED_FORUMS_WORKSPACE_ID;

  const posts: DiscoveredPost[] = [];

  // Garaget first, and unconditionally: it is a plain HTTP read with no token,
  // no actor run and no spend, so it must not be skipped just because the paid
  // Reddit path is unavailable. A forum that fails here is reported, not fatal.
  const garaget = await fetchGaragetBoards({
    boardIds: GARAGET_BOARDS.map((b) => b.id),
    limitPerBoard: GARAGET_LIMIT_PER_BOARD,
  });
  posts.push(...garaget.posts);

  // Reddit costs one Apify actor run per subreddit against a $5/month cap, so
  // a missing token degrades the scan to Garaget-only rather than failing it.
  let redditSkipped: string | null = null;
  if (!isApifyConfigured()) {
    redditSkipped = "APIFY_TOKEN is not set";
  } else {
    // No keyword: we want whatever is newly asked, and keyword filtering now
    // happens locally over the persisted queue instead of costing another scrape.
    const reddit = await apifySearchRedditPosts({
      subreddits: REPLY_SUBREDDITS.map((s) => s.name),
      sort: "new",
      limit: SCAN_LIMIT,
    });
    if (reddit.failed) {
      redditSkipped = reddit.timedOut ? "Apify scrape timed out" : "Apify scrape failed";
    } else {
      posts.push(...reddit.posts.map(fromRedditPost));
    }
  }

  // Every source failing is a real failure; one failing is a degraded run.
  if (posts.length === 0 && redditSkipped && garaget.failedBoards.length > 0) {
    return NextResponse.json(
      { ok: false, reason: `no source returned posts (reddit: ${redditSkipped})` },
      { status: 503 },
    );
  }

  const { saved, error } = await upsertCandidates({
    supabase,
    workspaceId,
    posts,
    via: "cron",
    sort: "new",
  });
  if (error) {
    return NextResponse.json({ ok: false, reason: error }, { status: 500 });
  }

  // Prune stale unanswered questions. Two passes because a row whose scrape
  // carried no timestamp has to fall back to when we first saw it.
  const cutoff = new Date(Date.now() - PRUNE_AFTER_DAYS * 86_400_000).toISOString();
  const { count: prunedDated } = await supabase
    .from("forum_candidates")
    .delete({ count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("status", "new")
    .lt("posted_at", cutoff);
  const { count: prunedUndated } = await supabase
    .from("forum_candidates")
    .delete({ count: "exact" })
    .eq("workspace_id", workspaceId)
    .eq("status", "new")
    .is("posted_at", null)
    .lt("first_seen_at", cutoff);

  return NextResponse.json({
    ok: true,
    found: posts.length,
    saved,
    pruned: (prunedDated ?? 0) + (prunedUndated ?? 0),
    sources: {
      garaget: {
        found: garaget.posts.length,
        failedBoards: garaget.failedBoards,
      },
      reddit: redditSkipped
        ? { skipped: redditSkipped }
        : { found: posts.length - garaget.posts.length },
    },
  });
}

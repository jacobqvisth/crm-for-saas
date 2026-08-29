import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { SHARED_FORUMS_WORKSPACE_ID } from "@/lib/forums/server";
import { REPLY_SUBREDDITS } from "@/lib/forums/replies";
import { isApifyConfigured, apifySearchRedditPosts } from "@/lib/forums/reddit-apify";
import { upsertCandidates } from "@/lib/forums/candidates";
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
// bearer). Browses the diagnostic subreddits for new questions and banks them in
// forum_candidates, so /forums/answers already has a fresh queue when someone
// opens it instead of making them sit through a ~2 min scrape.
//
// Gated behind FORUM_CANDIDATE_SCAN_ENABLED because each firing is one Apify
// actor run per subreddit (5 today) and the Apify account runs on a $5/month
// cap. Unset the flag to stop spending without touching the cron schedule.
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
  if (!isApifyConfigured()) {
    return NextResponse.json({ ok: false, reason: "APIFY_TOKEN is not set" }, { status: 503 });
  }

  const supabase = createServiceClient() as unknown as SupabaseClient;
  const workspaceId = SHARED_FORUMS_WORKSPACE_ID;

  // No keyword: we want whatever is newly asked, and keyword filtering now
  // happens locally over the persisted queue instead of costing another scrape.
  const { posts, failed, timedOut } = await apifySearchRedditPosts({
    subreddits: REPLY_SUBREDDITS.map((s) => s.name),
    sort: "new",
    limit: SCAN_LIMIT,
  });

  if (failed) {
    return NextResponse.json(
      { ok: false, reason: timedOut ? "Apify scrape timed out" : "Apify scrape failed" },
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
  });
}

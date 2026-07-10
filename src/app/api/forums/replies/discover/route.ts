import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { isRedditConfigured, isRedditOAuthConfigured, searchRedditPosts } from "@/lib/forums/reddit";
import { isApifyConfigured, startApifySearchRuns } from "@/lib/forums/reddit-apify";
import { REPLY_SUBREDDITS } from "@/lib/forums/replies";

// This route only KICKS OFF the search now: it either runs the fast OAuth query
// inline, or starts the async Apify runs and hands the run handles back so the
// client can poll /discover/status. Either way it returns quickly, so it no
// longer needs the long sync-scrape window.
export const maxDuration = 60;

const ALLOWED = new Set(REPLY_SUBREDDITS.map((s) => s.name));

const bodySchema = z.object({
  subreddits: z.array(z.string()).optional(),
  query: z.string().max(300).optional(),
  sort: z.enum(["new", "hot", "relevance", "top"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

// POST /api/forums/replies/discover
// Start a search for candidate posts across the diagnostic subreddits. Returns
// one of:
//   { mode: "done", posts, redditConfigured }        — OAuth path (fast, inline)
//   { mode: "async", runs, redditConfigured }         — Apify path (poll /status)
//   { mode: "done", posts: [], error, redditConfigured } — nothing configured / start failed
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const redditConfigured = isRedditConfigured();
  const requested = (parsed.data.subreddits ?? []).filter((s) => ALLOWED.has(s));
  const subreddits = requested.length > 0 ? requested : REPLY_SUBREDDITS.map((s) => s.name);
  const limit = parsed.data.limit ?? 25;

  // OAuth is fast and works from datacenter IPs — run it inline.
  if (isRedditOAuthConfigured()) {
    const result = await searchRedditPosts({
      subreddits,
      query: parsed.data.query,
      sort: parsed.data.sort,
      limit,
    });
    if (!result.ok) {
      return NextResponse.json(
        { mode: "done", posts: [], redditConfigured, error: result.reason },
        { status: 502 },
      );
    }
    return NextResponse.json({ mode: "done", posts: result.posts, redditConfigured });
  }

  // Otherwise scrape via Apify — start the runs and let the client poll so it
  // can show progress instead of hanging on one long request.
  if (isApifyConfigured()) {
    const { runs, failed } = await startApifySearchRuns({
      subreddits,
      query: parsed.data.query,
      sort: parsed.data.sort,
      limit,
    });
    if (failed) {
      return NextResponse.json(
        { mode: "done", posts: [], redditConfigured, error: "Couldn't start the Reddit search. Try again shortly." },
        { status: 502 },
      );
    }
    return NextResponse.json({ mode: "async", runs, redditConfigured });
  }

  return NextResponse.json({
    mode: "done",
    posts: [],
    redditConfigured,
    error:
      "Reddit reads not configured — add REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET or an APIFY_TOKEN to enable finding posts. You can still paste a post URL below.",
  });
}

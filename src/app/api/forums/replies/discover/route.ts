import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { resolveWorkspace } from "@/lib/forums/server";
import { isRedditConfigured } from "@/lib/forums/reddit";
import { isApifyConfigured, startApifySearchRuns } from "@/lib/forums/reddit-apify";
import { REPLY_SOURCES, REPLY_SUBREDDITS, replySourceByKey } from "@/lib/forums/replies";
import { fetchGaragetBoards } from "@/lib/forums/garaget";
import { upsertCandidates } from "@/lib/forums/candidates";

// The Reddit half of this route only KICKS OFF the search: it starts the async
// Apify runs and hands the run handles back so the client can poll
// /discover/status. Garaget is a handful of plain HTTP reads, so it resolves
// inline here and is already banked in the queue by the time this returns.
export const maxDuration = 60;

const ALLOWED_SUBS = new Set(REPLY_SUBREDDITS.map((s) => s.name));
const ALLOWED_KEYS = new Set(REPLY_SOURCES.map((s) => s.key));

const bodySchema = z.object({
  // Preferred: platform-qualified keys ("reddit:MechanicAdvice", "garaget:42").
  sources: z.array(z.string().max(80)).max(24).optional(),
  // Back-compat: bare subreddit names from a client that predates Garaget.
  subreddits: z.array(z.string()).optional(),
  query: z.string().max(300).optional(),
  sort: z.enum(["new", "hot", "relevance", "top"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

// POST /api/forums/replies/discover
//
// Start a search for candidate questions across the selected boards. Returns:
//   { mode: "async", runs, redditConfigured, garaget }  — poll /discover/status
//   { mode: "done", posts: [], redditConfigured, garaget, error? }
//
// `garaget` is filled in on both paths, because those results are already saved
// to the queue: the client only has to reload the queue to show them, with no
// polling. A Garaget-only search therefore returns mode:"done" with no error,
// which is a successful search rather than an unconfigured one.
export async function POST(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const redditConfigured = isRedditConfigured();
  const limit = parsed.data.limit ?? 25;

  // Resolve the selection into per-platform board lists. An empty or fully
  // invalid selection means "everything", matching the previous behaviour.
  const keys = (parsed.data.sources ?? []).filter((k) => ALLOWED_KEYS.has(k));
  const legacySubs = (parsed.data.subreddits ?? []).filter((s) => ALLOWED_SUBS.has(s));

  let subreddits: string[];
  let garagetBoards: string[];

  if (keys.length > 0) {
    const picked = keys.map((k) => replySourceByKey(k)).filter((s) => s !== undefined);
    subreddits = picked.filter((s) => s.platform === "reddit").map((s) => s.board);
    garagetBoards = picked.filter((s) => s.platform === "garaget").map((s) => s.board);
  } else if (legacySubs.length > 0) {
    subreddits = legacySubs;
    garagetBoards = [];
  } else {
    subreddits = REPLY_SUBREDDITS.map((s) => s.name);
    garagetBoards = REPLY_SOURCES.filter((s) => s.platform === "garaget").map((s) => s.board);
  }

  // --- Garaget: inline, free, and saved before we return -------------------
  let garaget: { found: number; saved: number; failedBoards: string[] } | null = null;
  if (garagetBoards.length > 0) {
    const res = await fetchGaragetBoards({ boardIds: garagetBoards, limitPerBoard: limit });
    const { saved, error } = await upsertCandidates({
      supabase: supabase as unknown as SupabaseClient,
      workspaceId,
      posts: res.posts,
      via: "search",
      query: parsed.data.query ?? null,
      sort: parsed.data.sort ?? null,
    });
    if (error) console.error("[forums] garaget candidate upsert failed:", error);
    garaget = { found: res.posts.length, saved, failedBoards: res.failedBoards };
  }

  // --- Reddit: start the paid actor runs and hand back the handles ---------
  if (subreddits.length > 0 && isApifyConfigured()) {
    const { runs, failed } = await startApifySearchRuns({
      subreddits,
      query: parsed.data.query,
      sort: parsed.data.sort,
      limit,
    });
    if (failed) {
      return NextResponse.json(
        {
          mode: "done",
          posts: [],
          redditConfigured,
          garaget,
          error: "Couldn't start the Reddit search. Try again shortly.",
        },
        // Garaget results are already banked, so this is a partial success, not
        // a failed request. 200 with an error message beats a 502 that makes the
        // client throw away a search that half worked.
        { status: garaget ? 200 : 502 },
      );
    }
    return NextResponse.json({ mode: "async", runs, redditConfigured, garaget });
  }

  // No Reddit leg: either none was selected, or Apify isn't configured.
  const needsReddit = subreddits.length > 0 && !isApifyConfigured();
  return NextResponse.json({
    mode: "done",
    posts: [],
    redditConfigured,
    garaget,
    error: needsReddit
      ? "Reddit reads aren't set up (no APIFY_TOKEN) — searching Reddit is off. Garaget still works, and you can paste a post URL below."
      : undefined,
  });
}

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWorkspace } from "@/lib/forums/server";
import {
  CANDIDATE_PAGE_SIZE,
  CANDIDATE_SORTS,
  DEFAULT_CANDIDATE_DAYS,
  candidateOrder,
  type CandidateSort,
  type ForumCandidate,
  type ForumCandidateCounts,
} from "@/lib/forums/candidates";

// GET /api/forums/candidates → { candidates, counts, lastFoundAt }
//
// The persistent queue behind "Answer posts". This is what the page reads on
// load, so found questions survive a reload instead of dying with the component
// state. Query params:
//   status = new | answered | skipped | all   (default: new)
//   days   = window on the post's own age     (default: 14, 0 = no window)
//   sort   = newest | comments | found        (default: newest)
//   subs   = comma-separated subreddit names  (optional)
//
// forum_candidates isn't in database.types.ts, so go through an untyped client.
export async function GET(request: NextRequest) {
  const ws = await resolveWorkspace();
  if (ws.error) return ws.error;
  const { supabase, workspaceId } = ws;
  const raw = supabase as unknown as SupabaseClient;

  const params = request.nextUrl.searchParams;
  const status = params.get("status") ?? "new";
  const sortParam = params.get("sort") ?? "newest";
  const sort: CandidateSort = (CANDIDATE_SORTS as readonly string[]).includes(sortParam)
    ? (sortParam as CandidateSort)
    : "newest";

  const daysRaw = Number(params.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw >= 0 ? daysRaw : DEFAULT_CANDIDATE_DAYS;
  // Window on the question's own age, not on when we found it: a post from
  // three weeks ago is stale even if the scrape saw it this morning. Rows with
  // no posted_at (an odd scrape) are kept rather than silently dropped.
  const since =
    days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
  const windowed = <T extends { or: (f: string) => T }>(q: T): T =>
    since ? q.or(`posted_at.gte.${since},posted_at.is.null`) : q;

  const subs = (params.get("subs") ?? "")
    .split(",")
    .map((s) => s.replace(/^\/?r\//i, "").trim())
    .filter(Boolean);

  const order = candidateOrder(sort);
  let query = raw
    .from("forum_candidates")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order(order.column, { ascending: order.ascending, nullsFirst: order.nullsFirst })
    // posted_at is not unique, so a second key keeps paging stable and stops
    // rows duplicating or vanishing between reads.
    .order("reddit_id", { ascending: true })
    .limit(CANDIDATE_PAGE_SIZE);

  if (status !== "all") query = query.eq("status", status);
  if (subs.length > 0) query = query.in("subreddit", subs);
  query = windowed(query);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Chip counts, over the same window so the numbers match what a chip shows.
  const countFor = async (s: string): Promise<number> => {
    let q = raw
      .from("forum_candidates")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    if (s !== "all") q = q.eq("status", s);
    if (subs.length > 0) q = q.in("subreddit", subs);
    const { count } = await windowed(q);
    return count ?? 0;
  };
  const [openCount, answeredCount, skippedCount, allCount] = await Promise.all([
    countFor("new"),
    countFor("answered"),
    countFor("skipped"),
    countFor("all"),
  ]);
  const counts: ForumCandidateCounts = {
    new: openCount,
    answered: answeredCount,
    skipped: skippedCount,
    all: allCount,
  };

  // Freshness stamp for the header ("last found 2h ago"). Deliberately outside
  // the age window: it answers "when did we last look", not "how new is this".
  const { data: newest } = await raw
    .from("forum_candidates")
    .select("last_seen_at")
    .eq("workspace_id", workspaceId)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    candidates: (data ?? []) as unknown as ForumCandidate[],
    counts,
    lastFoundAt: (newest as { last_seen_at?: string } | null)?.last_seen_at ?? null,
  });
}

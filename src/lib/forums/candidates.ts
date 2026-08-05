// Forums → Answer posts: the persistent candidate queue.
//
// Discovery used to be throwaway. "Find posts" held its results in React state,
// so a reload lost every question you hadn't drafted a reply to, and the only
// way to see them again was to re-run the Apify scrape (one actor run per
// subreddit, ~2 min cold, billed against a $5/mo cap).
//
// Every discovered post is now upserted into forum_candidates, keyed on the
// Reddit post id, so the page opens with a worklist: open questions first,
// answered ones marked, skipped ones greyed out and out of the way. See the
// migration 20260805120000_forum_candidates.sql.
//
// forum_candidates is not in database.types.ts (same as reddit_mentions), so
// callers hand us an untyped SupabaseClient view.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedditPost } from "./reddit";
import { redditFullname } from "./reddit";

export type ForumCandidateStatus = "new" | "answered" | "skipped";

// How the post came to us. 'search' = a user clicked Find posts, 'cron' = the
// daily scan, 'backfill' = seeded from an existing drafted reply.
export type ForumCandidateSource = "search" | "cron" | "backfill";

export interface ForumCandidate {
  id: string;
  reddit_id: string;
  fullname: string | null;
  subreddit: string | null;
  title: string;
  body: string | null;
  author: string | null;
  url: string | null;
  score: number | null;
  num_comments: number | null;
  posted_at: string | null;
  status: ForumCandidateStatus;
  reply_id: string | null;
  skipped_reason: string | null;
  discovered_via: ForumCandidateSource;
  search_query: string | null;
  search_sort: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

// Per-status totals for the queue's filter chips, so the counts reflect the
// whole table rather than the current page of rows.
export interface ForumCandidateCounts {
  new: number;
  answered: number;
  skipped: number;
  all: number;
}

// Default window for the queue. A question older than this rarely deserves a
// reply — the thread has moved on — so it drops out of view without being
// deleted (`days=0` shows everything).
export const DEFAULT_CANDIDATE_DAYS = 14;

// Rows returned per queue read. Generous enough that the client can filter by
// keyword locally instead of paying Apify for a keyword search.
export const CANDIDATE_PAGE_SIZE = 200;

export const CANDIDATE_SORTS = ["newest", "comments", "found"] as const;
export type CandidateSort = (typeof CANDIDATE_SORTS)[number];

// Column + direction for each sort. `posted_at` can be null on rows whose
// scrape didn't carry a timestamp, so nulls sort last rather than on top.
export function candidateOrder(sort: CandidateSort): {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
} {
  if (sort === "comments") return { column: "num_comments", ascending: false, nullsFirst: false };
  if (sort === "found") return { column: "last_seen_at", ascending: false, nullsFirst: false };
  return { column: "posted_at", ascending: false, nullsFirst: false };
}

// The base-36 Reddit post id from a permalink ("…/comments/1abc2de/…" → "1abc2de").
// Shares redditFullname's URL parsing so both agree on what counts as a post URL.
export function redditIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const fullname = redditFullname(url);
  return fullname ? fullname.replace(/^t3_/, "") : null;
}

const toIso = (createdUtc: number | null): string | null =>
  createdUtc ? new Date(createdUtc * 1000).toISOString() : null;

/**
 * Upsert discovered posts into the queue. Idempotent: re-discovering a post
 * refreshes its snapshot and traction and bumps last_seen_at.
 *
 * `status`, `reply_id` and `first_seen_at` are deliberately NOT in the payload.
 * PostgREST only writes the columns you send, so on conflict a post you already
 * skipped or answered keeps that state instead of being resurrected as new, and
 * first_seen_at keeps its original value.
 *
 * Never throws — discovery must not fail because the cache write did.
 */
export async function upsertCandidates(opts: {
  supabase: SupabaseClient;
  workspaceId: string;
  posts: RedditPost[];
  via: ForumCandidateSource;
  query?: string | null;
  sort?: string | null;
}): Promise<{ saved: number; error: string | null }> {
  const { supabase, workspaceId, posts, via } = opts;
  if (posts.length === 0) return { saved: 0, error: null };

  const seen = new Set<string>();
  const rows = posts
    .filter((p) => {
      // A duplicate id inside one payload makes Postgres reject the whole
      // upsert ("cannot affect row a second time"), so de-dupe first.
      if (!p.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    })
    .map((p) => ({
      workspace_id: workspaceId,
      reddit_id: p.id,
      fullname: p.fullname ?? `t3_${p.id}`,
      subreddit: p.subreddit || null,
      title: p.title || "(untitled post)",
      body: p.body || null,
      author: p.author ?? null,
      url: p.url || null,
      score: p.score ?? null,
      num_comments: p.num_comments ?? null,
      posted_at: toIso(p.created_utc),
      discovered_via: via,
      search_query: opts.query?.trim() || null,
      search_sort: opts.sort || null,
      last_seen_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return { saved: 0, error: null };

  const { error } = await supabase
    .from("forum_candidates")
    .upsert(rows, { onConflict: "workspace_id,reddit_id" });

  if (error) return { saved: 0, error: error.message };
  return { saved: rows.length, error: null };
}

/**
 * Mark the candidate matching a source URL as answered and point it at the
 * drafted reply. Called after a reply is generated so the question leaves the
 * open queue. A pasted URL we never discovered has no row to update, which is
 * fine: the reply board is still the record of it.
 *
 * Never throws — a reply that drafted fine must not 500 over bookkeeping.
 */
export async function markCandidateAnswered(opts: {
  supabase: SupabaseClient;
  workspaceId: string;
  sourceUrl: string | null | undefined;
  replyId: string;
}): Promise<void> {
  const redditId = redditIdFromUrl(opts.sourceUrl);
  if (!redditId) return;
  await opts.supabase
    .from("forum_candidates")
    .update({ status: "answered", reply_id: opts.replyId })
    .eq("workspace_id", opts.workspaceId)
    .eq("reddit_id", redditId);
}

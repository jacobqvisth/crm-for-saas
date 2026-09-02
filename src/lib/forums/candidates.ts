// Forums → Answer posts: the persistent candidate queue.
//
// Discovery used to be throwaway. "Find posts" held its results in React state,
// so a reload lost every question you hadn't drafted a reply to, and the only
// way to see them again was to re-run the Apify scrape (one actor run per
// subreddit, ~2 min cold, billed against a $5/mo cap).
//
// Every discovered post is now upserted into forum_candidates so the page opens
// with a worklist: open questions first, answered ones marked, skipped ones
// greyed out and out of the way. See 20260805120000_forum_candidates.sql.
//
// The queue is no longer Reddit-only. A row's identity is (platform,
// external_id), so a Garaget topic and a Reddit post can share the table
// without either pretending to be the other. See
// 20260902140000_forum_candidates_multi_platform.sql. Reddit rows still write
// reddit_id/subreddit as well, because the client and the traction reads still
// key off them.
//
// forum_candidates is not in database.types.ts (same as reddit_mentions), so
// callers hand us an untyped SupabaseClient view.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedditPost } from "./reddit";
import { redditFullname } from "./reddit";
import type { ForumPlatform } from "./types";

export type { ForumPlatform };

export type ForumCandidateStatus = "new" | "answered" | "skipped";

// How the post came to us. 'search' = a user clicked Find posts, 'cron' = the
// daily scan, 'backfill' = seeded from an existing drafted reply.
export type ForumCandidateSource = "search" | "cron" | "backfill";

/**
 * A question found on some forum, before it becomes a queue row.
 *
 * Platform-agnostic on purpose: each source module (reddit-apify.ts,
 * garaget.ts) is responsible for producing this shape, and everything
 * downstream, the upsert, the queue, the draft generator, works from it without
 * knowing which forum it came from.
 *
 * `score` is nullable because not every forum has votes. Garaget has none, and
 * a 0 there would read as "nobody upvoted this" rather than "this forum has no
 * such concept".
 */
export interface DiscoveredPost {
  platform: ForumPlatform;
  /** The platform's own thread id. Reddit base-36 post id, or a Garaget topic id. */
  external_id: string;
  /** Board key: subreddit name on Reddit, numeric board id on Garaget. */
  board: string | null;
  /** Human-readable board name, when the source knows it. Display only. */
  board_label?: string | null;
  title: string;
  body: string | null;
  author: string | null;
  url: string;
  score: number | null;
  num_comments: number | null;
  created_utc: number | null;
}

export interface ForumCandidate {
  id: string;
  platform: ForumPlatform;
  external_id: string;
  board: string | null;
  reddit_id: string | null;
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

/**
 * Identify which forum a URL belongs to, and its id there.
 *
 * Used when someone pastes a thread URL by hand, and when marking a candidate
 * answered from a reply that only knows its source URL. Returns null for a URL
 * we don't recognise rather than guessing, so a typo can't silently update the
 * wrong row.
 */
export function identifyPost(
  url: string | null | undefined,
): { platform: ForumPlatform; externalId: string } | null {
  if (!url) return null;

  const redditId = redditIdFromUrl(url);
  if (redditId) return { platform: "reddit", externalId: redditId };

  if (/garaget\.org/i.test(url)) {
    const m = /viewtopic\.php\?id=(\d+)/.exec(url);
    if (m) return { platform: "garaget", externalId: m[1] };
  }

  return null;
}

const toIso = (createdUtc: number | null): string | null =>
  createdUtc ? new Date(createdUtc * 1000).toISOString() : null;

/** Adapt the Reddit scraper's output to the platform-agnostic shape. */
export function fromRedditPost(p: RedditPost): DiscoveredPost {
  return {
    platform: "reddit",
    external_id: p.id,
    board: p.subreddit || null,
    board_label: p.subreddit ? `r/${p.subreddit}` : null,
    title: p.title || "(untitled post)",
    body: p.body || null,
    author: p.author ?? null,
    url: p.url || "",
    score: p.score ?? null,
    num_comments: p.num_comments ?? null,
    created_utc: p.created_utc,
  };
}

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
  posts: DiscoveredPost[];
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
      // upsert ("cannot affect row a second time"), so de-dupe first. The key
      // is platform-scoped now, since two forums can use the same id string.
      const key = `${p.platform}:${p.external_id}`;
      if (!p.external_id || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((p) => ({
      workspace_id: workspaceId,
      platform: p.platform,
      external_id: p.external_id,
      board: p.board,
      // Reddit rows keep filling the original columns: the client, the traction
      // refresh and the mention scan all still read them.
      reddit_id: p.platform === "reddit" ? p.external_id : null,
      fullname: p.platform === "reddit" ? `t3_${p.external_id}` : null,
      subreddit: p.platform === "reddit" ? p.board : p.board_label ?? p.board,
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
    .upsert(rows, { onConflict: "workspace_id,platform,external_id" });

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
  const found = identifyPost(opts.sourceUrl);
  if (!found) return;
  await opts.supabase
    .from("forum_candidates")
    .update({ status: "answered", reply_id: opts.replyId })
    .eq("workspace_id", opts.workspaceId)
    .eq("platform", found.platform)
    .eq("external_id", found.externalId);
}

// Forums → Wrenchlane mention scan (Phase 3). Finds the Wrenchlane footprint on
// Reddit that we DIDN'T create — other users linking to us or naming us — plus
// any of our own that the backfill can't see (mentions inside comment trees).
//
// Two passes, both via Apify (our only live read path — Reddit's anonymous JSON
// 403s from Vercel):
//   1. Keyword search "wrenchlane" across the car/mechanic subreddits we care
//      about (roster subs + the answer-post subs).
//   2. Comment sweep of the threads we've already posted in — a mention can be
//      buried in a reply the keyword search won't surface.
//
// Each hit is classified by author: a roster handle → audience='us', anyone
// else → 'third_party' (status='new', so it lands in a review queue and can be
// Slack-alerted). Idempotent: upsert on (workspace_id, source_url, author).

import type { SupabaseClient } from "@supabase/supabase-js";
import { apifySearchRedditPosts, apifyFetchRedditComments, isApifyConfigured } from "./reddit-apify";
import { REPLY_SUBREDDITS } from "./replies";
import { detectWrenchlane, wrenchlaneExcerpt } from "./wl-domains";
import { enrichMention } from "./mention-enrich";

type RawDB = SupabaseClient;

export interface ScanMentionsResult {
  ok: boolean;
  reason?: string;
  postsScanned: number;
  threadsSwept: number;
  found: number;
  // New, AI-confirmed third-party hits this run — the route Slack-alerts these.
  // Noise (is_about_us=false) is auto-dismissed and excluded here.
  newThirdParty: {
    id: string;
    kind: string;
    subreddit: string | null;
    author: string | null;
    source_url: string;
    excerpt: string | null;
    sentiment: string | null;
    summary: string | null;
  }[];
}

interface DetectedMention {
  kind: "link" | "plaintext";
  audience: "us" | "third_party";
  source_url: string;
  subreddit: string | null;
  author: string;
  matched_domain: string | null;
  excerpt: string;
  is_comment: boolean;
  score: number | null;
  num_comments: number | null;
}

// Bare handle, lowercased, no u/.
const handle = (s: string | null | undefined) => (s ?? "").replace(/^\/?u\//i, "").trim().toLowerCase();

export async function scanRedditMentions(opts: {
  supabase: RawDB;
  workspaceId: string;
  // Cap the comment sweep so a daily cron stays inside maxDuration.
  maxThreads?: number;
}): Promise<ScanMentionsResult> {
  const { supabase, workspaceId } = opts;
  const maxThreads = opts.maxThreads ?? 15;
  const empty: ScanMentionsResult = { ok: false, postsScanned: 0, threadsSwept: 0, found: 0, newThirdParty: [] };

  if (!isApifyConfigured()) {
    return { ...empty, reason: "APIFY_TOKEN not set" };
  }

  // Roster: handle → account_id, and the union of subreddits to search.
  const { data: accounts } = await supabase
    .from("reddit_accounts")
    .select("id, username, subreddits")
    .eq("workspace_id", workspaceId);
  const rosterByHandle = new Map<string, string>(); // handle → account_id
  const subs = new Set<string>(REPLY_SUBREDDITS.map((s) => s.name));
  for (const a of (accounts ?? []) as { id: string; username: string | null; subreddits: string[] | null }[]) {
    if (a.username) rosterByHandle.set(handle(a.username), a.id);
    for (const s of a.subreddits ?? []) subs.add(s.replace(/^\/?r\//i, "").trim());
  }

  const detected = new Map<string, DetectedMention>(); // keyed source_url|author
  const add = (m: DetectedMention) => {
    const key = `${m.source_url}|${m.author}`;
    if (!detected.has(key)) detected.set(key, m);
  };
  const classify = (author: string | null): "us" | "third_party" =>
    rosterByHandle.has(handle(author)) ? "us" : "third_party";

  // Pass 1 — keyword search.
  const search = await apifySearchRedditPosts({
    subreddits: [...subs],
    query: "wrenchlane",
    sort: "new",
    limit: 60,
  });
  for (const p of search.posts) {
    const hit = detectWrenchlane(`${p.title}\n${p.body}`);
    if (!hit || !p.url) continue;
    add({
      kind: hit.kind,
      audience: classify(p.author),
      source_url: p.url,
      subreddit: p.subreddit || null,
      author: handle(p.author) || "",
      matched_domain: hit.matchedDomain,
      excerpt: wrenchlaneExcerpt(`${p.title}\n${p.body}`),
      is_comment: false,
      score: p.score,
      num_comments: p.num_comments,
    });
  }

  // Pass 2 — comment sweep of our posted threads (newest first, capped).
  const posted = await gatherPostedThreads(supabase, workspaceId, maxThreads);
  const sweeps = await Promise.all(
    posted.map(async (t) => {
      const comments = await apifyFetchRedditComments(t.url, 200);
      return { thread: t, comments };
    }),
  );
  for (const { thread, comments } of sweeps) {
    for (const c of comments) {
      const hit = detectWrenchlane(c.body);
      if (!hit) continue;
      add({
        kind: hit.kind,
        audience: classify(c.author),
        source_url: c.permalink || thread.url,
        subreddit: thread.subreddit,
        author: handle(c.author) || "",
        matched_domain: hit.matchedDomain,
        excerpt: wrenchlaneExcerpt(c.body),
        is_comment: true,
        score: c.score,
        num_comments: null,
      });
    }
  }

  const rows = [...detected.values()];
  if (rows.length === 0) {
    return { ok: true, postsScanned: search.posts.length, threadsSwept: posted.length, found: 0, newThirdParty: [] };
  }

  // Which third-party source_urls already exist → tell new hits from repeats.
  const { data: existing } = await supabase
    .from("reddit_mentions")
    .select("source_url, author")
    .eq("workspace_id", workspaceId);
  const existingKeys = new Set(
    ((existing ?? []) as { source_url: string; author: string | null }[]).map(
      (e) => `${e.source_url}|${e.author ?? ""}`,
    ),
  );

  const nowIso = new Date().toISOString();
  const payload = rows.map((m) => ({
    workspace_id: workspaceId,
    kind: m.kind,
    audience: m.audience,
    source_url: m.source_url,
    subreddit: m.subreddit,
    author: m.author,
    account_id: m.audience === "us" ? rosterByHandle.get(m.author) ?? null : null,
    matched_domain: m.matched_domain,
    excerpt: m.excerpt,
    is_comment: m.is_comment,
    score: m.score,
    num_comments: m.num_comments,
    // Our own footprint is trusted; third-party waits for review.
    status: m.audience === "us" ? "confirmed" : "new",
    last_checked_at: nowIso,
  }));

  const { data: upserted, error } = await supabase
    .from("reddit_mentions")
    .upsert(payload, { onConflict: "workspace_id,source_url,author" })
    .select("id, kind, audience, subreddit, author, source_url, excerpt");
  if (error) return { ...empty, reason: error.message };

  type UpsertedRow = {
    id: string;
    kind: string;
    audience: string;
    subreddit: string | null;
    author: string | null;
    source_url: string;
    excerpt: string | null;
  };
  const freshThirdParty = ((upserted ?? []) as UpsertedRow[]).filter(
    (u) => u.audience === "third_party" && !existingKeys.has(`${u.source_url}|${u.author ?? ""}`),
  );

  // Enrich fresh third-party hits: sentiment + a noise filter. is_about_us=false
  // is auto-dismissed so the review queue and Slack only see real mentions.
  // Capped so a big burst can't blow maxDuration; leftovers get enriched by the
  // on-demand /enrich route or the next run.
  const ENRICH_CAP = 20;
  const confirmed: ScanMentionsResult["newThirdParty"] = [];
  for (const u of freshThirdParty.slice(0, ENRICH_CAP)) {
    const res = await enrichMention({ subreddit: u.subreddit, author: u.author, text: u.excerpt ?? "" });
    if (!res.ok) {
      // Leave it status='new', unenriched — a human still sees it in the queue.
      confirmed.push({
        id: u.id, kind: u.kind, subreddit: u.subreddit, author: u.author,
        source_url: u.source_url, excerpt: u.excerpt, sentiment: null, summary: null,
      });
      continue;
    }
    const e = res.enrichment;
    await supabase
      .from("reddit_mentions")
      .update({
        sentiment: e.sentiment,
        context_tag: e.contextTag,
        ai_summary: e.summary,
        is_about_us: e.isAboutUs,
        status: e.isAboutUs ? "new" : "dismissed",
      })
      .eq("id", u.id);
    if (e.isAboutUs) {
      confirmed.push({
        id: u.id, kind: u.kind, subreddit: u.subreddit, author: u.author,
        source_url: u.source_url, excerpt: u.excerpt, sentiment: e.sentiment, summary: e.summary,
      });
    }
  }

  return {
    ok: true,
    postsScanned: search.posts.length,
    threadsSwept: posted.length,
    found: rows.length,
    newThirdParty: confirmed,
  };
}

// The threads we've posted in (any board), newest first, deduped by URL.
async function gatherPostedThreads(
  supabase: RawDB,
  workspaceId: string,
  limit: number,
): Promise<{ url: string; subreddit: string | null }[]> {
  const [posts, dist, replies] = await Promise.all([
    supabase
      .from("forum_posts")
      .select("posted_url, posted_at, forum_target")
      .eq("workspace_id", workspaceId)
      .not("posted_url", "is", null)
      .order("posted_at", { ascending: false }),
    supabase
      .from("forum_distribution")
      .select("posted_url, posted_at, subreddit")
      .eq("workspace_id", workspaceId)
      .not("posted_url", "is", null)
      .order("posted_at", { ascending: false }),
    supabase
      .from("forum_replies")
      .select("posted_url, posted_at, source_subreddit")
      .eq("workspace_id", workspaceId)
      .not("posted_url", "is", null)
      .order("posted_at", { ascending: false }),
  ]);

  const out = new Map<string, { url: string; subreddit: string | null }>();
  for (const p of (posts.data ?? []) as Record<string, unknown>[]) {
    const url = String(p.posted_url);
    const sub = typeof p.forum_target === "string" ? p.forum_target.replace(/^reddit:/i, "") : null;
    if (!out.has(url)) out.set(url, { url, subreddit: sub });
  }
  for (const d of (dist.data ?? []) as Record<string, unknown>[]) {
    const url = String(d.posted_url);
    if (!out.has(url)) out.set(url, { url, subreddit: (d.subreddit as string) ?? null });
  }
  for (const r of (replies.data ?? []) as Record<string, unknown>[]) {
    const url = String(r.posted_url);
    if (!out.has(url)) out.set(url, { url, subreddit: (r.source_subreddit as string) ?? null });
  }
  return [...out.values()].slice(0, limit);
}

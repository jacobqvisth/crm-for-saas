// Forums → Gap log auto-discovery. Runs on the posts the Answer-posts "Find
// posts" scrape already fetched — no second Reddit call, so no extra Apify cost.
//
// Pipeline: drop anything that is OUR OWN footprint (a roster handle authored it,
// or the URL is one we already posted / already logged / already have a candidate
// for), then classify the rest for "AI diagnosis went wrong", keep the real ones,
// and upsert them into forum_gap_candidates for review in the Gap log.

import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyGapPost } from "./gap-classify";
import type { GapCandidate } from "./gaps";

type RawDB = SupabaseClient;

// The subset of a scraped Reddit post the scan needs.
export interface GapScanPost {
  url: string;
  subreddit: string | null;
  title: string;
  body: string | null;
  author: string | null;
  score: number | null;
  num_comments: number | null;
}

export interface GapScanResult {
  ok: boolean;
  reason?: string;
  received: number; // posts handed in
  screened: number; // posts actually sent to the classifier (post-dedup)
  skippedOwn: number; // dropped as our own content / already known
  skippedCapped: number; // over the per-run classify cap (see MAX_CLASSIFY)
  found: number; // new AI-failure candidates upserted
  candidates: GapCandidate[];
}

// One Claude call per post — cap so a big result set can't blow the request
// window. Anything above the cap is reported in skippedCapped, not silently
// dropped, and will be picked up on the next scan (dedup keeps it cheap).
const MAX_CLASSIFY = 15;

// Bare handle, lowercased, no u/ — matches mention-scan's convention.
const handle = (s: string | null | undefined) => (s ?? "").replace(/^\/?u\//i, "").trim().toLowerCase();

// Canonical Reddit permalink for dedup: scheme+host normalised, query/hash and
// trailing slash stripped, lowercased. Keeps www vs old vs no-subdomain from
// splitting the same thread into two rows.
export function normalizeRedditUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  let u = raw.trim();
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    parsed.search = "";
    let path = parsed.pathname.replace(/\/+$/, "");
    u = `https://reddit.com${path}`;
  } catch {
    u = u.split(/[?#]/)[0].replace(/\/+$/, "");
  }
  return u.toLowerCase();
}

export async function scanGapCandidates(opts: {
  supabase: RawDB;
  workspaceId: string;
  posts: GapScanPost[];
}): Promise<GapScanResult> {
  const { supabase, workspaceId, posts } = opts;
  const base: GapScanResult = {
    ok: false,
    received: posts.length,
    screened: 0,
    skippedOwn: 0,
    skippedCapped: 0,
    found: 0,
    candidates: [],
  };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ...base, reason: "ANTHROPIC_API_KEY not set" };
  }
  if (posts.length === 0) return { ...base, ok: true };

  // --- Build the "our own / already known" exclusion set ---------------------
  const [accounts, postsOwn, dist, replies, stories, candidates] = await Promise.all([
    supabase.from("reddit_accounts").select("username").eq("workspace_id", workspaceId),
    supabase.from("forum_posts").select("posted_url").eq("workspace_id", workspaceId).not("posted_url", "is", null),
    supabase.from("forum_distribution").select("posted_url").eq("workspace_id", workspaceId).not("posted_url", "is", null),
    supabase.from("forum_replies").select("posted_url, source_url").eq("workspace_id", workspaceId),
    supabase.from("ai_failure_stories").select("source_url").eq("workspace_id", workspaceId).not("source_url", "is", null),
    supabase.from("forum_gap_candidates").select("source_url").eq("workspace_id", workspaceId),
  ]);

  const rosterHandles = new Set(
    ((accounts.data ?? []) as { username: string | null }[])
      .map((a) => handle(a.username))
      .filter((h) => h.length > 0),
  );

  const knownUrls = new Set<string>();
  const addUrl = (v: unknown) => {
    const n = normalizeRedditUrl(typeof v === "string" ? v : null);
    if (n) knownUrls.add(n);
  };
  for (const r of (postsOwn.data ?? []) as Record<string, unknown>[]) addUrl(r.posted_url);
  for (const r of (dist.data ?? []) as Record<string, unknown>[]) addUrl(r.posted_url);
  for (const r of (replies.data ?? []) as Record<string, unknown>[]) {
    addUrl(r.posted_url);
    addUrl(r.source_url);
  }
  for (const r of (stories.data ?? []) as Record<string, unknown>[]) addUrl(r.source_url);
  for (const r of (candidates.data ?? []) as Record<string, unknown>[]) addUrl(r.source_url);

  // --- Dedup the incoming posts against ourselves + each other ---------------
  const seenIncoming = new Set<string>();
  const fresh: GapScanPost[] = [];
  let skippedOwn = 0;
  for (const p of posts) {
    const key = normalizeRedditUrl(p.url);
    if (!key) continue;
    if (rosterHandles.has(handle(p.author)) || knownUrls.has(key) || seenIncoming.has(key)) {
      skippedOwn++;
      continue;
    }
    seenIncoming.add(key);
    fresh.push(p);
  }

  const toClassify = fresh.slice(0, MAX_CLASSIFY);
  const skippedCapped = fresh.length - toClassify.length;

  // --- Classify (concurrently) and keep the real AI-failure cases ------------
  const classified = await Promise.all(
    toClassify.map(async (p) => {
      const res = await classifyGapPost({
        subreddit: p.subreddit,
        author: p.author,
        title: p.title,
        body: p.body,
      });
      return { post: p, res };
    }),
  );

  const nowIso = new Date().toISOString();
  const payload = classified
    .filter((c) => c.res.ok && c.res.classification.isAiFailureCase)
    .map((c) => {
      const cl = (c.res as Extract<typeof c.res, { ok: true }>).classification;
      return {
        workspace_id: workspaceId,
        source_url: c.post.url,
        source_subreddit: c.post.subreddit,
        source_author: c.post.author,
        source_title: c.post.title,
        source_body: c.post.body,
        source_score: c.post.score,
        source_num_comments: c.post.num_comments,
        confidence: cl.confidence,
        symptom: cl.symptom || c.post.title,
        ai_tool: cl.aiTool,
        ai_claimed_cause: cl.aiClaimedCause,
        action_taken: cl.actionTaken,
        cost_amount: cl.costAmount,
        cost_currency: cl.costCurrency ?? "USD",
        actual_cause: cl.actualCause,
        outcome: cl.outcome,
        status: "new" as const,
        model: (c.res as Extract<typeof c.res, { ok: true }>).model,
        first_seen_at: nowIso,
      };
    });

  if (payload.length === 0) {
    return {
      ...base,
      ok: true,
      screened: toClassify.length,
      skippedOwn,
      skippedCapped,
      found: 0,
      candidates: [],
    };
  }

  const { data: upserted, error } = await supabase
    .from("forum_gap_candidates")
    .upsert(payload, { onConflict: "workspace_id,source_url" })
    .select("*");
  if (error) {
    return { ...base, reason: error.message, screened: toClassify.length, skippedOwn, skippedCapped };
  }

  return {
    ok: true,
    received: posts.length,
    screened: toClassify.length,
    skippedOwn,
    skippedCapped,
    found: (upserted ?? []).length,
    candidates: (upserted ?? []) as unknown as GapCandidate[],
  };
}

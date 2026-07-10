// Reddit reads via Apify — the fallback for when the OAuth API isn't available
// (Reddit gates its Data API behind the dev-builder program, and the anonymous
// .json endpoints 403 from datacenter IPs like Vercel). Apify runs the scrape
// from residential/rotating IPs Reddit doesn't block, using the existing
// APIFY_TOKEN (SCALE plan). Powers "Find posts to answer", loading a pasted
// post, and traction reads when OAuth is off.
//
// Actor: trudax/reddit-scraper-lite (run-sync-get-dataset-items). Post items
// look like: { id: "t3_..", parsedId, url, username, title, body, html,
// communityName: "r/X", createdAt, dataType: "post", + upVotes/numberOfComments
// when includeMediaLinks is on }.

import type { RedditPost, RedditTraction, RedditComment } from "./reddit";

const ACTOR = "trudax~reddit-scraper-lite";

export function isApifyConfigured(): boolean {
  return Boolean(process.env.APIFY_TOKEN);
}

interface ApifyPostItem {
  id?: string;
  parsedId?: string;
  url?: string;
  username?: string;
  title?: string;
  body?: string;
  communityName?: string;
  createdAt?: string;
  upVotes?: number;
  numberOfComments?: number;
  dataType?: string;
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

function toRedditPost(item: ApifyPostItem): RedditPost | null {
  const parsedId = item.parsedId || (item.id?.replace(/^t3_/, "") ?? "");
  if (!parsedId) return null;
  const created = item.createdAt ? Date.parse(item.createdAt) : NaN;
  return {
    fullname: item.id?.startsWith("t3_") ? item.id : `t3_${parsedId}`,
    id: parsedId,
    subreddit: (item.communityName ?? "").replace(/^\/?r\//i, ""),
    title: item.title ?? "",
    body: item.body ?? "",
    author: item.username ?? null,
    url: item.url ?? "",
    score: num(item.upVotes),
    num_comments: num(item.numberOfComments),
    created_utc: Number.isNaN(created) ? null : Math.floor(created / 1000),
  };
}

// Outcome of an actor run. `failed` distinguishes a real error (timeout, HTTP
// error, network) from a successful-but-empty scrape — callers that surface a
// message to the user must NOT report a timeout as "no posts found".
export interface ActorResult {
  items: ApifyPostItem[];
  failed: boolean;
  timedOut: boolean;
}

// Run the actor synchronously and return its dataset items. Bounded by a
// server-side actor timeout + a client abort so a slow scrape can't hang the
// request. Never throws.
//
// The actor cold-starts often and a multi-subreddit scrape can take ~200s, well
// past the old 90s cap — which surfaced to users as a permanent "no posts
// found". The window is now sized to cover a cold run (Apify's run-sync endpoint
// itself hard-caps at 300s; the callers' routes use maxDuration: 300).
async function runActor(
  input: Record<string, unknown>,
  { serverTimeout = 230, clientTimeout = 290_000 } = {},
): Promise<ActorResult> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return { items: [], failed: true, timedOut: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), clientTimeout);
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=${serverTimeout}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proxy: { useApifyProxy: true }, ...input }),
        signal: controller.signal,
        cache: "no-store",
      },
    );
    if (!res.ok) {
      // Apify returns 400/408 with a "TIMED-OUT" run status when the actor
      // exceeds the server timeout — treat that specifically as a timeout.
      const text = await res.text().catch(() => "");
      const timedOut = res.status === 408 || /TIMED-?OUT/i.test(text);
      return { items: [], failed: true, timedOut };
    }
    const data = (await res.json()) as ApifyPostItem[];
    return { items: Array.isArray(data) ? data : [], failed: false, timedOut: false };
  } catch (err) {
    // AbortError = our client-side timeout fired; anything else is a network error.
    const timedOut = err instanceof Error && err.name === "AbortError";
    return { items: [], failed: true, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

// Build the listing / search start URLs for a set of subreddits.
function startUrls(subs: string[], query: string | undefined, sort: string): { url: string }[] {
  return subs.map((sub) => {
    if (query) {
      const p = new URLSearchParams({
        q: query,
        restrict_sr: "1",
        sort: sort === "hot" || sort === "top" || sort === "relevance" ? sort : "new",
        t: "month",
      });
      return { url: `https://www.reddit.com/r/${sub}/search/?${p}` };
    }
    const listing = sort === "hot" ? "hot" : sort === "top" ? "top" : "new";
    return { url: `https://www.reddit.com/r/${sub}/${listing}/` };
  });
}

// Search/browse posts across subreddits. `subreddits` are bare names. Returns
// the failure signal so the caller can tell "scrape timed out" apart from
// "genuinely no matching posts".
//
// One Apify run per subreddit, fired in parallel — NOT a single run with all
// the start URLs. The actor processes multiple start URLs serially, so a
// 5-subreddit run routinely blew past even a 230s timeout; splitting makes each
// run small (and likely to finish) and the wall-clock the slowest single
// subreddit (~60-90s) instead of the sum. Results merge with partial success:
// a slow/failed subreddit no longer sinks the whole search, and we only report
// failure when EVERY subreddit failed.
export async function apifySearchRedditPosts(opts: {
  subreddits: string[];
  query?: string;
  sort?: string;
  limit?: number;
}): Promise<{ posts: RedditPost[]; failed: boolean; timedOut: boolean }> {
  const subs = opts.subreddits.map((s) => s.replace(/^\/?r\//i, "").trim()).filter(Boolean);
  if (subs.length === 0) return { posts: [], failed: false, timedOut: false };
  const totalLimit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const perSub = Math.max(Math.ceil(totalLimit / subs.length), 3);
  const query = opts.query?.trim() || undefined;
  const sort = opts.sort ?? "new";

  // Cap each run at 180s: the runs are awaited together, so the whole search
  // can only be as fast as its slowest subreddit. A warm/normal subreddit
  // returns in ~75-130s (measured), so 180s captures those while cutting a cold
  // straggler loose early — partial results still include every fast subreddit.
  const results = await Promise.all(
    subs.map((sub) =>
      runActor(
        {
          startUrls: startUrls([sub], query, sort),
          skipComments: true,
          skipUserPosts: true,
          skipCommunity: true,
          includeMediaLinks: true, // brings upVotes + numberOfComments
          maxItems: perSub,
          maxPostCount: perSub,
        },
        { serverTimeout: 180, clientTimeout: 190_000 },
      ),
    ),
  );

  // Merge + de-dupe by post id across subreddits.
  const seen = new Set<string>();
  const posts: RedditPost[] = [];
  for (const r of results) {
    for (const item of r.items) {
      if ((item.dataType ?? "post") !== "post") continue;
      const post = toRedditPost(item);
      if (!post || seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
  }
  posts.sort((a, b) => (b.created_utc ?? 0) - (a.created_utc ?? 0));

  // Only a failure if nothing came back AND every subreddit's run failed.
  const failed = posts.length === 0 && results.every((r) => r.failed);
  const timedOut = failed && results.some((r) => r.timedOut);
  return { posts: posts.slice(0, totalLimit), failed, timedOut };
}

// ── Async search (start + poll) ───────────────────────────────────────────
// The synchronous fan-out above still makes the user stare at a spinner for the
// length of the slowest cold subreddit (~200s) with no feedback, and a fully
// cold start can blow the per-run cap and return nothing. The answer-posts UI
// instead STARTS the runs (returns immediately with run handles) and POLLS,
// streaming each subreddit's posts in as its run finishes and showing live
// progress. Each poll call is fast, so it isn't bound by a function timeout.

// A started actor run for one subreddit.
export interface ApifySearchRun {
  sub: string;
  runId: string;
  datasetId: string;
}

// Snapshot of an in-flight (or finished) async search.
export interface ApifySearchProgress {
  done: boolean; // every run reached a terminal state
  posts: RedditPost[]; // merged + de-duped across all finished runs
  perSub: { sub: string; status: RunStatus }[];
}

type RunStatus = "pending" | "running" | "succeeded" | "failed";

const TERMINAL = /^(SUCCEEDED|FAILED|TIMED-OUT|TIMED_OUT|ABORTED)$/i;

// Kick off one async actor run per subreddit. Returns a handle per successfully
// started run (bare names, deduped). Never throws — a subreddit whose run fails
// to start is simply omitted; `failed` is true only when NONE started.
export async function startApifySearchRuns(opts: {
  subreddits: string[];
  query?: string;
  sort?: string;
  limit?: number;
}): Promise<{ runs: ApifySearchRun[]; failed: boolean }> {
  const token = process.env.APIFY_TOKEN;
  const subs = opts.subreddits.map((s) => s.replace(/^\/?r\//i, "").trim()).filter(Boolean);
  if (!token || subs.length === 0) return { runs: [], failed: !token };
  const totalLimit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const perSub = Math.max(Math.ceil(totalLimit / subs.length), 3);
  const query = opts.query?.trim() || undefined;
  const sort = opts.sort ?? "new";

  const started = await Promise.all(
    subs.map(async (sub): Promise<ApifySearchRun | null> => {
      try {
        const res = await fetch(
          `https://api.apify.com/v2/acts/${ACTOR}/runs?token=${token}&timeout=230`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              proxy: { useApifyProxy: true },
              startUrls: startUrls([sub], query, sort),
              skipComments: true,
              skipUserPosts: true,
              skipCommunity: true,
              includeMediaLinks: true,
              maxItems: perSub,
              maxPostCount: perSub,
            }),
            cache: "no-store",
          },
        );
        if (!res.ok) return null;
        const data = (await res.json()) as {
          data?: { id?: string; defaultDatasetId?: string };
        };
        const runId = data.data?.id;
        const datasetId = data.data?.defaultDatasetId;
        if (!runId || !datasetId) return null;
        return { sub, runId, datasetId };
      } catch {
        return null;
      }
    }),
  );

  const runs = started.filter((r): r is ApifySearchRun => r !== null);
  return { runs, failed: runs.length === 0 };
}

// Poll a set of started runs. Fetches items from finished runs, merges +
// de-dupes, and reports per-subreddit status. Never throws.
export async function pollApifySearchRuns(
  runs: ApifySearchRun[],
  limit = 25,
): Promise<ApifySearchProgress> {
  const token = process.env.APIFY_TOKEN;
  if (!token || runs.length === 0) {
    return { done: true, posts: [], perSub: runs.map((r) => ({ sub: r.sub, status: "failed" })) };
  }
  const totalLimit = Math.min(Math.max(limit, 1), 100);

  const perRun = await Promise.all(
    runs.map(async (run) => {
      try {
        const res = await fetch(
          `https://api.apify.com/v2/actor-runs/${run.runId}?token=${token}`,
          { cache: "no-store" },
        );
        if (!res.ok) return { run, status: "running" as RunStatus, items: [] as ApifyPostItem[] };
        const data = (await res.json()) as { data?: { status?: string } };
        const raw = data.data?.status ?? "";
        if (!TERMINAL.test(raw)) {
          return { run, status: "running" as RunStatus, items: [] as ApifyPostItem[] };
        }
        if (!/^SUCCEEDED$/i.test(raw)) {
          return { run, status: "failed" as RunStatus, items: [] as ApifyPostItem[] };
        }
        // Succeeded → pull the dataset items.
        const itemsRes = await fetch(
          `https://api.apify.com/v2/datasets/${run.datasetId}/items?token=${token}&clean=true`,
          { cache: "no-store" },
        );
        const items = itemsRes.ok ? ((await itemsRes.json()) as ApifyPostItem[]) : [];
        return {
          run,
          status: "succeeded" as RunStatus,
          items: Array.isArray(items) ? items : [],
        };
      } catch {
        return { run, status: "running" as RunStatus, items: [] as ApifyPostItem[] };
      }
    }),
  );

  const seen = new Set<string>();
  const posts: RedditPost[] = [];
  for (const r of perRun) {
    for (const item of r.items) {
      if ((item.dataType ?? "post") !== "post") continue;
      const post = toRedditPost(item);
      if (!post || seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
  }
  posts.sort((a, b) => (b.created_utc ?? 0) - (a.created_utc ?? 0));

  return {
    done: perRun.every((r) => r.status === "succeeded" || r.status === "failed"),
    posts: posts.slice(0, totalLimit),
    perSub: perRun.map((r) => ({ sub: r.run.sub, status: r.status })),
  };
}

// Load a single post by URL.
export async function apifyFetchRedditPost(postUrl: string): Promise<RedditPost | null> {
  const { items } = await runActor({
    startUrls: [{ url: postUrl }],
    skipComments: true,
    skipUserPosts: true,
    skipCommunity: true,
    includeMediaLinks: true,
    maxItems: 1,
    maxPostCount: 1,
  });
  const post = items.map(toRedditPost).find((p): p is RedditPost => p !== null);
  return post ?? null;
}

// Commenters on a posted URL — for contribution tracking. Runs the actor with
// comments ON and returns each comment's author + permalink (bare handles, no
// "u/"). Used to detect which of our roster accounts actually replied on the
// thread. Never throws — returns [] on failure.
export async function apifyFetchRedditCommenters(
  postUrl: string,
  maxComments = 300,
): Promise<{ author: string; permalink: string | null }[]> {
  const { items } = await runActor({
    startUrls: [{ url: postUrl }],
    skipComments: false,
    skipUserPosts: true,
    skipCommunity: true,
    includeMediaLinks: false,
    maxComments,
    maxItems: maxComments + 5,
  });
  const out: { author: string; permalink: string | null }[] = [];
  for (const it of items) {
    if ((it.dataType ?? "") !== "comment") continue;
    const author = (it.username ?? "").replace(/^\/?u\//i, "").trim();
    if (!author || author === "[deleted]") continue;
    out.push({ author, permalink: it.url ?? null });
  }
  return out;
}

// Full comments on a posted URL, WITH their text — for the thread analyzer that
// picks which comments are worth replying to. Same actor run as the commenter
// scan but we keep body/score/permalink instead of flattening to author only.
// Returns them in the order the actor emits them (roughly top-of-thread first).
// Never throws — returns [] on failure.
export async function apifyFetchRedditComments(
  postUrl: string,
  maxComments = 200,
): Promise<RedditComment[]> {
  const { items } = await runActor({
    startUrls: [{ url: postUrl }],
    skipComments: false,
    skipUserPosts: true,
    skipCommunity: true,
    includeMediaLinks: false,
    maxComments,
    maxItems: maxComments + 5,
  });
  const out: RedditComment[] = [];
  for (const it of items) {
    if ((it.dataType ?? "") !== "comment") continue;
    const author = (it.username ?? "").replace(/^\/?u\//i, "").trim();
    const body = (it.body ?? "").trim();
    if (!body || body === "[deleted]" || body === "[removed]") continue;
    const id = it.parsedId || (it.id?.replace(/^t1_/, "") ?? "");
    out.push({
      id,
      author: author || null,
      body,
      permalink: it.url ?? null,
      score: num(it.upVotes),
      depth: 0,
    });
  }
  return out;
}

// Traction (score + comments) for a posted URL.
export async function apifyFetchRedditTraction(postUrl: string): Promise<RedditTraction | null> {
  const post = await apifyFetchRedditPost(postUrl);
  if (!post) return null;
  return {
    score: post.score,
    num_comments: post.num_comments,
    upvote_ratio: null,
    author: post.author,
  };
}

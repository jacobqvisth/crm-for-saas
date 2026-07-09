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

import type { RedditPost, RedditTraction } from "./reddit";

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

// Run the actor synchronously and return its dataset items. Bounded by a
// server-side actor timeout + a client abort so a slow scrape can't hang the
// request. Never throws — returns [] on any failure.
async function runActor(
  input: Record<string, unknown>,
  { serverTimeout = 90, clientTimeout = 100_000 } = {},
): Promise<ApifyPostItem[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return [];
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
    if (!res.ok) return [];
    const data = (await res.json()) as ApifyPostItem[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
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

// Search/browse posts across subreddits. `subreddits` are bare names.
export async function apifySearchRedditPosts(opts: {
  subreddits: string[];
  query?: string;
  sort?: string;
  limit?: number;
}): Promise<RedditPost[]> {
  const subs = opts.subreddits.map((s) => s.replace(/^\/?r\//i, "").trim()).filter(Boolean);
  if (subs.length === 0) return [];
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const items = await runActor({
    startUrls: startUrls(subs, opts.query?.trim() || undefined, opts.sort ?? "new"),
    skipComments: true,
    skipUserPosts: true,
    skipCommunity: true,
    includeMediaLinks: true, // brings upVotes + numberOfComments
    maxItems: limit,
    maxPostCount: limit,
  });
  return items
    .filter((i) => (i.dataType ?? "post") === "post")
    .map(toRedditPost)
    .filter((p): p is RedditPost => p !== null);
}

// Load a single post by URL.
export async function apifyFetchRedditPost(postUrl: string): Promise<RedditPost | null> {
  const items = await runActor({
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

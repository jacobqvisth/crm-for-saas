// Reddit reads — shared by the Distribution board and the post generator so
// both can find posts and show live upvotes/comments.
//
// We do NOT use Reddit's official (OAuth) API. Reads go through Apify, which
// scrapes from residential/rotating IPs Reddit doesn't block, using the
// existing APIFY_TOKEN. See ./reddit-apify.ts.
//
// A keyless anonymous public-JSON fetch (append `.json` to the permalink) is
// kept only as a best-effort last resort; it 403s from datacenter IPs like
// Vercel, so it effectively only helps in local dev. When everything fails the
// caller records the reason and the user can enter the numbers / paste the text
// by hand. Nothing here throws.

import {
  isApifyConfigured,
  apifySearchRedditPosts,
  apifyFetchRedditPost,
  apifyFetchRedditTraction,
  apifyFetchRedditCommenters,
  apifyFetchRedditComments,
} from "./reddit-apify";

const UA = "web:wrenchlane-crm:1.0 (forum traction tracker)";

export interface RedditTraction {
  score: number | null;
  num_comments: number | null;
  upvote_ratio: number | null;
  // The post's author handle (no "u/"). Lets the Distribution board record which
  // Reddit user actually posted a placement, cross-checked against the roster.
  author: string | null;
}

// Extract the base-36 post id from a Reddit permalink → "t3_<id>" fullname.
export function redditFullname(postUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(postUrl.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === "redd.it") {
    const id = u.pathname.replace(/\/+/g, "");
    return id ? `t3_${id}` : null;
  }
  if (!/(^|\.)reddit\.com$/.test(host)) return null;
  const m = u.pathname.match(/\/comments\/([a-z0-9]+)/i);
  return m ? `t3_${m[1]}` : null;
}

// Turn a Reddit post URL into its anonymous `.json` endpoint. Returns null for
// anything that doesn't look like a Reddit comments permalink.
export function redditJsonUrl(postUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(postUrl.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!/(^|\.)reddit\.com$/.test(host) && host !== "redd.it") return null;
  if (host !== "redd.it" && !/\/comments\//i.test(u.pathname)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return `https://www.reddit.com${path}.json?raw_json=1`;
}

// True when live Reddit reads are available. We read via Apify (residential
// IPs), so this is just "is the Apify token set". The UI uses it to decide
// between the live "find posts" flow and the paste-a-URL / paste-the-text
// fallback.
export function isRedditConfigured(): boolean {
  return isApifyConfigured();
}

// A candidate post to reply to, as returned by discovery/fetch.
export interface RedditPost {
  fullname: string; // t3_<id>
  id: string;
  subreddit: string; // e.g. "MechanicAdvice"
  title: string;
  body: string; // selftext, may be ""
  author: string | null;
  url: string; // full permalink on reddit.com
  score: number | null;
  num_comments: number | null;
  created_utc: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function toRedditPost(data: Record<string, unknown> | undefined): RedditPost | null {
  if (!data) return null;
  const id = str(data.id);
  const permalink = str(data.permalink);
  if (!id) return null;
  return {
    fullname: `t3_${id}`,
    id,
    subreddit: str(data.subreddit),
    title: str(data.title),
    body: str(data.selftext),
    author: typeof data.author === "string" ? data.author : null,
    url: permalink ? `https://www.reddit.com${permalink}` : str(data.url),
    score: num(data.score) ?? num(data.ups),
    num_comments: num(data.num_comments),
    created_utc: num(data.created_utc),
  };
}

function parsePostData(postData: Record<string, unknown> | undefined): RedditTraction | null {
  if (!postData) return null;
  return {
    score: num(postData.score) ?? num(postData.ups),
    num_comments: num(postData.num_comments),
    upvote_ratio: num(postData.upvote_ratio),
    author: typeof postData.author === "string" ? postData.author : null,
  };
}

// Fetch traction for one posted URL. Never throws — returns an { ok, ... } shape
// so the caller can record a per-row note without failing the whole refresh.
export async function fetchRedditTraction(
  postUrl: string,
): Promise<{ ok: true; traction: RedditTraction } | { ok: false; reason: string }> {
  const fullname = redditFullname(postUrl);
  if (!fullname) return { ok: false, reason: "Not a recognizable Reddit post URL" };

  // 1. Apify scrape (residential IPs) — our only live read path.
  if (isApifyConfigured()) {
    const traction = await apifyFetchRedditTraction(postUrl);
    if (traction && (traction.score !== null || traction.num_comments !== null)) {
      return { ok: true, traction };
    }
  }

  // 2. Anonymous public JSON fallback (keyless; 403s from datacenter IPs).
  const jsonUrl = redditJsonUrl(postUrl);
  if (!jsonUrl) return { ok: false, reason: "Not a recognizable Reddit post URL" };
  let res: Response;
  try {
    res = await fetch(jsonUrl, { headers: { "User-Agent": UA }, cache: "no-store" });
  } catch {
    return { ok: false, reason: "Could not reach Reddit" };
  }
  if (res.status === 403) {
    return {
      ok: false,
      reason: isApifyConfigured()
        ? "Couldn't pull the numbers from Reddit this time — hit Refresh again in a minute, or enter them manually"
        : "Reddit reads aren't set up (no APIFY_TOKEN) — enter the numbers manually",
    };
  }
  if (res.status === 429) return { ok: false, reason: "Rate-limited by Reddit — try again shortly" };
  if (!res.ok) return { ok: false, reason: `Reddit returned ${res.status}` };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: "Unexpected response from Reddit" };
  }
  const listing = Array.isArray(json) ? json[0] : json;
  const postData = (listing as {
    data?: { children?: Array<{ data?: Record<string, unknown> }> };
  })?.data?.children?.[0]?.data;
  const traction = parsePostData(postData);
  if (!traction) return { ok: false, reason: "No post data found (deleted or private?)" };
  return { ok: true, traction };
}

// Fetch one post's full content (title + body) so we can draft a reply to it.
// Apify first, keyless anon JSON fallback. Never throws.
export async function fetchRedditPost(
  postUrl: string,
): Promise<{ ok: true; post: RedditPost } | { ok: false; reason: string }> {
  const fullname = redditFullname(postUrl);
  if (!fullname) return { ok: false, reason: "Not a recognizable Reddit post URL" };

  // Apify scrape (residential IPs) — preferred over anon JSON, which 403s.
  if (isApifyConfigured()) {
    const post = await apifyFetchRedditPost(postUrl);
    if (post) return { ok: true, post };
  }

  const jsonUrl = redditJsonUrl(postUrl);
  if (!jsonUrl) return { ok: false, reason: "Not a recognizable Reddit post URL" };
  let res: Response;
  try {
    res = await fetch(jsonUrl, { headers: { "User-Agent": UA }, cache: "no-store" });
  } catch {
    return { ok: false, reason: "Could not reach Reddit" };
  }
  if (res.status === 403) {
    return {
      ok: false,
      reason: isApifyConfigured()
        ? "Couldn't auto-load the post this time — try again in a moment, or paste the post text below manually"
        : "Reddit reads aren't set up (no APIFY_TOKEN) — paste the post text below manually",
    };
  }
  if (res.status === 429) return { ok: false, reason: "Rate-limited by Reddit — try again shortly" };
  if (!res.ok) return { ok: false, reason: `Reddit returned ${res.status}` };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: "Unexpected response from Reddit" };
  }
  const listing = Array.isArray(json) ? json[0] : json;
  const post = toRedditPost(
    (listing as { data?: { children?: Array<{ data?: Record<string, unknown> }> } })?.data
      ?.children?.[0]?.data,
  );
  if (!post) return { ok: false, reason: "No post data found (deleted or private?)" };
  return { ok: true, post };
}

// A commenter on a thread — used to detect which roster accounts replied.
export interface RedditCommenter {
  author: string; // bare handle, no "u/"
  permalink: string | null; // full URL to the comment, when known
}

// A single comment WITH its text — for the thread analyzer that decides which
// comments are worth replying to. `depth` is 0 for top-level (unknown = 0).
export interface RedditComment {
  id: string; // base-36 comment id, no "t1_"
  author: string | null; // bare handle, no "u/"
  body: string;
  permalink: string | null; // full URL to the comment
  score: number | null;
  depth: number;
}

// Recursively collect comment authors + permalinks from a Reddit comments
// listing (the t1 tree returned by the anon .json). Used by the anon fallback.
function collectCommenters(
  listing: unknown,
  out: RedditCommenter[],
  depth = 0,
): void {
  if (depth > 12 || out.length > 500) return;
  const children = (listing as { data?: { children?: unknown[] } })?.data?.children;
  if (!Array.isArray(children)) return;
  for (const child of children) {
    const c = child as { kind?: string; data?: Record<string, unknown> };
    if (c.kind !== "t1" || !c.data) continue;
    const author = typeof c.data.author === "string" ? c.data.author.replace(/^\/?u\//i, "") : "";
    if (author && author !== "[deleted]") {
      const permalink = typeof c.data.permalink === "string" ? c.data.permalink : null;
      out.push({
        author,
        permalink: permalink ? `https://www.reddit.com${permalink}` : null,
      });
    }
    if (c.data.replies && typeof c.data.replies === "object") {
      collectCommenters(c.data.replies, out, depth + 1);
    }
  }
}

// Fetch the commenters on a posted thread so we can match them against the
// roster's Reddit handles (contribution tracking). Apify first (our configured
// path), keyless anonymous .json fallback. Never throws.
export async function fetchRedditCommenters(
  postUrl: string,
): Promise<{ ok: true; commenters: RedditCommenter[] } | { ok: false; reason: string }> {
  const fullname = redditFullname(postUrl);
  if (!fullname) return { ok: false, reason: "Not a recognizable Reddit post URL" };

  // 1. Apify (residential IPs). Treat its result as authoritative when
  //    configured — an empty list just means none of our handles commented.
  if (isApifyConfigured()) {
    const commenters = await apifyFetchRedditCommenters(postUrl);
    return { ok: true, commenters };
  }

  // 2. Anonymous .json (keyless; often 403s from datacenter IPs).
  const jsonUrl = redditJsonUrl(postUrl);
  if (jsonUrl) {
    try {
      const res = await fetch(jsonUrl, { headers: { "User-Agent": UA }, cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as unknown[];
        const out: RedditCommenter[] = [];
        collectCommenters(Array.isArray(json) ? json[1] : undefined, out);
        return { ok: true, commenters: out };
      }
      if (res.status === 403) {
        return { ok: false, reason: "Reddit reads aren't set up (no APIFY_TOKEN) — can't auto-detect commenters" };
      }
    } catch {
      // fall through
    }
  }

  return { ok: false, reason: "Could not read Reddit comments" };
}

// Recursively collect comments WITH their bodies from a Reddit comments listing
// (the t1 tree). Unlike collectCommenters this keeps text/score/permalink so the
// thread can be analyzed. Skips deleted/removed and "more" stubs.
function collectComments(listing: unknown, out: RedditComment[], depth = 0): void {
  if (depth > 12 || out.length > 500) return;
  const children = (listing as { data?: { children?: unknown[] } })?.data?.children;
  if (!Array.isArray(children)) return;
  for (const child of children) {
    const c = child as { kind?: string; data?: Record<string, unknown> };
    if (c.kind !== "t1" || !c.data) continue;
    const author =
      typeof c.data.author === "string" ? c.data.author.replace(/^\/?u\//i, "") : "";
    const body = typeof c.data.body === "string" ? c.data.body.trim() : "";
    if (body && body !== "[deleted]" && body !== "[removed]") {
      const permalink = typeof c.data.permalink === "string" ? c.data.permalink : null;
      out.push({
        id: typeof c.data.id === "string" ? c.data.id : "",
        author: author && author !== "[deleted]" ? author : null,
        body,
        permalink: permalink ? `https://www.reddit.com${permalink}` : null,
        score: num(c.data.score) ?? num(c.data.ups),
        depth,
      });
    }
    if (c.data.replies && typeof c.data.replies === "object") {
      collectComments(c.data.replies, out, depth + 1);
    }
  }
}

// Fetch a thread's comments WITH their text so the analyzer can pick which ones
// are worth replying to. Apify first (our configured path), keyless anonymous
// .json fallback. Never throws.
export async function fetchRedditThreadComments(
  postUrl: string,
): Promise<{ ok: true; comments: RedditComment[] } | { ok: false; reason: string }> {
  const fullname = redditFullname(postUrl);
  if (!fullname) return { ok: false, reason: "Not a recognizable Reddit post URL" };

  // 1. Apify (residential IPs) — authoritative when configured. An empty list
  //    just means a genuinely comment-less thread.
  if (isApifyConfigured()) {
    const comments = await apifyFetchRedditComments(postUrl);
    return { ok: true, comments };
  }

  // 2. Anonymous .json (keyless; often 403s from datacenter IPs).
  const jsonUrl = redditJsonUrl(postUrl);
  if (jsonUrl) {
    try {
      const res = await fetch(jsonUrl, { headers: { "User-Agent": UA }, cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as unknown[];
        const out: RedditComment[] = [];
        collectComments(Array.isArray(json) ? json[1] : undefined, out);
        return { ok: true, comments: out };
      }
      if (res.status === 403) {
        return {
          ok: false,
          reason: "Reddit reads aren't set up (no APIFY_TOKEN) — can't read the thread",
        };
      }
    } catch {
      // fall through
    }
  }

  return { ok: false, reason: "Could not read Reddit comments" };
}

// Search/list candidate posts across one or more subreddits, via Apify. Returns
// a clear reason when Apify isn't configured — the UI then falls back to the
// paste-a-URL flow.
export async function searchRedditPosts(opts: {
  subreddits: string[]; // bare names, e.g. ["MechanicAdvice"]
  query?: string;
  sort?: "new" | "hot" | "relevance" | "top";
  limit?: number;
}): Promise<{ ok: true; posts: RedditPost[] } | { ok: false; reason: string }> {
  const subs = opts.subreddits
    .map((s) => s.replace(/^\/?r\//i, "").trim())
    .filter(Boolean);
  if (subs.length === 0) return { ok: false, reason: "No subreddits selected" };

  if (!isApifyConfigured()) {
    return {
      ok: false,
      reason:
        "Reddit reads aren't set up (no APIFY_TOKEN) — finding posts is off. You can still paste a post URL below.",
    };
  }

  const { posts, failed, timedOut } = await apifySearchRedditPosts({
    subreddits: subs,
    query: opts.query,
    sort: opts.sort,
    limit: opts.limit,
  });
  // Don't pass a timeout/error off as "no posts found" — the actor cold-starts
  // and can be slow, so a clear retry message matters.
  if (failed) {
    return {
      ok: false,
      reason: timedOut
        ? "Reddit search timed out — the scraper was still warming up. Try again in a moment."
        : "Couldn't reach the Reddit scraper. Try again shortly.",
    };
  }
  return { ok: true, posts };
}

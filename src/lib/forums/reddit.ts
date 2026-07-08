// Reddit traction fetch — shared by the Distribution board and the post
// generator so both can show live upvotes/comments for anything posted.
//
// Two paths, tried in order:
//   1. OAuth (preferred, works from server/datacenter IPs). If REDDIT_CLIENT_ID
//      and REDDIT_CLIENT_SECRET are set we get an app-only token and read the
//      post via https://oauth.reddit.com/api/info. Create a "script" app at
//      https://www.reddit.com/prefs/apps to get the id+secret.
//   2. Anonymous public JSON (append `.json` to the permalink). Needs no creds
//      but Reddit now 403s this from datacenter IPs (incl. Vercel), so it's a
//      best-effort fallback only.
//
// When both fail the caller records the reason and the user can still enter the
// numbers by hand. Nothing here throws.

const UA = "web:wrenchlane-crm:1.0 (forum traction tracker)";

export interface RedditTraction {
  score: number | null;
  num_comments: number | null;
  upvote_ratio: number | null;
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

// Cache the app-only token in module scope for its lifetime.
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  try {
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return tokenCache.token;
  } catch {
    return null;
  }
}

// True when app-only OAuth creds are present. Search + auto-fetch of post
// bodies both need OAuth (anon JSON 403s from datacenter IPs), so the UI uses
// this to decide between the live "find posts" flow and the paste-a-URL /
// paste-the-text fallback.
export function isRedditConfigured(): boolean {
  return !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
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
  };
}

// Fetch traction for one posted URL. Never throws — returns an { ok, ... } shape
// so the caller can record a per-row note without failing the whole refresh.
export async function fetchRedditTraction(
  postUrl: string,
): Promise<{ ok: true; traction: RedditTraction } | { ok: false; reason: string }> {
  const fullname = redditFullname(postUrl);
  if (!fullname) return { ok: false, reason: "Not a recognizable Reddit post URL" };

  // 1. OAuth path (works from server IPs when creds are configured).
  const token = await getAppToken();
  if (token) {
    try {
      const res = await fetch(
        `https://oauth.reddit.com/api/info?id=${fullname}&raw_json=1`,
        {
          headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
          cache: "no-store",
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          data?: { children?: Array<{ data?: Record<string, unknown> }> };
        };
        const traction = parsePostData(data?.data?.children?.[0]?.data);
        if (traction) return { ok: true, traction };
        return { ok: false, reason: "Post not found (deleted or private?)" };
      }
      // fall through to anonymous on non-OK
    } catch {
      // fall through
    }
  }

  // 2. Anonymous public JSON fallback (often 403s from datacenter IPs).
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
      reason: token
        ? "Reddit blocked the request (403)"
        : "Reddit blocked the request (403) — add Reddit API keys for reliable auto-tracking, or enter numbers manually",
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
// OAuth first, anon JSON fallback. Never throws.
export async function fetchRedditPost(
  postUrl: string,
): Promise<{ ok: true; post: RedditPost } | { ok: false; reason: string }> {
  const fullname = redditFullname(postUrl);
  if (!fullname) return { ok: false, reason: "Not a recognizable Reddit post URL" };

  const token = await getAppToken();
  if (token) {
    try {
      const res = await fetch(
        `https://oauth.reddit.com/api/info?id=${fullname}&raw_json=1`,
        {
          headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
          cache: "no-store",
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          data?: { children?: Array<{ data?: Record<string, unknown> }> };
        };
        const post = toRedditPost(data?.data?.children?.[0]?.data);
        if (post) return { ok: true, post };
        return { ok: false, reason: "Post not found (deleted or private?)" };
      }
    } catch {
      // fall through to anon
    }
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
      reason:
        "Reddit blocked the request (403) — add Reddit API keys to auto-load posts, or paste the post text below manually",
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

// Search/list candidate posts across one or more subreddits. Needs OAuth
// (Reddit blocks anon listing from datacenter IPs), so returns a clear reason
// when creds aren't set — the UI then falls back to the paste-a-URL flow.
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

  const token = await getAppToken();
  if (!token) {
    return {
      ok: false,
      reason:
        "Reddit API not configured — add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET to enable finding posts. You can still paste a post URL below.",
    };
  }

  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const path = subs.join("+");
  const query = opts.query?.trim();
  let endpoint: string;
  if (query) {
    const sort = opts.sort && opts.sort !== "hot" ? opts.sort : "new";
    const params = new URLSearchParams({
      q: query,
      restrict_sr: "true",
      sort,
      t: "month",
      limit: String(limit),
      raw_json: "1",
    });
    endpoint = `https://oauth.reddit.com/r/${path}/search?${params}`;
  } else {
    const sort = opts.sort === "hot" ? "hot" : "new";
    endpoint = `https://oauth.reddit.com/r/${path}/${sort}?limit=${limit}&raw_json=1`;
  }

  try {
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
      cache: "no-store",
    });
    if (res.status === 429) return { ok: false, reason: "Rate-limited by Reddit — try again shortly" };
    if (!res.ok) return { ok: false, reason: `Reddit returned ${res.status}` };
    const data = (await res.json()) as {
      data?: { children?: Array<{ data?: Record<string, unknown> }> };
    };
    const posts = (data?.data?.children ?? [])
      .map((c) => toRedditPost(c?.data))
      .filter((p): p is RedditPost => p !== null);
    return { ok: true, posts };
  } catch (err) {
    return {
      ok: false,
      reason: `Could not reach Reddit: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

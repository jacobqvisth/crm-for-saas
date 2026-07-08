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

// --- Posting -------------------------------------------------------------
// Submitting a post needs a *user* token, not the app-only token above. A
// "script" app (https://www.reddit.com/prefs/apps) authenticates with the
// resource-owner password grant: the owning account's username + password
// plus the app's client id/secret. Posts appear as that account. This is the
// sanctioned path — unlike browser automation it never trips Reddit's bot
// challenge. Requires REDDIT_CLIENT_ID/SECRET + REDDIT_USERNAME/PASSWORD.

let userTokenCache: { token: string; expiresAt: number } | null = null;

async function getUserToken(): Promise<string | null> {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  const username = process.env.REDDIT_USERNAME;
  const password = process.env.REDDIT_PASSWORD;
  if (!id || !secret || !username || !password) return null;

  if (userTokenCache && userTokenCache.expiresAt > Date.now() + 60_000) {
    return userTokenCache.token;
  }

  try {
    const basic = Buffer.from(`${id}:${secret}`).toString("base64");
    const body = new URLSearchParams({ grant_type: "password", username, password });
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
      },
      body: body.toString(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    userTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return userTokenCache.token;
  } catch {
    return null;
  }
}

// Whether posting is configured at all — lets the API/UI show a helpful message
// instead of a generic failure when the keys are missing.
export function redditPostingConfigured(): boolean {
  return Boolean(
    process.env.REDDIT_CLIENT_ID &&
      process.env.REDDIT_CLIENT_SECRET &&
      process.env.REDDIT_USERNAME &&
      process.env.REDDIT_PASSWORD,
  );
}

// Submit a self (text) post to a subreddit. `subreddit` is the bare name
// (e.g. "MechanicAdvice", no "r/"). Never throws — returns an { ok, ... } shape.
export async function submitRedditPost(args: {
  subreddit: string;
  title: string;
  body: string;
}): Promise<{ ok: true; url: string; name: string } | { ok: false; reason: string }> {
  if (!redditPostingConfigured()) {
    return {
      ok: false,
      reason:
        "Reddit posting isn't configured — set REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET / REDDIT_USERNAME / REDDIT_PASSWORD",
    };
  }
  const token = await getUserToken();
  if (!token) {
    return { ok: false, reason: "Reddit login failed — check the account credentials / app keys" };
  }

  try {
    const form = new URLSearchParams({
      api_type: "json",
      sr: args.subreddit,
      kind: "self",
      title: args.title,
      text: args.body ?? "",
      resubmit: "true",
      sendreplies: "true",
    });
    const res = await fetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": UA,
      },
      body: form.toString(),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "Reddit rejected the credentials (401/403)" };
    }
    if (res.status === 429) {
      return { ok: false, reason: "Rate-limited by Reddit — try again shortly" };
    }
    if (!res.ok) return { ok: false, reason: `Reddit returned ${res.status}` };

    const data = (await res.json()) as {
      json?: {
        errors?: unknown[][];
        data?: { url?: string; name?: string; id?: string };
      };
    };
    const errors = data?.json?.errors ?? [];
    if (errors.length) {
      // Reddit errors look like [["SUBREDDIT_NOEXIST","that subreddit...","sr"], ...]
      const reason = errors
        .map((e) => (Array.isArray(e) ? e.slice(0, 2).filter(Boolean).join(": ") : String(e)))
        .join("; ");
      return { ok: false, reason: reason || "Reddit rejected the post" };
    }
    const url = data?.json?.data?.url;
    if (!url) return { ok: false, reason: "Reddit accepted the post but returned no URL" };
    return { ok: true, url, name: data.json?.data?.name ?? data.json?.data?.id ?? "" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Could not reach Reddit" };
  }
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

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

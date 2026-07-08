// Forums → Distribution (/forums/distribution).
//
// A placement tracker for a single post *concept*: where to post it, which
// angle to use per community, whether it's been posted yet, and how much
// traction it got. The curated recommendation list lives here in code (like
// the forum targets in targets.ts) and is seeded per-workspace into the
// forum_distribution table on first load; the DB row then owns the tracking
// state (status / posted URL / traction).

export type DistributionTier = "best_fit" | "trade" | "ai_angle";
export type DistributionStatus = "recommended" | "posted" | "skipped";

// The one topic shipped so far. Adding another = a new TOPICS entry + a new
// batch of DISTRIBUTION_SEED rows with that topic key.
export const DEFAULT_TOPIC = "ai-diagnostics-takeover";

export interface DistributionTopic {
  key: string;
  title: string; // human name of the post concept
  summary: string; // one-liner shown under the page header
}

export const TOPICS: Record<string, DistributionTopic> = {
  [DEFAULT_TOPIC]: {
    key: DEFAULT_TOPIC,
    title: "Will AI take over car diagnostics?",
    summary:
      "A discussion post asking mechanics whether AI diagnostics will replace real diagnostic work — is it good enough today, when will it be, or never?",
  },
};

export const TIER_META: Record<
  DistributionTier,
  { label: string; blurb: string; badgeClass: string }
> = {
  best_fit: {
    label: "Best fit",
    blurb: "Discussion is on-topic here — lowest removal risk. Start with these.",
    badgeClass: "bg-green-50 text-green-700",
  },
  trade: {
    label: "Trade / pro techs",
    blurb: "Smaller but high-signal — where working mechanics give the sharpest takes.",
    badgeClass: "bg-blue-50 text-blue-700",
  },
  ai_angle: {
    label: "AI-angle crowd",
    blurb:
      "Flip the framing to 'can AI do a skilled trade yet?' for the tech-optimist counterpoint.",
    badgeClass: "bg-purple-50 text-purple-700",
  },
};

// A recommendation as it lives in a forum_distribution row.
export interface DistributionRec {
  id: string;
  topic: string;
  subreddit: string;
  subreddit_url: string;
  tier: DistributionTier;
  fit_reason: string | null;
  recommended_angle: string | null;
  suggested_title: string | null;
  rules_note: string | null;
  sort_order: number;
  status: DistributionStatus;
  posted_url: string | null;
  posted_at: string | null;
  score: number | null;
  num_comments: number | null;
  upvote_ratio: number | null;
  traction_note: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

// The shape we insert when seeding a workspace (DB fills the rest).
export type DistributionSeedRow = Pick<
  DistributionRec,
  | "topic"
  | "subreddit"
  | "subreddit_url"
  | "tier"
  | "fit_reason"
  | "recommended_angle"
  | "suggested_title"
  | "rules_note"
  | "sort_order"
>;

// The curated recommendations for the AI-diagnostics discussion post.
// Order = the order to actually post in (best fits first, spaced out).
export const DISTRIBUTION_SEED: DistributionSeedRow[] = [
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/AutoRepair",
    subreddit_url: "https://www.reddit.com/r/AutoRepair/",
    tier: "best_fit",
    fit_reason:
      "General auto-repair discussion, looser than r/MechanicAdvice about 'must be a specific car problem'. A future-of-diagnostics question fits fine. Lowest removal risk — post here first.",
    recommended_angle:
      "Open, curious discussion question. Neutral tone, tech-and-DIY mix. No links, no product mention.",
    suggested_title:
      "Will AI diagnostics actually replace real diagnostic work — or is it years off?",
    rules_note: "Genuine repair questions and discussion only. No advertising or links.",
    sort_order: 1,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/askcarguys",
    subreddit_url: "https://www.reddit.com/r/askcarguys/",
    tier: "best_fit",
    fit_reason:
      "Explicitly built for open-ended car questions and opinions. Discussion posts are on-topic and won't get removed for not being a specific problem.",
    recommended_angle: "Straight opinion-seeking question to the community.",
    suggested_title:
      "Is AI good enough to diagnose cars yet — or will it never replace a real tech?",
    rules_note: "Open questions welcome; still no self-promo.",
    sort_order: 2,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/Cartalk",
    subreddit_url: "https://www.reddit.com/r/Cartalk/",
    tier: "best_fit",
    fit_reason:
      "General car discussion and troubleshooting; story- and opinion-friendly, so a 'future of diagnostics' thread fits naturally.",
    recommended_angle: "Conversational 'here's what I've been wondering' framing.",
    suggested_title:
      "Are we close to AI replacing the mechanic's diagnosis, or is that just hype?",
    rules_note: "Discussion-friendly but no spam or links.",
    sort_order: 3,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/Justrolledintotheshop",
    subreddit_url: "https://www.reddit.com/r/Justrolledintotheshop/",
    tier: "best_fit",
    fit_reason:
      "Working pro techs who love industry talk. Meme/photo culture, but trade-discussion threads do well. Best place for candid shop-floor opinions.",
    recommended_angle:
      "Write from the mechanic's chair — 'does this replace us / help us?'. Dry, insider tone.",
    suggested_title:
      "Serious question for the shop: is AI diagnostics coming for our jobs, or just another gimmick?",
    rules_note:
      "Audience is pros — any consumer-app promo gets downvoted hard. Keep it 100% discussion.",
    sort_order: 4,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/MechanicAdvice",
    subreddit_url: "https://www.reddit.com/r/MechanicAdvice/",
    tier: "best_fit",
    fit_reason:
      "Your original target and huge, but really meant for 'here's my car's problem'. General discussion has higher removal risk — reword as a pointed question and check the sidebar rules first.",
    recommended_angle: "Frame as one specific question, not an essay.",
    suggested_title:
      "Techs — has an AI diagnosis ever actually been useful to you, or is it always just a starting point?",
    rules_note:
      "Meant for specific car problems. Discussion may be removed — read the sidebar before posting.",
    sort_order: 5,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/mechanics",
    subreddit_url: "https://www.reddit.com/r/mechanics/",
    tier: "trade",
    fit_reason:
      "Actual working mechanics — smaller but high signal. Industry-shift questions land well here.",
    recommended_angle: "Peer-to-peer question among pros.",
    suggested_title: "Where do you see AI diagnostics in 5 years — assistant or replacement?",
    rules_note: "Pro crowd; keep it professional, no promotion.",
    sort_order: 6,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/ASE",
    subreddit_url: "https://www.reddit.com/r/ASE/",
    tier: "trade",
    fit_reason:
      "ASE-certified techs — serious and professional. Ideal for thoughtful 'does this replace me' takes.",
    recommended_angle: "Professional, credential-aware framing.",
    suggested_title:
      "For ASE techs: is AI diagnostics a real threat to the trade, or an overhyped tool?",
    rules_note: "Small, professional sub. Discussion is fine; keep it respectful and promo-free.",
    sort_order: 7,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/MobileMechanic",
    subreddit_url: "https://www.reddit.com/r/MobileMechanic/",
    tier: "trade",
    fit_reason:
      "Niche but engaged. Good angle on whether AI helps solo/mobile diag where you can't lug a full bay of tools around.",
    recommended_angle: "Solo / mobile-diag perspective.",
    suggested_title:
      "Mobile guys — does AI or app-based diagnostics actually help you in the field yet?",
    rules_note: "Small niche sub; keep it a genuine question.",
    sort_order: 8,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/artificial",
    subreddit_url: "https://www.reddit.com/r/artificial/",
    tier: "ai_angle",
    fit_reason:
      "Tech-optimist crowd. Flip the framing to 'can AI handle a skilled diagnostic trade yet?' for the opposite perspective. Less grounded in real shop reality.",
    recommended_angle: "AI-capability framing rather than shop framing.",
    suggested_title:
      "Can AI actually diagnose a car yet, or is skilled hands-on trade work still out of reach?",
    rules_note: "Not car-specific; frame around AI capability. No self-promo.",
    sort_order: 9,
  },
  {
    topic: DEFAULT_TOPIC,
    subreddit: "r/ArtificialInteligence",
    subreddit_url: "https://www.reddit.com/r/ArtificialInteligence/",
    tier: "ai_angle",
    fit_reason:
      "Large AI-discussion sub (yes, the sub name is misspelled — it's the real big one). Same flip; good for the tech-optimist counterpoint.",
    recommended_angle:
      "'Which skilled trades will AI reach first?' with car diagnostics as the case study.",
    suggested_title: "Will AI replace skilled diagnostic trades like auto mechanics — and how soon?",
    rules_note: "Broad AI discussion; keep car diagnostics as a concrete example, no promotion.",
    sort_order: 10,
  },
];

// ---------------------------------------------------------------------------
// Reddit traction fetch.
//
// Reddit exposes a post's public data as JSON by appending `.json` to its
// permalink — no auth needed. We read score (upvotes), num_comments and
// upvote_ratio. Reddit rate-limits anonymous requests and needs a descriptive
// User-Agent, so callers should fetch server-side (from the API route), not
// from the browser.
// ---------------------------------------------------------------------------

export interface RedditTraction {
  score: number | null;
  num_comments: number | null;
  upvote_ratio: number | null;
}

// Turn a Reddit post URL into its `.json` endpoint. Handles www/old/new hosts,
// trailing slashes and query strings. Returns null for anything that doesn't
// look like a Reddit comments permalink.
export function redditJsonUrl(postUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(postUrl.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)reddit\.com$/i.test(u.hostname) && u.hostname !== "redd.it") {
    return null;
  }
  // Only comment permalinks carry post-level score/comments.
  if (u.hostname !== "redd.it" && !/\/comments\//i.test(u.pathname)) {
    return null;
  }
  const path = u.pathname.replace(/\/+$/, "");
  return `https://www.reddit.com${path}.json?raw_json=1`;
}

// Fetch traction for one posted URL. Never throws — returns an { ok, ... } shape
// so the caller can record a per-row note without failing the whole refresh.
export async function fetchRedditTraction(
  postUrl: string,
): Promise<
  | { ok: true; traction: RedditTraction }
  | { ok: false; reason: string }
> {
  const jsonUrl = redditJsonUrl(postUrl);
  if (!jsonUrl) return { ok: false, reason: "Not a recognizable Reddit post URL" };

  let res: Response;
  try {
    res = await fetch(jsonUrl, {
      headers: { "User-Agent": "wrenchlane-crm/1.0 (forum distribution tracker)" },
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "Could not reach Reddit" };
  }
  if (res.status === 429) return { ok: false, reason: "Rate-limited by Reddit — try again shortly" };
  if (!res.ok) return { ok: false, reason: `Reddit returned ${res.status}` };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: "Unexpected response from Reddit" };
  }

  // Listing shape: [ { data: { children: [ { data: {...post} } ] } }, ... ]
  const listing = Array.isArray(json) ? json[0] : json;
  const postData =
    (listing as { data?: { children?: Array<{ data?: Record<string, unknown> }> } })?.data
      ?.children?.[0]?.data;
  if (!postData) return { ok: false, reason: "No post data found (deleted or private?)" };

  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    ok: true,
    traction: {
      score: num(postData.score) ?? num(postData.ups),
      num_comments: num(postData.num_comments),
      upvote_ratio: num(postData.upvote_ratio),
    },
  };
}

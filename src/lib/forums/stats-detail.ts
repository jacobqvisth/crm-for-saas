// Forums → Stats detail loaders for the Traction / Team / Reach sub-views.
//
// Companion to stats.ts (which powers the Overview). Same rules: read-only,
// PostgREST + JS aggregation over data the Forums feature already records, no
// new tables and no Apify/Reddit calls at request time. Traction numbers
// (score/num_comments/upvote_ratio) are populated by the on-demand refresh
// buttons, so these views surface a "tracked coverage" line rather than
// pretending every posted item has live engagement data.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getContributorLeaderboard, type ContributorTotal } from "./contributors";

type DB = SupabaseClient<Database>;
// reddit_mentions isn't in the generated Database types yet — read it untyped.
type RawDB = SupabaseClient;

const n = (v: unknown): number => (typeof v === "number" ? v : 0);
const isPosted = (r: { status?: string | null; posted_url?: string | null }) =>
  r.status === "posted" || Boolean(r.posted_url);

// Monday of the week a timestamp falls in, as YYYY-MM-DD.
function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

// "reddit:MechanicAdvice" → "MechanicAdvice"; strips a leading r/ too.
function cleanSub(raw: string | null): string {
  if (!raw) return "unknown";
  const m = raw.match(/^reddit:(.+)$/i);
  return (m ? m[1] : raw).replace(/^r\//i, "");
}

const norm = (u: string | null): string | null =>
  u ? u.replace(/^\/?u\//i, "").toLowerCase() : null;

// ============================================================================
// Traction — "what's working"
// ============================================================================

export type ContentKind = "post" | "distribution" | "answer";

export interface TractionItem {
  id: string;
  kind: ContentKind;
  title: string;
  subreddit: string;
  url: string | null;
  upvotes: number | null;
  comments: number | null;
  ratio: number | null;
  mentionLevel: string | null;
  postedAt: string | null;
  tracked: boolean;
}

export interface SubredditEngagement {
  subreddit: string;
  posted: number;
  tracked: number;
  avgUpvotes: number | null;
  avgComments: number | null;
  avgRatio: number | null;
}

export interface MentionLevelStat {
  level: string; // none | subtle | explicit | unknown
  posted: number;
  tracked: number;
  avgUpvotes: number | null;
  avgRatio: number | null;
}

export interface TractionStats {
  items: TractionItem[]; // posted items, best-upvoted first
  top: TractionItem | null;
  postedTotal: number;
  trackedTotal: number;
  totalUpvotes: number;
  totalComments: number;
  bySubreddit: SubredditEngagement[];
  byMentionLevel: MentionLevelStat[];
  weekly: { key: string; label: string; upvotes: number; comments: number }[];
}

const KIND_LABEL: Record<ContentKind, string> = {
  post: "Post",
  distribution: "Placement",
  answer: "Answer",
};
export function kindLabel(k: ContentKind): string {
  return KIND_LABEL[k];
}

export async function getTractionStats(supabase: DB, workspaceId: string): Promise<TractionStats> {
  const [postsRes, distRes, repliesRes] = await Promise.all([
    supabase
      .from("forum_posts")
      .select("id, generated_title, forum_target, mention_level, posted_url, posted_at, status, score, num_comments, upvote_ratio")
      .eq("workspace_id", workspaceId),
    supabase
      .from("forum_distribution")
      .select("id, suggested_title, subreddit, posted_url, posted_at, status, score, num_comments, upvote_ratio")
      .eq("workspace_id", workspaceId),
    // forum_replies traction cols aren't in the generated types — select * + cast.
    supabase.from("forum_replies").select("*").eq("workspace_id", workspaceId),
  ]);

  type PostRow = {
    id: string;
    generated_title: string | null;
    forum_target: string | null;
    mention_level: string | null;
    posted_url: string | null;
    posted_at: string | null;
    status: string | null;
    score: number | null;
    num_comments: number | null;
    upvote_ratio: number | null;
  };
  type DistRow = {
    id: string;
    suggested_title: string | null;
    subreddit: string | null;
    posted_url: string | null;
    posted_at: string | null;
    status: string | null;
    score: number | null;
    num_comments: number | null;
    upvote_ratio: number | null;
  };
  type ReplyRow = {
    id: string;
    source_title: string | null;
    source_subreddit: string | null;
    mention_level: string | null;
    posted_url: string | null;
    posted_at: string | null;
    status: string | null;
    score: number | null;
    num_comments: number | null;
    upvote_ratio: number | null;
  };

  const posts = (postsRes.data ?? []) as PostRow[];
  const dist = (distRes.data ?? []) as DistRow[];
  const replies = (repliesRes.data ?? []) as unknown as ReplyRow[];

  const items: TractionItem[] = [];
  for (const p of posts) {
    if (!isPosted(p)) continue;
    items.push({
      id: p.id,
      kind: "post",
      title: p.generated_title?.trim() || "(untitled post)",
      subreddit: cleanSub(p.forum_target),
      url: p.posted_url,
      upvotes: p.score,
      comments: p.num_comments,
      ratio: p.upvote_ratio,
      mentionLevel: p.mention_level,
      postedAt: p.posted_at,
      tracked: p.score != null || p.num_comments != null,
    });
  }
  for (const d of dist) {
    if (!isPosted(d)) continue;
    items.push({
      id: d.id,
      kind: "distribution",
      title: d.suggested_title?.trim() || "(placement)",
      subreddit: cleanSub(d.subreddit),
      url: d.posted_url,
      upvotes: d.score,
      comments: d.num_comments,
      ratio: d.upvote_ratio,
      mentionLevel: null, // distribution placements don't carry a mention level
      postedAt: d.posted_at,
      tracked: d.score != null || d.num_comments != null,
    });
  }
  for (const r of replies) {
    if (!isPosted(r)) continue;
    items.push({
      id: r.id,
      kind: "answer",
      title: r.source_title?.trim() || "(answer to a thread)",
      subreddit: cleanSub(r.source_subreddit),
      url: r.posted_url,
      upvotes: r.score,
      comments: r.num_comments,
      ratio: r.upvote_ratio,
      mentionLevel: r.mention_level,
      postedAt: r.posted_at,
      tracked: r.score != null || r.num_comments != null,
    });
  }

  // Best-upvoted first; tracked-but-zero above untracked (null) items.
  items.sort((a, b) => (b.upvotes ?? -1) - (a.upvotes ?? -1) || (b.comments ?? -1) - (a.comments ?? -1));

  const tracked = items.filter((i) => i.tracked);
  const totalUpvotes = tracked.reduce((s, i) => s + n(i.upvotes), 0);
  const totalComments = tracked.reduce((s, i) => s + n(i.comments), 0);
  const top = tracked[0] ?? null;

  // Engagement by subreddit (averages over tracked items only).
  const subMap = new Map<string, { posted: number; tracked: number; up: number; com: number; ratios: number[] }>();
  for (const i of items) {
    const s = subMap.get(i.subreddit) ?? { posted: 0, tracked: 0, up: 0, com: 0, ratios: [] };
    s.posted++;
    if (i.tracked) {
      s.tracked++;
      s.up += n(i.upvotes);
      s.com += n(i.comments);
      if (i.ratio != null) s.ratios.push(i.ratio);
    }
    subMap.set(i.subreddit, s);
  }
  const bySubreddit: SubredditEngagement[] = [...subMap.entries()]
    .map(([subreddit, s]) => ({
      subreddit,
      posted: s.posted,
      tracked: s.tracked,
      avgUpvotes: s.tracked ? s.up / s.tracked : null,
      avgComments: s.tracked ? s.com / s.tracked : null,
      avgRatio: s.ratios.length ? s.ratios.reduce((a, b) => a + b, 0) / s.ratios.length : null,
    }))
    .sort((a, b) => (b.avgUpvotes ?? -1) - (a.avgUpvotes ?? -1) || b.posted - a.posted);

  // Mention-level effectiveness (posts + answers carry mention_level).
  const levels = ["none", "subtle", "explicit", "unknown"];
  const mlMap = new Map<string, { posted: number; tracked: number; up: number; ratios: number[] }>();
  for (const i of items) {
    if (i.kind === "distribution") continue; // no mention level recorded
    const key = i.mentionLevel && levels.includes(i.mentionLevel) ? i.mentionLevel : "unknown";
    const m = mlMap.get(key) ?? { posted: 0, tracked: 0, up: 0, ratios: [] };
    m.posted++;
    if (i.tracked) {
      m.tracked++;
      m.up += n(i.upvotes);
      if (i.ratio != null) m.ratios.push(i.ratio);
    }
    mlMap.set(key, m);
  }
  const byMentionLevel: MentionLevelStat[] = levels
    .filter((l) => mlMap.has(l))
    .map((level) => {
      const m = mlMap.get(level)!;
      return {
        level,
        posted: m.posted,
        tracked: m.tracked,
        avgUpvotes: m.tracked ? m.up / m.tracked : null,
        avgRatio: m.ratios.length ? m.ratios.reduce((a, b) => a + b, 0) / m.ratios.length : null,
      };
    });

  // Weekly engagement earned (bucketed on our post's posted_at).
  const wk = new Map<string, { up: number; com: number }>();
  for (const i of items) {
    if (!i.postedAt || !i.tracked) continue;
    const k = weekStart(i.postedAt);
    const w = wk.get(k) ?? { up: 0, com: 0 };
    w.up += n(i.upvotes);
    w.com += n(i.comments);
    wk.set(k, w);
  }
  const weekly = [...wk.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, w]) => ({ key: k, label: k.slice(5), upvotes: w.up, comments: w.com }));

  return {
    items,
    top,
    postedTotal: items.length,
    trackedTotal: tracked.length,
    totalUpvotes,
    totalComments,
    bySubreddit,
    byMentionLevel,
    weekly,
  };
}

// ============================================================================
// Team — "who's doing the work"
// ============================================================================

export interface AccountActivity {
  ownerLabel: string;
  username: string | null;
  active: boolean;
  canMention: boolean;
  turnsWrenches: boolean;
  posts: number;
  answers: number;
  comments: number; // detected/confirmed comments on our own threads
  threadReplies: number; // replies we posted to other people's comments
  total: number;
  upvotesEarned: number;
  lastActivity: string | null;
}

export interface TeamStats {
  postsByUs: number;
  answersByUs: number;
  commentsByUs: number; // comment assignments (confirmed) + thread replies posted
  threadRepliesByUs: number;
  upvotesEarned: number;
  totalAccounts: number;
  activeAccounts: number;
  perAccount: AccountActivity[]; // members with tracked activity, most active first
  idleAccounts: number; // roster accounts with no tracked activity yet
  contributors: ContributorTotal[];
  confirmSources: { crm: number; slack_reaction: number; reddit_detected: number; other: number };
}

const CONFIRMED = new Set(["reddit_detected", "slack_reaction"]);
const UNATTRIBUTED = "Unattributed";

export async function getTeamStats(supabase: DB, workspaceId: string): Promise<TeamStats> {
  const [accountsRes, postsRes, distRes, repliesRes, assignRes, threadRes, contributors] =
    await Promise.all([
      supabase
        .from("reddit_accounts")
        .select("id, username, owner_label, active, can_mention_wrenchlane, turns_wrenches")
        .eq("workspace_id", workspaceId),
      supabase
        .from("forum_posts")
        .select("posted_by_account_id, posted_by_username, posted_url, posted_at, status, score")
        .eq("workspace_id", workspaceId),
      supabase
        .from("forum_distribution")
        .select("posted_by_account_id, posted_by_username, posted_url, posted_at, status, score")
        .eq("workspace_id", workspaceId),
      supabase.from("forum_replies").select("*").eq("workspace_id", workspaceId),
      supabase
        .from("forum_comment_assignments")
        .select("account_id, owner_label, confirmed_via, posted_at")
        .eq("workspace_id", workspaceId),
      supabase
        .from("forum_thread_replies")
        .select("account_id, assigned_owner_label, confirmed_via, posted_url, posted_at, status")
        .eq("workspace_id", workspaceId),
      getContributorLeaderboard(supabase, workspaceId),
    ]);

  type Account = {
    id: string;
    username: string | null;
    owner_label: string;
    active: boolean | null;
    can_mention_wrenchlane: boolean | null;
    turns_wrenches: boolean | null;
  };
  const accounts = (accountsRes.data ?? []) as Account[];

  const byId = new Map<string, Account>();
  const byHandle = new Map<string, Account>();
  for (const a of accounts) {
    byId.set(a.id, a);
    const h = norm(a.username);
    if (h) byHandle.set(h, a);
  }
  const labelFor = (accountId: string | null, username: string | null): string => {
    if (accountId && byId.has(accountId)) return byId.get(accountId)!.owner_label;
    const h = norm(username);
    if (h && byHandle.has(h)) return byHandle.get(h)!.owner_label;
    return UNATTRIBUTED;
  };

  // Seed per-member map from the roster.
  const map = new Map<string, AccountActivity>();
  const seed = (label: string, a?: Account): AccountActivity => {
    const existing = map.get(label);
    if (existing) return existing;
    const row: AccountActivity = {
      ownerLabel: label,
      username: a?.username ?? null,
      active: a ? a.active !== false : false,
      canMention: Boolean(a?.can_mention_wrenchlane),
      turnsWrenches: Boolean(a?.turns_wrenches),
      posts: 0,
      answers: 0,
      comments: 0,
      threadReplies: 0,
      total: 0,
      upvotesEarned: 0,
      lastActivity: null,
    };
    map.set(label, row);
    return row;
  };
  for (const a of accounts) seed(a.owner_label, a);
  const touch = (row: AccountActivity, at: string | null) => {
    if (at && (!row.lastActivity || at > row.lastActivity)) row.lastActivity = at;
  };

  type Posted = {
    posted_by_account_id: string | null;
    posted_by_username: string | null;
    posted_url: string | null;
    posted_at: string | null;
    status: string | null;
    score: number | null;
  };
  const posts = (postsRes.data ?? []) as Posted[];
  const dist = (distRes.data ?? []) as Posted[];
  const replies = (repliesRes.data ?? []) as unknown as Posted[];

  let postsByUs = 0;
  let answersByUs = 0;
  let upvotesEarned = 0;

  for (const list of [posts, dist]) {
    for (const r of list) {
      if (!isPosted(r)) continue;
      postsByUs++;
      upvotesEarned += n(r.score);
      const row = seed(labelFor(r.posted_by_account_id, r.posted_by_username));
      row.posts++;
      touch(row, r.posted_at);
    }
  }
  for (const r of replies) {
    if (!isPosted(r)) continue;
    answersByUs++;
    upvotesEarned += n(r.score);
    const row = seed(labelFor(r.posted_by_account_id, r.posted_by_username));
    row.answers++;
    touch(row, r.posted_at);
  }

  // Comments on our own threads (confirmed detections only, matches leaderboard).
  const assigns = (assignRes.data ?? []) as {
    account_id: string | null;
    owner_label: string | null;
    confirmed_via: string | null;
    posted_at: string | null;
  }[];
  let commentAssignments = 0;
  const confirmSources = { crm: 0, slack_reaction: 0, reddit_detected: 0, other: 0 };
  for (const a of assigns) {
    if (a.confirmed_via && a.confirmed_via in confirmSources) {
      (confirmSources as Record<string, number>)[a.confirmed_via]++;
    } else {
      confirmSources.other++;
    }
    if (a.confirmed_via && CONFIRMED.has(a.confirmed_via)) {
      commentAssignments++;
      const label = a.owner_label ?? labelFor(a.account_id, null);
      const row = seed(label);
      row.comments++;
      touch(row, a.posted_at);
    }
  }

  // Replies we posted to other people's comments.
  const threads = (threadRes.data ?? []) as {
    account_id: string | null;
    assigned_owner_label: string | null;
    confirmed_via: string | null;
    posted_url: string | null;
    posted_at: string | null;
    status: string | null;
  }[];
  let threadRepliesByUs = 0;
  for (const t of threads) {
    if (!isPosted(t)) continue;
    threadRepliesByUs++;
    const label = t.assigned_owner_label ?? labelFor(t.account_id, null);
    const row = seed(label);
    row.threadReplies++;
    touch(row, t.posted_at);
  }

  for (const row of map.values()) {
    row.total = row.posts + row.answers + row.comments + row.threadReplies;
  }

  const perAccount = [...map.values()]
    .filter((r) => r.total > 0)
    .sort(
      (a, b) =>
        b.total - a.total ||
        b.upvotesEarned - a.upvotesEarned ||
        a.ownerLabel.localeCompare(b.ownerLabel),
    );
  const idleAccounts = accounts.filter((a) => (map.get(a.owner_label)?.total ?? 0) === 0).length;

  return {
    postsByUs,
    answersByUs,
    commentsByUs: commentAssignments + threadRepliesByUs,
    threadRepliesByUs,
    upvotesEarned,
    totalAccounts: accounts.length,
    activeAccounts: accounts.filter((a) => a.active !== false).length,
    perAccount,
    idleAccounts,
    contributors,
    confirmSources,
  };
}

// ============================================================================
// Reach — "Wrenchlane global reach"
// ============================================================================

export interface ReachMention {
  id: string;
  audience: string;
  kind: string;
  subreddit: string | null;
  author: string | null;
  source_url: string;
  matched_domain: string | null;
  sentiment: string | null;
  context_tag: string | null;
  ai_summary: string | null;
  is_about_us: boolean | null;
  status: string;
  score: number | null;
  num_comments: number | null;
  first_seen_at: string;
}

export interface ReachStats {
  tracked: boolean;
  totalMentions: number;
  aboutUs: number;
  us: { links: number; mentions: number };
  thirdParty: { links: number; mentions: number };
  bySentiment: { positive: number; neutral: number; negative: number; competitor: number; unknown: number };
  weekly: { key: string; label: string; count: number }[];
  bySubreddit: { subreddit: string; mentions: number }[];
  thirdPartyRecent: ReachMention[];
  // Reach proxy — the footprint we've created on Reddit.
  threadsPostedIn: number;
  subredditsTouched: number;
  estimatedReach: number;
  ourFootprintEngagement: number; // upvotes + comments on threads we posted
  mentionEngagement: number; // upvotes + comments on threads that mention us
}

export async function getReachStats(supabase: DB, workspaceId: string): Promise<ReachStats> {
  const raw = supabase as unknown as RawDB;

  // Posted footprint (for the reach proxy + subreddits touched).
  const [postsRes, distRes, repliesRes] = await Promise.all([
    supabase
      .from("forum_posts")
      .select("forum_target, posted_url, status, score, num_comments")
      .eq("workspace_id", workspaceId),
    supabase
      .from("forum_distribution")
      .select("subreddit, posted_url, status, score, num_comments")
      .eq("workspace_id", workspaceId),
    supabase.from("forum_replies").select("*").eq("workspace_id", workspaceId),
  ]);

  const subs = new Set<string>();
  const threads = new Set<string>();
  let footprintEngagement = 0;
  const addFootprint = (
    sub: string,
    r: { posted_url?: string | null; status?: string | null; score?: number | null; num_comments?: number | null },
  ) => {
    if (!isPosted(r)) return;
    subs.add(sub);
    if (r.posted_url) threads.add(r.posted_url);
    footprintEngagement += n(r.score) + n(r.num_comments);
  };
  for (const p of (postsRes.data ?? []) as { forum_target: string | null; posted_url: string | null; status: string | null; score: number | null; num_comments: number | null }[]) {
    addFootprint(cleanSub(p.forum_target), p);
  }
  for (const d of (distRes.data ?? []) as { subreddit: string | null; posted_url: string | null; status: string | null; score: number | null; num_comments: number | null }[]) {
    addFootprint(cleanSub(d.subreddit), d);
  }
  for (const r of (repliesRes.data ?? []) as unknown as { source_subreddit: string | null; posted_url: string | null; status: string | null; score: number | null; num_comments: number | null }[]) {
    addFootprint(cleanSub(r.source_subreddit), r);
  }

  const empty: ReachStats = {
    tracked: false,
    totalMentions: 0,
    aboutUs: 0,
    us: { links: 0, mentions: 0 },
    thirdParty: { links: 0, mentions: 0 },
    bySentiment: { positive: 0, neutral: 0, negative: 0, competitor: 0, unknown: 0 },
    weekly: [],
    bySubreddit: [],
    thirdPartyRecent: [],
    threadsPostedIn: threads.size,
    subredditsTouched: subs.size,
    estimatedReach: footprintEngagement,
    ourFootprintEngagement: footprintEngagement,
    mentionEngagement: 0,
  };

  try {
    const { data, error } = await raw
      .from("reddit_mentions")
      .select(
        "id, audience, kind, subreddit, author, source_url, matched_domain, sentiment, context_tag, ai_summary, is_about_us, status, score, num_comments, first_seen_at",
      )
      .eq("workspace_id", workspaceId)
      .neq("status", "dismissed")
      .order("first_seen_at", { ascending: false });
    if (error || !data) return empty;

    const rows = data as ReachMention[];
    const bySentiment = { positive: 0, neutral: 0, negative: 0, competitor: 0, unknown: 0 };
    const us = { links: 0, mentions: 0 };
    const thirdParty = { links: 0, mentions: 0 };
    const subMap = new Map<string, number>();
    const wk = new Map<string, number>();
    let aboutUs = 0;
    let mentionEngagement = 0;

    for (const r of rows) {
      const bucket = r.audience === "us" ? us : thirdParty;
      if (r.kind === "link") bucket.links++;
      else bucket.mentions++;

      const s = (r.sentiment && r.sentiment in bySentiment ? r.sentiment : "unknown") as keyof typeof bySentiment;
      bySentiment[s]++;

      if (r.is_about_us) aboutUs++;
      mentionEngagement += n(r.score) + n(r.num_comments);

      const sub = (r.subreddit ?? "unknown").replace(/^r\//i, "");
      subMap.set(sub, (subMap.get(sub) ?? 0) + 1);
      subs.add(sub);

      if (r.first_seen_at) {
        const k = weekStart(r.first_seen_at);
        wk.set(k, (wk.get(k) ?? 0) + 1);
      }
    }

    const bySubreddit = [...subMap.entries()]
      .map(([subreddit, mentions]) => ({ subreddit, mentions }))
      .sort((a, b) => b.mentions - a.mentions);
    const weekly = [...wk.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, count]) => ({ key: k, label: k.slice(5), count }));
    const thirdPartyRecent = rows.filter((r) => r.audience !== "us").slice(0, 20);

    return {
      tracked: true,
      totalMentions: rows.length,
      aboutUs,
      us,
      thirdParty,
      bySentiment,
      weekly,
      bySubreddit,
      thirdPartyRecent,
      threadsPostedIn: threads.size,
      subredditsTouched: subs.size,
      estimatedReach: footprintEngagement + mentionEngagement,
      ourFootprintEngagement: footprintEngagement,
      mentionEngagement,
    };
  } catch {
    return empty;
  }
}

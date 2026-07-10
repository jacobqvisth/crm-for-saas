// Forums → Stats (/forums/stats). One read-only aggregation over everything the
// Forums feature already records, so the numbers that were scattered inline
// across the Posts / Answer posts / Gap log tabs live in one place.
//
// Phase 1 is deliberately all existing data — no new tables, no Apify calls, no
// cron. It reads forum_posts, forum_distribution, forum_replies,
// forum_thread_replies, forum_comment_assignments, reddit_accounts and
// ai_failure_stories and rolls them up. Wrenchlane link / mention tracking
// (ours vs third-party) is a later phase that adds a reddit_mentions table.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { FailureOutcome, GapVerdict } from "./gaps";
import { getContributorLeaderboard, type ContributorTotal } from "./contributors";

type DB = SupabaseClient<Database>;
// reddit_mentions isn't in the generated Database types yet (added by the
// 20260710120000 migration). Access it through an untyped client view.
type RawDB = SupabaseClient;

export interface StatusCount {
  total: number;
  posted: number;
  drafted: number;
  archived: number;
}

export interface SubredditStat {
  subreddit: string;
  placements: number;
  posted: number;
  upvotes: number;
  comments: number;
  avgRatio: number | null;
}

export interface TimelinePoint {
  week: string; // ISO week start, YYYY-MM-DD (Monday)
  posts: number;
}

export interface ForumStats {
  posts: StatusCount;
  distribution: StatusCount;
  answers: StatusCount;
  threadReplies: StatusCount;
  // Live upvotes / comments summed across every posted item that has traction.
  traction: { upvotes: number; comments: number; tracked: number };
  bySubreddit: SubredditStat[];
  contributors: ContributorTotal[];
  contributorCoverage: { withComment: number; totalPosted: number };
  roster: { accounts: number; active: number; canMention: number; turnsWrenches: number };
  gaps: {
    total: number;
    byOutcome: Record<FailureOutcome, number>;
    byVerdict: Record<GapVerdict, number>;
  };
  timeline: TimelinePoint[];
  wrenchlane: WrenchlaneExposure;
}

export interface WrenchlaneExposure {
  // False until the reddit_mentions table exists — the UI then shows the
  // "coming soon" note instead of a misleading row of zeros.
  tracked: boolean;
  us: { links: number; mentions: number };
  thirdParty: { links: number; mentions: number };
  recent: {
    id: string;
    audience: string;
    kind: string;
    subreddit: string | null;
    author: string | null;
    source_url: string;
    matched_domain: string | null;
    sentiment: string | null;
    ai_summary: string | null;
    status: string;
    first_seen_at: string;
  }[];
}

// Wrenchlane footprint on Reddit. Guarded: if the reddit_mentions table hasn't
// been created yet the query errors and we report tracked:false rather than
// throwing, so the Stats page keeps working through the rollout.
export async function getWrenchlaneExposure(
  supabase: RawDB,
  workspaceId: string,
): Promise<WrenchlaneExposure> {
  const empty: WrenchlaneExposure = {
    tracked: false,
    us: { links: 0, mentions: 0 },
    thirdParty: { links: 0, mentions: 0 },
    recent: [],
  };
  try {
    const { data, error } = await supabase
      .from("reddit_mentions")
      .select(
        "id, audience, kind, subreddit, author, source_url, matched_domain, sentiment, ai_summary, status, first_seen_at",
      )
      .eq("workspace_id", workspaceId)
      .neq("status", "dismissed")
      .order("first_seen_at", { ascending: false });
    if (error || !data) return empty;

    const rows = data as WrenchlaneExposure["recent"][number][] & {
      audience: string;
      kind: string;
    }[];
    const out: WrenchlaneExposure = {
      tracked: true,
      us: { links: 0, mentions: 0 },
      thirdParty: { links: 0, mentions: 0 },
      recent: rows.slice(0, 20),
    };
    for (const r of rows) {
      const bucket = r.audience === "us" ? out.us : out.thirdParty;
      if (r.kind === "link") bucket.links++;
      else bucket.mentions++;
    }
    return out;
  } catch {
    return empty;
  }
}

const n = (v: unknown): number => (typeof v === "number" ? v : 0);

// Monday of the week a timestamp falls in, as YYYY-MM-DD, for weekly buckets.
function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function tally(rows: { status?: string | null; posted_url?: string | null }[]): StatusCount {
  const c: StatusCount = { total: rows.length, posted: 0, drafted: 0, archived: 0 };
  for (const r of rows) {
    const posted = r.status === "posted" || Boolean(r.posted_url);
    if (posted) c.posted++;
    else if (r.status === "archived") c.archived++;
    else c.drafted++;
  }
  return c;
}

// Pull a subreddit name out of a forum_posts.forum_target like
// "reddit:MechanicAdvice" (falls back to the raw value).
function targetSubreddit(target: string | null): string {
  if (!target) return "unknown";
  const m = target.match(/^reddit:(.+)$/i);
  return m ? m[1] : target;
}

export async function getForumStats(supabase: DB, workspaceId: string): Promise<ForumStats> {
  const eq = <T>(p: PromiseLike<T>) => p; // readability only

  const [
    postsRes,
    distRes,
    repliesRes,
    threadRes,
    assignRes,
    rosterRes,
    gapsRes,
    leaderboard,
  ] = await Promise.all([
    eq(
      supabase
        .from("forum_posts")
        .select("status, posted_url, posted_at, forum_target, score, num_comments, upvote_ratio")
        .eq("workspace_id", workspaceId),
    ),
    eq(
      supabase
        .from("forum_distribution")
        .select("status, posted_url, posted_at, subreddit, score, num_comments, upvote_ratio")
        .eq("workspace_id", workspaceId),
    ),
    // score / num_comments / upvote_ratio were added to forum_replies by PR #545
    // but database.types.ts hasn't been regenerated, so select * and cast below.
    eq(supabase.from("forum_replies").select("*").eq("workspace_id", workspaceId)),
    eq(
      supabase
        .from("forum_thread_replies")
        .select("status, posted_url")
        .eq("workspace_id", workspaceId),
    ),
    eq(
      supabase
        .from("forum_comment_assignments")
        .select("source, source_id, confirmed_via")
        .eq("workspace_id", workspaceId),
    ),
    eq(
      supabase
        .from("reddit_accounts")
        .select("active, can_mention_wrenchlane, turns_wrenches")
        .eq("workspace_id", workspaceId),
    ),
    eq(
      supabase
        .from("ai_failure_stories")
        .select("outcome, our_verdict")
        .eq("workspace_id", workspaceId),
    ),
    getContributorLeaderboard(supabase, workspaceId),
  ]);

  type PostRow = {
    status: string | null;
    posted_url: string | null;
    posted_at: string | null;
    forum_target: string | null;
    score: number | null;
    num_comments: number | null;
    upvote_ratio: number | null;
  };
  type DistRow = {
    status: string | null;
    posted_url: string | null;
    posted_at: string | null;
    subreddit: string | null;
    score: number | null;
    num_comments: number | null;
    upvote_ratio: number | null;
  };
  type ReplyRow = {
    status: string | null;
    posted_url: string | null;
    posted_at: string | null;
    source_subreddit: string | null;
    score: number | null;
    num_comments: number | null;
    upvote_ratio: number | null;
  };

  const postRows = (postsRes.data ?? []) as PostRow[];
  const distRows = (distRes.data ?? []) as DistRow[];
  const replyRows = (repliesRes.data ?? []) as unknown as ReplyRow[];
  const threadRows = (threadRes.data ?? []) as { status: string | null; posted_url: string | null }[];
  const assignRows = (assignRes.data ?? []) as {
    source: string;
    source_id: string;
    confirmed_via: string | null;
  }[];
  const rosterRows = (rosterRes.data ?? []) as {
    active: boolean | null;
    can_mention_wrenchlane: boolean | null;
    turns_wrenches: boolean | null;
  }[];
  const gapRows = (gapsRes.data ?? []) as { outcome: FailureOutcome; our_verdict: GapVerdict }[];

  const posts = tally(postRows);
  const distribution = tally(distRows);
  const answers = tally(replyRows);
  const threadReplies = tally(threadRows);

  // Traction: sum live upvotes/comments across every posted item that carries a
  // score. Posts + distribution + our answer replies all store our own post's
  // score/num_comments once posted.
  let upvotes = 0;
  let comments = 0;
  let tracked = 0;
  for (const r of [...postRows, ...distRows, ...replyRows]) {
    if (r.score != null || r.num_comments != null) {
      upvotes += n(r.score);
      comments += n(r.num_comments);
      tracked++;
    }
  }

  // By subreddit — distribution placements (the main board) + answer-post
  // parents. Posts are folded in via their forum_target.
  const bySub = new Map<string, { placements: number; posted: number; up: number; com: number; ratios: number[] }>();
  const bump = (
    sub: string,
    posted: boolean,
    score: number | null,
    numComments: number | null,
    ratio: number | null,
  ) => {
    const key = sub || "unknown";
    const s = bySub.get(key) ?? { placements: 0, posted: 0, up: 0, com: 0, ratios: [] };
    s.placements++;
    if (posted) s.posted++;
    s.up += n(score);
    s.com += n(numComments);
    if (ratio != null) s.ratios.push(ratio);
    bySub.set(key, s);
  };
  for (const r of distRows) {
    bump(r.subreddit ?? "unknown", r.status === "posted" || Boolean(r.posted_url), r.score, r.num_comments, r.upvote_ratio);
  }
  for (const r of postRows) {
    bump(targetSubreddit(r.forum_target), r.status === "posted" || Boolean(r.posted_url), r.score, r.num_comments, r.upvote_ratio);
  }
  for (const r of replyRows) {
    bump(r.source_subreddit ?? "unknown", r.status === "posted" || Boolean(r.posted_url), r.score, r.num_comments, r.upvote_ratio);
  }
  const bySubreddit: SubredditStat[] = [...bySub.entries()]
    .map(([subreddit, s]) => ({
      subreddit,
      placements: s.placements,
      posted: s.posted,
      upvotes: s.up,
      comments: s.com,
      avgRatio: s.ratios.length ? s.ratios.reduce((a, b) => a + b, 0) / s.ratios.length : null,
    }))
    .sort((a, b) => b.posted - a.posted || b.placements - a.placements || a.subreddit.localeCompare(b.subreddit));

  // Contributor coverage: how many posted items have at least one detected/
  // confirmed team comment. Keyed on source+source_id.
  const contributedItems = new Set<string>();
  for (const a of assignRows) {
    if (a.confirmed_via === "reddit_detected" || a.confirmed_via === "slack_reaction") {
      contributedItems.add(`${a.source}:${a.source_id}`);
    }
  }
  const totalPosted = posts.posted + distribution.posted;

  // Roster.
  const roster = {
    accounts: rosterRows.length,
    active: rosterRows.filter((r) => r.active !== false).length,
    canMention: rosterRows.filter((r) => r.can_mention_wrenchlane).length,
    turnsWrenches: rosterRows.filter((r) => r.turns_wrenches).length,
  };

  // Gap log.
  const byOutcome: Record<FailureOutcome, number> = { failure: 0, partial: 0, success: 0, unknown: 0 };
  const byVerdict: Record<GapVerdict, number> = {
    not_reviewed: 0,
    would_have_caught: 0,
    would_have_missed: 0,
    unsure: 0,
  };
  for (const g of gapRows) {
    if (g.outcome in byOutcome) byOutcome[g.outcome]++;
    if (g.our_verdict in byVerdict) byVerdict[g.our_verdict]++;
  }

  // Posted-per-week timeline across all four content types.
  const weekly = new Map<string, number>();
  for (const r of [...postRows, ...distRows, ...replyRows]) {
    if (r.posted_at) weekly.set(weekStart(r.posted_at), (weekly.get(weekStart(r.posted_at)) ?? 0) + 1);
  }
  const timeline: TimelinePoint[] = [...weekly.entries()]
    .map(([week, count]) => ({ week, posts: count }))
    .sort((a, b) => a.week.localeCompare(b.week));

  const wrenchlane = await getWrenchlaneExposure(supabase as unknown as RawDB, workspaceId);

  return {
    posts,
    distribution,
    answers,
    threadReplies,
    traction: { upvotes, comments, tracked },
    bySubreddit,
    contributors: leaderboard,
    contributorCoverage: { withComment: contributedItems.size, totalPosted },
    roster,
    gaps: { total: gapRows.length, byOutcome, byVerdict },
    timeline,
    wrenchlane,
  };
}

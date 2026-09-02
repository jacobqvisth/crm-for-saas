// Forums → Answer posts (/forums/answers).
//
// The inbound counterpart to the post generator: instead of turning your own
// diagnostic scenarios into new Reddit posts, this finds real questions people
// are already asking (e.g. "brakes still soft after replacing lines") and
// drafts a genuinely helpful reply you can paste as a comment.
//
// A drafted reply is persisted as a forum_replies row (workspace-scoped,
// mirrors forum_posts) so you can track which posts you've answered and where.

import { GARAGET_BOARDS } from "./garaget";
import type { ForumGenerationOptions, ForumMentionLevel, ForumPlatform } from "./types";

export type { ForumMentionLevel };

export type ForumReplyStatus = "draft" | "posted" | "archived";

// The subreddits we suggest scanning for answerable questions. Mirrors the
// FORUM_TARGETS list but as bare names for the search API. Diagnostic-heavy
// communities where a helpful reply lands well.
export const REPLY_SUBREDDITS: Array<{ name: string; label: string; blurb: string }> = [
  {
    name: "MechanicAdvice",
    label: "r/MechanicAdvice",
    blurb: "Owners posting symptoms + codes asking what to check. Highest volume of answerable questions.",
  },
  {
    name: "AskMechanics",
    label: "r/AskMechanics",
    blurb: "Straight Q&A — owners ask, mechanics answer. Great fit for a solid diagnostic reply.",
  },
  {
    name: "AutoRepair",
    label: "r/AutoRepair",
    blurb: "DIYers mid-repair asking whether they're on the right track.",
  },
  {
    name: "Cartalk",
    label: "r/Cartalk",
    blurb: "General troubleshooting and war stories; conversational replies welcome.",
  },
  {
    name: "Justrolledintotheshop",
    label: "r/Justrolledintotheshop",
    blurb: "Pro/shop crowd — reply from the mechanic's chair, not the owner's.",
  },
];

/**
 * Every board the answer queue scans, across platforms.
 *
 * REPLY_SUBREDDITS above stays as the Reddit-only list because the Apify search
 * takes bare subreddit names; this is the superset the UI and the daily scan
 * work from. `key` is what the client sends back when picking sources.
 */
export interface ReplySourceBoard {
  key: string;
  platform: ForumPlatform;
  /** Board identifier within the platform: subreddit name, or Garaget board id. */
  board: string;
  label: string;
  blurb: string;
  language: string;
}

export const REPLY_SOURCES: ReplySourceBoard[] = [
  ...REPLY_SUBREDDITS.map((s) => ({
    key: `reddit:${s.name}`,
    platform: "reddit" as const,
    board: s.name,
    label: s.label,
    blurb: s.blurb,
    language: "en",
  })),
  ...GARAGET_BOARDS.map((b) => ({
    key: `garaget:${b.name}`,
    platform: "garaget" as const,
    board: b.name,
    label: `Garaget › ${b.label}`,
    blurb: b.blurb,
    language: "sv",
  })),
];

export function replySourceByKey(key: string): ReplySourceBoard | undefined {
  return REPLY_SOURCES.find((s) => s.key === key);
}

/**
 * How a board is written when shown to a human.
 *
 * The client used to hardcode `r/{subreddit}`, which is wrong the moment a row
 * is not from Reddit. Garaget rows carry their board label in the same column,
 * so this only needs to add the r/ prefix for Reddit.
 */
export function boardLabel(
  platform: ForumPlatform | null | undefined,
  board: string | null | undefined,
): string {
  if (!board) return platform === "garaget" ? "Garaget" : "unknown";
  if (platform === "garaget") {
    return board.startsWith("Garaget") ? board : `Garaget › ${board}`;
  }
  return `r/${board.replace(/^r\//i, "")}`;
}

// A row in the forum_replies table.
export interface ForumReply {
  id: string;
  source_url: string | null;
  source_platform: ForumPlatform;
  source_subreddit: string | null;
  source_title: string | null;
  source_body: string | null;
  source_author: string | null;
  source_score: number | null;
  source_num_comments: number | null;
  mention_level: ForumMentionLevel;
  generation_options: Partial<ForumGenerationOptions> | null;
  generated_body: string | null;
  status: ForumReplyStatus;
  posted_url: string | null;
  posted_at: string | null;
  model: string | null;
  // Who posted our reply — the roster account picked when marking it posted,
  // plus the real Reddit handle captured on traction refresh (cross-check).
  posted_by_account_id: string | null;
  posted_by_username: string | null;
  // Live traction on OUR reply's comment, mirroring forum_distribution.
  score: number | null;
  num_comments: number | null;
  upvote_ratio: number | null;
  traction_note: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

// The resolved source post the client hands to the generate endpoint — either
// pulled from a forum or pasted in by hand.
//
// `platform` decides which language and which community norms the draft is
// written to, so it is the one field the generator must not have to guess. It
// stays optional for back-compat with callers written when Reddit was the only
// option; those are treated as Reddit.
export interface ReplySource {
  url?: string | null;
  platform?: ForumPlatform | null;
  /** Board within the platform. On Reddit this is the subreddit name. */
  board?: string | null;
  subreddit?: string | null;
  title: string;
  body?: string | null;
  author?: string | null;
  score?: number | null;
  num_comments?: number | null;
}

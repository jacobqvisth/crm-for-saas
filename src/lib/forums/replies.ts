// Forums → Answer posts (/forums/answers).
//
// The inbound counterpart to the post generator: instead of turning your own
// diagnostic scenarios into new Reddit posts, this finds real questions people
// are already asking (e.g. "brakes still soft after replacing lines") and
// drafts a genuinely helpful reply you can paste as a comment.
//
// A drafted reply is persisted as a forum_replies row (workspace-scoped,
// mirrors forum_posts) so you can track which posts you've answered and where.

import type { ForumMentionLevel } from "./types";

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

// A row in the forum_replies table.
export interface ForumReply {
  id: string;
  source_url: string | null;
  source_subreddit: string | null;
  source_title: string | null;
  source_body: string | null;
  source_author: string | null;
  source_score: number | null;
  source_num_comments: number | null;
  mention_level: ForumMentionLevel;
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
// pulled from Reddit or pasted in by hand.
export interface ReplySource {
  url?: string | null;
  subreddit?: string | null;
  title: string;
  body?: string | null;
  author?: string | null;
  score?: number | null;
  num_comments?: number | null;
}

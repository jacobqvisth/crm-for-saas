// Types for the Forums page (/forums).

// The three angles a post can take. Mirrors the AskUserQuestion decision:
//   help_question  — written as an owner with a problem, asking for help
//   solved_story   — an owner sharing how they diagnosed/fixed it (a natural
//                    place to mention Wrenchlane)
//   helpful_answer — you as the knowledgeable helper answering a common issue
export type ForumPostType = "help_question" | "solved_story" | "helpful_answer";

// How prominently Wrenchlane gets mentioned in the post body.
export type ForumMentionLevel = "none" | "subtle" | "explicit";

export type ForumPostStatus = "idea" | "drafted" | "posted" | "archived";

// A target forum. Reference data only (no DB row) — lives in
// src/lib/forums/targets.ts. `tone` is fed to the model so the post matches
// the community's norms; `rulesNote` is a human reminder shown in the UI.
export interface ForumTarget {
  key: string; // e.g. "reddit:MechanicAdvice"
  platform: "reddit"; // only Reddit for phase 1
  name: string; // e.g. "r/MechanicAdvice"
  url: string;
  language: string; // ISO-2 of the language posts should be written in
  blurb: string; // what the community is, shown as a chip subtitle
  tone: string; // tone guidance handed to the model
  rulesNote: string; // posting-norm reminder shown to the user
}

// A lean view of a real diagnostic scenario, used to populate the scenario
// browser and frozen into forum_posts.scenario_snapshot at generation time.
export interface ForumScenario {
  diagnosticId: string;
  carMake: string | null;
  carModel: string | null;
  carYear: number | null;
  mileage: number | null;
  description: string | null;
  dtcs: string[];
  symptoms: string[];
  country: string | null;
  topCauseName: string | null;
  topCauseSeverity: string | null;
  causes: Array<{
    name: string;
    probability: number | null;
    severity: string | null;
    description: string | null;
  }>;
  createdAt: string | null;
}

// A generated forum post. Rows live in the forum_posts table.
export interface ForumPost {
  id: string;
  diagnostic_id: string | null;
  scenario_snapshot: ForumScenario | Record<string, never>;
  forum_target: string;
  post_type: ForumPostType;
  mention_level: ForumMentionLevel;
  language: string;
  generated_title: string | null;
  generated_body: string | null;
  status: ForumPostStatus;
  posted_url: string | null;
  posted_at: string | null;
  model: string | null;
  // Roster account assigned to post this draft (semi-automated flow).
  assigned_account_id: string | null;
  // Roster account that actually posted it + the Reddit-reported author handle.
  posted_by_account_id: string | null;
  posted_by_username: string | null;
  // Traction pulled from Reddit's public JSON (see src/lib/forums/reddit.ts).
  score: number | null;
  num_comments: number | null;
  upvote_ratio: number | null;
  traction_note: string | null;
  last_checked_at: string | null;
  // Slack fan-out: legacy single drafted reply + when we pinged #forum-posts.
  suggested_comment: string | null;
  slack_notified_at: string | null;
  slack_thread_ts: string | null;
  slack_channel_id: string | null;
  slack_summary_ts: string | null;
  slack_summary_channel: string | null;
  created_at: string;
  updated_at: string;
  // Per-member comments attached on GET (not a column) — see below.
  assignments?: ForumCommentAssignment[];
}

// Per-member comment for one forum item (Distribution rec or generated post).
// Each active roster member gets a distinct drafted reply they can post from
// their own Reddit account; status tracks who has done it, and how we know
// (marked in the CRM, or a ✅ reaction in the #forum-posts Slack thread).
// Which board a forum item lives on.
export type ForumSource = "distribution" | "post";

export type CommentAssignmentStatus = "suggested" | "posted" | "skipped";
// 'reddit_detected' = their roster handle showed up as a commenter on the
// actual Reddit thread (read via Apify) — the authoritative contribution signal.
export type CommentConfirmedVia = "crm" | "slack_reaction" | "reddit_detected";

export interface ForumCommentAssignment {
  id: string;
  workspace_id: string;
  source: "distribution" | "post";
  source_id: string;
  account_id: string | null;
  owner_label: string;
  comment: string | null;
  status: CommentAssignmentStatus;
  posted_url: string | null;
  posted_at: string | null;
  confirmed_via: CommentConfirmedVia | null;
  slack_message_ts: string | null;
  slack_channel_id: string | null;
  // Reddit-detected contribution: the matched comment's permalink + author.
  reddit_comment_url: string | null;
  detected_author: string | null;
  created_at: string;
  updated_at: string;
}

// A drafted reply to ONE real comment on a posted thread — the "reply to other
// people's comments" flow on the per-post sub-page. Produced by the thread
// analyzer (src/lib/forums/thread-analyze.ts) and tracked per comment.
export type ThreadReplyStatus = "suggested" | "posted" | "skipped";
export type ThreadReplyConfirmedVia = "crm" | "reddit_detected";

export interface ForumThreadReply {
  id: string;
  workspace_id: string;
  source: "distribution" | "post";
  source_id: string;
  reddit_comment_id: string;
  reddit_comment_url: string | null;
  comment_author: string | null;
  comment_excerpt: string | null;
  comment_score: number | null;
  why: string | null;
  priority: number;
  assigned_owner_label: string | null;
  account_id: string | null;
  mention_level: ForumMentionLevel;
  reply_text: string | null;
  status: ThreadReplyStatus;
  posted_url: string | null;
  posted_at: string | null;
  confirmed_via: ThreadReplyConfirmedVia | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

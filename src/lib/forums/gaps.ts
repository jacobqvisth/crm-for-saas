// Forums → Gap log (/forums/gaps). Types + option lists for the AI-failure
// story store, the "would we have done better?" R&D loop. See the migration
// supabase/migrations/20260709210000_ai_failure_stories.sql for the table.

export type FailureOutcome = "failure" | "partial" | "success" | "unknown";
export type GapVerdict =
  | "not_reviewed"
  | "would_have_caught"
  | "would_have_missed"
  | "unsure";

export interface FailureStory {
  id: string;
  workspace_id: string;
  source_url: string | null;
  source_subreddit: string | null;
  source_author: string | null;
  symptom: string;
  ai_tool: string | null;
  ai_claimed_cause: string | null;
  action_taken: string | null;
  cost_amount: number | null;
  cost_currency: string | null;
  actual_cause: string | null;
  outcome: FailureOutcome;
  our_verdict: GapVerdict;
  our_notes: string | null;
  created_at: string;
  updated_at: string;
}

// A row in forum_gap_candidates — an AI-failure case the classifier surfaced
// from the Answer-posts scrape, awaiting review. Confirming it writes a
// FailureStory and links via story_id. See 20260710180000_forum_gap_candidates.
export type GapCandidateStatus = "new" | "confirmed" | "dismissed";

export interface GapCandidate {
  id: string;
  workspace_id: string;
  source_url: string;
  source_subreddit: string | null;
  source_author: string | null;
  source_title: string | null;
  source_body: string | null;
  source_score: number | null;
  source_num_comments: number | null;
  confidence: number | null;
  symptom: string | null;
  ai_tool: string | null;
  ai_claimed_cause: string | null;
  action_taken: string | null;
  cost_amount: number | null;
  cost_currency: string | null;
  actual_cause: string | null;
  outcome: FailureOutcome;
  status: GapCandidateStatus;
  story_id: string | null;
  model: string | null;
  first_seen_at: string;
  created_at: string;
  updated_at: string;
}

export const OUTCOME_META: Record<FailureOutcome, { label: string; badgeClass: string }> = {
  failure: { label: "Wrong / wasted money", badgeClass: "bg-red-50 text-red-700" },
  partial: { label: "Partly right", badgeClass: "bg-amber-50 text-amber-700" },
  success: { label: "AI got it right", badgeClass: "bg-green-50 text-green-700" },
  unknown: { label: "Unclear", badgeClass: "bg-slate-100 text-slate-600" },
};

export const VERDICT_META: Record<GapVerdict, { label: string; badgeClass: string }> = {
  not_reviewed: { label: "Not reviewed", badgeClass: "bg-slate-100 text-slate-500" },
  would_have_caught: { label: "We'd have caught it", badgeClass: "bg-green-50 text-green-700" },
  would_have_missed: { label: "We'd have missed it too", badgeClass: "bg-red-50 text-red-700" },
  unsure: { label: "Unsure", badgeClass: "bg-amber-50 text-amber-700" },
};

export const OUTCOME_OPTIONS: FailureOutcome[] = ["failure", "partial", "success", "unknown"];
export const VERDICT_OPTIONS: GapVerdict[] = [
  "not_reviewed",
  "would_have_caught",
  "would_have_missed",
  "unsure",
];

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
  // Traction pulled from Reddit's public JSON (see src/lib/forums/reddit.ts).
  score: number | null;
  num_comments: number | null;
  upvote_ratio: number | null;
  traction_note: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

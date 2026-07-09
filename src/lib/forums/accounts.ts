// Reddit account roster for the semi-automated posting flow. The team posts
// manually from their own accounts; the CRM tracks who posts what. Accounts are
// workspace-scoped rows in `reddit_accounts`; this file holds the shared type
// and the initial seed (one placeholder per team member — the real Reddit
// handle gets filled in via the UI once each person hands theirs over).

export interface RedditAccount {
  id: string;
  workspace_id: string;
  username: string | null; // reddit handle, no "u/". null = pending.
  owner_label: string; // team member who operates it
  subreddits: string[]; // subs this account is established in
  slack_user_id: string | null; // Slack member id, for @-mentions in the thread
  notes: string | null;
  active: boolean;
  // Persona — shapes which drafted replies this person gets assigned and what
  // they're allowed to say when replying to real comments. See the migration
  // 20260709200000_forum_thread_replies for the full rationale.
  turns_wrenches: boolean; // real hands-on mechanic voice
  uses_ai_tools: boolean; // may reference using an AI diagnosis app (= subtle)
  can_mention_wrenchlane: boolean; // may name Wrenchlane, sparingly (= explicit)
  persona_note: string | null; // free-text background that colors their voice
  created_at: string;
  updated_at: string;
}

// Seeded on a workspace's first visit. Jacob's known account is pre-filled; the
// rest are placeholders (username null) for teammates to complete.
export interface AccountSeed {
  username: string | null;
  owner_label: string;
  notes: string | null;
  turns_wrenches?: boolean;
  uses_ai_tools?: boolean;
  can_mention_wrenchlane?: boolean;
  persona_note?: string | null;
}

export const ACCOUNT_SEED: AccountSeed[] = [
  // Accounts Jacob already controls (one per Google identity). Founders may name
  // Wrenchlane (sparingly) and speak to using AI diagnosis.
  { username: "Minimum-Ad7044", owner_label: "Jacob", notes: "jacob.qvisth@gmail.com — new account, warm up before strict subs.", uses_ai_tools: true, can_mention_wrenchlane: true, persona_note: "Founder. Knows the product cold; leans on the AI-diagnosis angle. Mention Wrenchlane only when it's genuinely the natural thing to say." },
  { username: "Emergency-Parsley964", owner_label: "Jacob (work)", notes: "jacob@wrenchlane.com", uses_ai_tools: true, can_mention_wrenchlane: true, persona_note: "Founder work account." },
  { username: "Minimum-Fig-2004", owner_label: "Mech Macai", notes: "mechmacai@gmail.com (Jacob)", turns_wrenches: true, uses_ai_tools: true, persona_note: "Wrenches-in-the-bay voice; talks from hands-on experience." },
  { username: "Franqer", owner_label: "Francis", notes: "francis.qvisth@gmail.com", uses_ai_tools: true },
  // Teammates — fill in each Reddit handle + persona via the roster once shared.
  { username: null, owner_label: "Hans", notes: "Pending Reddit username." },
  { username: null, owner_label: "Hasse", notes: "Pending Reddit username." },
  { username: null, owner_label: "Magnus", notes: "Pending Reddit username." },
  { username: null, owner_label: "Matteo", notes: "Pending Reddit username." },
  { username: null, owner_label: "Dogu", notes: "Pending Reddit username." },
];

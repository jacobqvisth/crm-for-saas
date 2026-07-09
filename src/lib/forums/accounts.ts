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
  created_at: string;
  updated_at: string;
}

// Seeded on a workspace's first visit. Jacob's known account is pre-filled; the
// rest are placeholders (username null) for teammates to complete.
export interface AccountSeed {
  username: string | null;
  owner_label: string;
  notes: string | null;
}

export const ACCOUNT_SEED: AccountSeed[] = [
  // Accounts Jacob already controls (one per Google identity).
  { username: "Minimum-Ad7044", owner_label: "Jacob", notes: "jacob.qvisth@gmail.com — new account, warm up before strict subs." },
  { username: "Emergency-Parsley964", owner_label: "Jacob (work)", notes: "jacob@wrenchlane.com" },
  { username: "Minimum-Fig-2004", owner_label: "Mech Macai", notes: "mechmacai@gmail.com (Jacob)" },
  { username: "Franqer", owner_label: "Francis", notes: "francis.qvisth@gmail.com" },
  // Teammates — fill in each Reddit handle via the roster once they share it.
  { username: null, owner_label: "Hans", notes: "Pending Reddit username." },
  { username: null, owner_label: "Hasse", notes: "Pending Reddit username." },
  { username: null, owner_label: "Magnus", notes: "Pending Reddit username." },
  { username: null, owner_label: "Matteo", notes: "Pending Reddit username." },
  { username: null, owner_label: "Dogu", notes: "Pending Reddit username." },
];

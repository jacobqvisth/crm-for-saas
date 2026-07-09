-- Forums → per-member comments + Slack ✅ roundtrip.
--
-- Until now a "posted" forum item fanned out ONE suggested comment for the whole
-- team. This adds a distinct suggested comment per team member (so each person
-- pastes their own, not six near-identical copies that Reddit flags as spam),
-- tracked as its own row, plus the plumbing to close the loop from Slack:
-- when a teammate ✅'s their comment in the #forum-posts thread, the CRM records
-- that they commented on Reddit.
--
--   forum_comment_assignments — one row per (forum item × team member). Holds
--     that member's tailored comment and its posting state. `source` +
--     `source_id` point at either a forum_distribution rec or a forum_posts row
--     (soft ref — no cross-table FK). `slack_message_ts` is the ts of the
--     threaded Slack reply carrying this member's comment; a reaction on that
--     message maps straight back to this row.
--   forum_distribution / forum_posts .slack_thread_ts + .slack_channel_id —
--     the parent Slack message the per-member replies hang under.
--   reddit_accounts.slack_user_id — the member's Slack user id, so the thread
--     can @-mention them (optional; plain name used when null).

CREATE TABLE IF NOT EXISTS forum_comment_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Which board the parent item lives on.
  source TEXT NOT NULL CHECK (source IN ('distribution', 'post')),
  -- forum_distribution.id or forum_posts.id (soft ref, no FK).
  source_id UUID NOT NULL,
  -- The roster account this comment is for (ON DELETE SET NULL keeps the row).
  account_id UUID REFERENCES reddit_accounts(id) ON DELETE SET NULL,
  -- Denormalized team-member name (survives account deletion / relabel).
  owner_label TEXT NOT NULL,
  -- This member's tailored, distinct Reddit comment.
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'posted', 'skipped')),
  -- Where the member's comment landed on Reddit (optional).
  posted_url TEXT,
  posted_at TIMESTAMPTZ,
  -- How we learned it was posted: 'crm' (marked in the app) or 'slack_reaction'.
  confirmed_via TEXT CHECK (confirmed_via IN ('crm', 'slack_reaction')),
  -- ts of the threaded Slack reply carrying this comment (reaction → this row).
  slack_message_ts TEXT,
  slack_channel_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One comment per member per forum item.
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_comment_assignment_member
  ON forum_comment_assignments (workspace_id, source, source_id, owner_label);

-- Board lookups (attach assignments to each rec/post on GET).
CREATE INDEX IF NOT EXISTS idx_forum_comment_assignments_source
  ON forum_comment_assignments (workspace_id, source, source_id);

-- Reaction lookup: Slack event carries the message ts → find the assignment.
CREATE INDEX IF NOT EXISTS idx_forum_comment_assignments_slack_ts
  ON forum_comment_assignments (slack_message_ts)
  WHERE slack_message_ts IS NOT NULL;

-- RLS — mirror reddit_accounts / forum_posts: one FOR ALL policy gated on
-- workspace membership. The Slack events endpoint uses the service-role client,
-- which bypasses RLS (there is no user session on a webhook).
ALTER TABLE forum_comment_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access forum_comment_assignments"
  ON forum_comment_assignments;
CREATE POLICY "workspace members can access forum_comment_assignments"
  ON forum_comment_assignments FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_forum_comment_assignments_updated_at
  BEFORE UPDATE ON forum_comment_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Parent Slack message identifiers on both boards, so per-member replies thread
-- under the "post is live" message and re-sends reuse the same thread.
ALTER TABLE forum_distribution
  ADD COLUMN IF NOT EXISTS slack_thread_ts TEXT,
  ADD COLUMN IF NOT EXISTS slack_channel_id TEXT;

ALTER TABLE forum_posts
  ADD COLUMN IF NOT EXISTS slack_thread_ts TEXT,
  ADD COLUMN IF NOT EXISTS slack_channel_id TEXT;

-- Member's Slack user id for @-mentions in the thread (optional).
ALTER TABLE reddit_accounts
  ADD COLUMN IF NOT EXISTS slack_user_id TEXT;

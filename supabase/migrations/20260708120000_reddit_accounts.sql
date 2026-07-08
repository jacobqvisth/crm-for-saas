-- Forums → semi-automated posting. The team posts manually from their own
-- Reddit accounts; the CRM generates the post text and tracks who posts what.
-- This adds the account roster + a per-post assignment so posts can be spread
-- across identities (no single account looks like a spam bot) and everyone
-- knows what's theirs.
--
--   reddit_accounts — one row per team Reddit account. `username` is nullable:
--     we seed placeholder rows per team member (Hans, Magnus, …) and fill in
--     the real handle once they hand it over. `subreddits` records where an
--     account is established/trusted (established accounts clear AutoModerator
--     spam filters; fresh ones get removed).
--   forum_posts.assigned_account_id — soft link to the account that should post
--     a given draft (ON DELETE SET NULL so removing an account just unassigns).

CREATE TABLE IF NOT EXISTS reddit_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Reddit handle without the "u/" (e.g. "Minimum-Ad7044"). NULL = pending.
  username TEXT,
  -- Team member who owns / operates this account (e.g. "Hans").
  owner_label TEXT NOT NULL,
  -- Subreddits this account is established in / safe to post to.
  subreddits TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reddit_accounts_workspace
  ON reddit_accounts (workspace_id, owner_label);

-- RLS — mirror forum_posts: one FOR ALL policy gated on workspace membership.
ALTER TABLE reddit_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access reddit_accounts" ON reddit_accounts;
CREATE POLICY "workspace members can access reddit_accounts"
  ON reddit_accounts FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_reddit_accounts_updated_at
  BEFORE UPDATE ON reddit_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Which roster account should post a given draft. Soft link — unassign, don't
-- delete the post, when an account is removed.
ALTER TABLE forum_posts
  ADD COLUMN IF NOT EXISTS assigned_account_id UUID
    REFERENCES reddit_accounts(id) ON DELETE SET NULL;

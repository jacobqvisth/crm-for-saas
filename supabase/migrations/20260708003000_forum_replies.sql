-- Forums → Answer posts (/forums/answers). The inbound counterpart to the post
-- generator: find real questions people already asked on Reddit and draft a
-- helpful reply to paste as a comment. Each drafted reply is one row here,
-- snapshotting the source post so the board stands on its own even if the
-- original is edited/deleted, and carrying the tracking state (posted URL etc).
--
-- Workspace-scoped, RLS mirrors forum_posts / forum_distribution.

CREATE TABLE IF NOT EXISTS forum_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- The Reddit post we're replying to.
  source_url TEXT,
  source_subreddit TEXT,
  source_title TEXT,
  source_body TEXT,
  source_author TEXT,
  -- Traction of the source post at draft time (context for prioritizing).
  source_score INT,
  source_num_comments INT,
  -- none | subtle | explicit — how prominently Wrenchlane is mentioned.
  mention_level TEXT NOT NULL DEFAULT 'none',
  -- The drafted reply body (plain text).
  generated_body TEXT,
  -- draft | posted | archived
  status TEXT NOT NULL DEFAULT 'draft',
  -- Permalink to the comment you actually posted.
  posted_url TEXT,
  posted_at TIMESTAMPTZ,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_replies_workspace
  ON forum_replies (workspace_id, created_at DESC);

ALTER TABLE forum_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access forum_replies" ON forum_replies;
CREATE POLICY "workspace members can access forum_replies"
  ON forum_replies FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_forum_replies_updated_at
  BEFORE UPDATE ON forum_replies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

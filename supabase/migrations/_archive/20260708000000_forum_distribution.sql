-- Forums → Distribution sub-page (/forums/distribution). A placement tracker
-- that sits alongside the post generator (/forums): for a given post *topic*
-- it holds a curated list of subreddit recommendations (where to post, which
-- angle, a suggested title, the community's posting rules), lets you mark which
-- ones you've actually posted (with the URL), and tracks how much traction each
-- post got (upvotes + comments, pulled live from Reddit's public JSON).
--
-- One workspace-scoped table:
--   forum_distribution — one row per (topic, subreddit) recommendation. The
--     curated seed list lives in code (src/lib/forums/distribution.ts) and is
--     inserted per-workspace on first load; from then on the row carries the
--     user's tracking state (status / posted_url / traction) so it persists.

CREATE TABLE IF NOT EXISTS forum_distribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Which post concept this recommendation belongs to. One page can hold
  -- several topics; the first shipped topic is the AI-diagnostics discussion.
  topic TEXT NOT NULL DEFAULT 'ai-diagnostics-takeover',
  -- e.g. "r/AutoRepair"
  subreddit TEXT NOT NULL,
  subreddit_url TEXT NOT NULL,
  -- best_fit | trade | ai_angle — how welcome a discussion post is there.
  tier TEXT NOT NULL DEFAULT 'best_fit',
  -- Why this community is a good (or risky) fit.
  fit_reason TEXT,
  -- The angle/voice to write in for this specific community.
  recommended_angle TEXT,
  -- A ready-to-use title tailored to this community.
  suggested_title TEXT,
  -- Posting-norm reminder (most subs ban overt self-promo).
  rules_note TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  -- recommended | posted | skipped
  status TEXT NOT NULL DEFAULT 'recommended',
  -- Where you actually posted it (filled in after posting).
  posted_url TEXT,
  posted_at TIMESTAMPTZ,
  -- Traction, pulled from Reddit's public JSON on demand.
  score INT,
  num_comments INT,
  upvote_ratio NUMERIC,
  traction_note TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_distribution_workspace
  ON forum_distribution (workspace_id, topic, sort_order);

-- RLS — mirror forum_posts: one FOR ALL policy gated on workspace membership.
ALTER TABLE forum_distribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access forum_distribution" ON forum_distribution;
CREATE POLICY "workspace members can access forum_distribution"
  ON forum_distribution FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_forum_distribution_updated_at
  BEFORE UPDATE ON forum_distribution
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

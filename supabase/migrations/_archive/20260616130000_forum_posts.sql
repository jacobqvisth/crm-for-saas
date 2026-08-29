-- Forums page (/forums). A content-production tool, sibling of /videos: it
-- turns REAL diagnostic scenarios our app has run (from dashboard_diagnostics)
-- into ready-to-paste forum posts (Reddit etc.). The workflow is:
--   browse real car problems → pick one → pick a forum + angle → AI writes a
--   post tuned to that forum → copy-paste into Reddit → mark where it was posted.
--
-- One workspace-scoped table:
--   forum_posts — one row per generated post. `scenario_snapshot` freezes the
--     car/problem facts at generation time because dashboard_diagnostics rows
--     rotate out of the S3 export. `diagnostic_id` is a soft reference to the
--     seed scenario (no FK — dashboard_diagnostics is a synced analytics table,
--     not workspace-scoped, and rows can disappear). The forum-target list is
--     NOT in the DB — it lives in code (src/lib/forums/targets.ts), the same
--     way the video channels / reviews platform lists do.

CREATE TABLE IF NOT EXISTS forum_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Soft link to the dashboard_diagnostics row this post was seeded from.
  diagnostic_id TEXT,
  -- Frozen copy of the scenario facts used to write the post (car make/model/
  -- year, description, dtcs, symptoms, top causes). Survives S3 export churn.
  scenario_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Target forum key from src/lib/forums/targets.ts (e.g. "reddit:MechanicAdvice").
  forum_target TEXT NOT NULL,
  -- help_question | solved_story | helpful_answer
  post_type TEXT NOT NULL DEFAULT 'help_question',
  -- none | subtle | explicit  (how prominently Wrenchlane is mentioned)
  mention_level TEXT NOT NULL DEFAULT 'none',
  language TEXT NOT NULL DEFAULT 'en',
  generated_title TEXT,
  generated_body TEXT,
  -- idea | drafted | posted | archived
  status TEXT NOT NULL DEFAULT 'drafted',
  -- Where the user actually pasted it (filled in after posting).
  posted_url TEXT,
  posted_at TIMESTAMPTZ,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_posts_workspace
  ON forum_posts (workspace_id, created_at DESC);

-- RLS — mirror diagnostic_videos / the roadmap tables: one FOR ALL policy gated
-- on workspace membership. WITH CHECK defaults to the USING expression, so
-- inserts must set a workspace_id the caller belongs to.
ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access forum_posts" ON forum_posts;
CREATE POLICY "workspace members can access forum_posts"
  ON forum_posts FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_forum_posts_updated_at
  BEFORE UPDATE ON forum_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Videos page (/videos). A curated gallery of real YouTube car-diagnosis
-- videos that we use as raw material for AI-generated marketing videos: the
-- workflow is discover → mark → summarize → generate a Veo 3 prompt that
-- recreates the diagnosis with a DIY car owner solving it via the Wrenchlane app.
--
-- One workspace-scoped table:
--   diagnostic_videos — one row per curated video. Seeded on a workspace's
--     first visit from src/lib/videos/seed.ts. `marked` is the user's "work
--     with this one" flag. `summary` and `veo3_prompt` are filled in later
--     (phase 2) for the videos the user marks.
--
-- The "top YouTubers" reference list is NOT in the DB — it lives in code
-- (src/lib/videos/channels.ts), the same way the reviews platform list does.

CREATE TABLE IF NOT EXISTS diagnostic_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  youtube_id TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  marked BOOLEAN NOT NULL DEFAULT FALSE,
  summary TEXT,
  veo3_prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, youtube_id)
);

CREATE INDEX IF NOT EXISTS idx_diagnostic_videos_workspace
  ON diagnostic_videos (workspace_id, sort_order);

-- RLS — mirror the roadmap tables: one FOR ALL policy gated on workspace
-- membership. WITH CHECK defaults to the USING expression, so inserts must
-- set a workspace_id the caller belongs to.
ALTER TABLE diagnostic_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access diagnostic_videos"
  ON diagnostic_videos;
CREATE POLICY "workspace members can access diagnostic_videos"
  ON diagnostic_videos FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_diagnostic_videos_updated_at
  BEFORE UPDATE ON diagnostic_videos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

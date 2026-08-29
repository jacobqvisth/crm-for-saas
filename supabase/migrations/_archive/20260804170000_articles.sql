-- Articles page (/articles). A content studio, sibling of /forums and /videos.
--
-- Forums turns real diagnostics into Reddit posts. Articles turns the same
-- underlying data into owned and broadcast content: LinkedIn posts, blog
-- articles, X threads, Facebook posts, newsletters. Reddit deliberately stays in
-- /forums, which already has per-subreddit tone rules and account personas.
--
-- Three grounding modes, tracked by source_kind:
--   diagnostic  -> one real diagnostic our engine ran (the case-study path)
--   stats       -> an aggregate stat story over analyseDtcCodes() /
--                  analyseSearchTerms(), e.g. "codes that travel together"
--   free_topic  -> no data grounding at all
--
-- source_snapshot freezes the grounding facts at generation time, for the same
-- reason forum_posts.scenario_snapshot does: dashboard_diagnostics is a synced
-- analytics table whose rows rotate out of the S3 export, so a soft reference
-- alone would leave orphaned drafts. There is deliberately no FK on source_ref.
--
-- claims is the honesty mechanism. The model self-declares the provenance of
-- every assertion it makes (data / user / knowledge / unsourced) and the UI
-- colour-codes them, because the competitor post that prompted this feature
-- asserts revenue and hours-saved figures we have no data source for. impact
-- holds the figures a human supplied; the model may never invent them.

CREATE TABLE IF NOT EXISTS articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- diagnostic | stats | free_topic
  source_kind TEXT NOT NULL DEFAULT 'free_topic',
  -- diagnostic_id, stat story key, or NULL for a free topic. No FK on purpose.
  source_ref TEXT,
  -- Frozen grounding facts (diagnostic snapshot, or the rendered stat fact pack).
  source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- linkedin_post | blog_article | x_thread | facebook_post | newsletter
  format TEXT NOT NULL,
  -- Full ArticleGenerationOptions (angle, audience, voice, length, brandLevel,
  -- cta, hashtags, language, dataStrictness).
  options JSONB NOT NULL DEFAULT '{}'::jsonb,
  language TEXT NOT NULL DEFAULT 'en',

  title TEXT,
  body TEXT,
  -- Alternative opening lines. body already starts with the selected one.
  hooks JSONB NOT NULL DEFAULT '[]'::jsonb,
  hashtags TEXT[] NOT NULL DEFAULT '{}',
  -- Blog only: metaTitle, metaDescription, slug, internalLinkIdeas.
  seo JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- [{ text, source: data|user|knowledge|unsourced }]
  claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Human-supplied impact figures, echoed back for audit.
  impact JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- draft | approved | published | archived
  status TEXT NOT NULL DEFAULT 'draft',
  published_url TEXT,
  published_at TIMESTAMPTZ,

  model TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_articles_workspace
  ON articles (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_format
  ON articles (workspace_id, format, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_status
  ON articles (workspace_id, status, created_at DESC);

-- RLS: shared team resource, same call as the forum_* tables. Any authenticated
-- CRM user sees the same library, so a login sitting in a different workspace
-- still reads and writes the shared board.
-- See 20260709000000_forums_shared_across_users.sql for the original reasoning.
ALTER TABLE articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "any authenticated user can access articles" ON articles;
CREATE POLICY "any authenticated user can access articles"
  ON articles FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_articles_updated_at ON articles;
CREATE TRIGGER update_articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

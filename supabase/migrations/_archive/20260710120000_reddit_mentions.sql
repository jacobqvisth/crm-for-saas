-- Forums → Wrenchlane exposure tracking. One row per detected Wrenchlane
-- footprint on Reddit: a link to a wrenchlane domain, or the word "wrenchlane"
-- in plaintext — posted either BY US (a roster account) or by a third party.
--
-- Phase 2 seeds only audience='us' rows from our own posted forum content (a
-- backfill, no external calls). Phase 3 adds a scan job (Apify) that upserts
-- third-party hits and refreshes traction; Phase 4 fills the AI enrichment
-- columns (sentiment/context/is_about_us) and Slack-alerts new third-party
-- mentions. Columns for those phases exist now so the scan/enrich code is a
-- pure write, no follow-up migration.
--
-- Shared team resource like the other forum_* tables: lives in the shared
-- forums workspace, RLS open to any authenticated user (see
-- 20260709000000_forums_shared_across_users.sql).

CREATE TABLE IF NOT EXISTS reddit_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- 'link' = a URL on a wrenchlane domain; 'plaintext' = the word "wrenchlane".
  kind TEXT NOT NULL DEFAULT 'plaintext',
  -- 'us' = author is one of our roster accounts; 'third_party' = anyone else.
  audience TEXT NOT NULL DEFAULT 'third_party',
  -- Permalink to the post or comment the mention lives in.
  source_url TEXT NOT NULL,
  subreddit TEXT,
  author TEXT,
  -- When audience='us', the roster account (soft link; unassign on delete).
  account_id UUID REFERENCES reddit_accounts(id) ON DELETE SET NULL,
  -- Which wrenchlane domain matched (for kind='link').
  matched_domain TEXT,
  -- Surrounding text so the UI can show context without another fetch.
  excerpt TEXT,
  -- True when the hit is in a comment rather than the post body.
  is_comment BOOLEAN NOT NULL DEFAULT FALSE,
  -- Live traction on the thread the mention sits in.
  score INTEGER,
  num_comments INTEGER,
  upvote_ratio NUMERIC,
  -- AI enrichment (Phase 4): sentiment/context/disambiguation of third-party hits.
  sentiment TEXT,        -- positive | neutral | negative | competitor
  context_tag TEXT,
  ai_summary TEXT,
  is_about_us BOOLEAN,   -- "wrenchlane" can be noise; NULL until reviewed
  -- Workflow: new → confirmed | dismissed (a human/AI gate before it counts).
  status TEXT NOT NULL DEFAULT 'new',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  slack_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent re-scans: one row per (source_url, author) in the workspace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reddit_mentions_source_author
  ON reddit_mentions (workspace_id, source_url, author);

CREATE INDEX IF NOT EXISTS idx_reddit_mentions_workspace
  ON reddit_mentions (workspace_id, audience, first_seen_at DESC);

ALTER TABLE reddit_mentions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "any authenticated user can access reddit_mentions" ON reddit_mentions;
CREATE POLICY "any authenticated user can access reddit_mentions"
  ON reddit_mentions FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_reddit_mentions_updated_at
  BEFORE UPDATE ON reddit_mentions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

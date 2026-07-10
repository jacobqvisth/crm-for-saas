-- Forums → Gap log auto-discovery. The Answer-posts "Find posts" scrape already
-- pulls real Reddit questions across the diagnostic subreddits. Instead of paying
-- for a second scrape, we classify those SAME posts for one extra signal: is this
-- a real "AI diagnosis went wrong" case (someone used ChatGPT / an OBD AI app, it
-- gave the wrong cause, they replaced the wrong part)? Those are gold for the Gap
-- log eval set.
--
-- A classified candidate is PERSISTED here (not thrown away with the ephemeral
-- search results) so a scrape's findings survive a reload and we never re-search
-- the same ground. Workflow mirrors reddit_mentions: new → confirmed | dismissed.
-- Confirming a candidate writes an ai_failure_stories row and links back via
-- story_id.
--
-- Shared team resource like the other forum_* tables: lives in the shared forums
-- workspace, RLS open to any authenticated user (see
-- 20260709000000_forums_shared_across_users.sql).

CREATE TABLE IF NOT EXISTS forum_gap_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- The source Reddit post, snapshotted so the review UI needs no re-fetch.
  source_url TEXT NOT NULL,
  source_subreddit TEXT,
  source_author TEXT,
  source_title TEXT,
  source_body TEXT,
  source_score INTEGER,
  source_num_comments INTEGER,

  -- What the classifier extracted (mirrors ai_failure_stories fields so a
  -- confirm is a straight copy). Only candidates it judged real are stored.
  confidence NUMERIC,               -- 0..1, model's confidence it's a real case
  symptom TEXT,                     -- what the car was doing
  ai_tool TEXT,                     -- which AI/chatbot/app they used
  ai_claimed_cause TEXT,            -- what the AI said was wrong
  action_taken TEXT,                -- the part they replaced / repair attempted
  cost_amount NUMERIC,              -- what the wrong turn cost them
  cost_currency TEXT DEFAULT 'USD',
  actual_cause TEXT,                -- the real root cause once found
  outcome TEXT DEFAULT 'failure',   -- failure | partial | success | unknown

  -- Workflow: new → confirmed | dismissed. On confirm we set story_id.
  status TEXT NOT NULL DEFAULT 'new',
  story_id UUID REFERENCES ai_failure_stories(id) ON DELETE SET NULL,

  model TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent re-scans: one candidate per source post per workspace. A repeat
-- scan that surfaces the same post upserts rather than duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_gap_candidates_source
  ON forum_gap_candidates (workspace_id, source_url);

CREATE INDEX IF NOT EXISTS idx_forum_gap_candidates_workspace
  ON forum_gap_candidates (workspace_id, status, first_seen_at DESC);

ALTER TABLE forum_gap_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "any authenticated user can access forum_gap_candidates" ON forum_gap_candidates;
CREATE POLICY "any authenticated user can access forum_gap_candidates"
  ON forum_gap_candidates FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_forum_gap_candidates_updated_at
  BEFORE UPDATE ON forum_gap_candidates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- ai_failure_stories: bring it in line with the rest of the forum board.
-- It was created with membership-gated RLS (20260709210000), which only works
-- because every CRM login happens to be a member of the shared workspace. The
-- other six forum tables were opened to any authenticated user in
-- 20260709000000_forums_shared_across_users.sql — do the same here so new
-- teammates (and the confirm-candidate write) don't silently fail.
DROP POLICY IF EXISTS "workspace members can access ai_failure_stories" ON ai_failure_stories;
DROP POLICY IF EXISTS "any authenticated user can access ai_failure_stories" ON ai_failure_stories;
CREATE POLICY "any authenticated user can access ai_failure_stories"
  ON ai_failure_stories FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- Confirming a candidate should not create a duplicate story if it (or a manual
-- log) already covers the same source post. Partial: hand-logged stories with no
-- source_url are still allowed to repeat.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_failure_stories_source
  ON ai_failure_stories (workspace_id, source_url)
  WHERE source_url IS NOT NULL;

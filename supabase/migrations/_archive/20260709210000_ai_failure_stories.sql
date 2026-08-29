-- Forums → Gap log (/forums/gaps). The "would we have done better?" loop.
--
-- When we post the "AI repair horror stories" topic and people reply with the
-- time an AI diagnosis sent them the wrong way, each reply is a real diagnostic
-- case with a KNOWN outcome: what the car was doing, what the AI claimed, what
-- part they replaced, and what it actually turned out to be. That is a gold
-- eval set. This table captures those stories so we can later run the same
-- symptoms through Wrenchlane / AskMercedesAI and score whether we would have
-- caught what the other AI missed.
--
-- One workspace-scoped table: ai_failure_stories.

CREATE TABLE IF NOT EXISTS ai_failure_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Where the story came from (usually a Reddit thread/comment).
  source_url TEXT,
  source_subreddit TEXT,
  source_author TEXT,

  -- The case itself.
  symptom TEXT NOT NULL,            -- what the car was doing
  ai_tool TEXT,                     -- which AI/chatbot/app they used
  ai_claimed_cause TEXT,            -- what the AI said was wrong
  action_taken TEXT,                -- the part they replaced / repair attempted
  cost_amount NUMERIC,              -- what the wrong turn cost them
  cost_currency TEXT DEFAULT 'USD',
  actual_cause TEXT,                -- the real root cause once found

  -- How the AI attempt turned out.
  -- failure | partial | success | unknown
  outcome TEXT NOT NULL DEFAULT 'failure',

  -- Our R&D verdict: would Wrenchlane have done better on this case?
  -- not_reviewed | would_have_caught | would_have_missed | unsure
  our_verdict TEXT NOT NULL DEFAULT 'not_reviewed',
  our_notes TEXT,                   -- reasoning: would we have caught it, and why

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_failure_stories_workspace
  ON ai_failure_stories (workspace_id, created_at DESC);

-- RLS — mirror forum_distribution: one FOR ALL policy gated on membership.
ALTER TABLE ai_failure_stories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access ai_failure_stories" ON ai_failure_stories;
CREATE POLICY "workspace members can access ai_failure_stories"
  ON ai_failure_stories FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_ai_failure_stories_updated_at
  BEFORE UPDATE ON ai_failure_stories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

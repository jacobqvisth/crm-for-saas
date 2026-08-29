-- Store what the receptionist could not answer, so the knowledge base improves
-- from real calls rather than from guesses about what callers might ask.
--
-- The first thirteen switchboard calls stored no transcript at all: the bridge
-- never recorded which provider conversation a call was, so everything the agent
-- said lived only at the provider and was invisible here. The bridge now records
-- it and a collector cron pulls the transcript in; these columns hold the result.

ALTER TABLE switchboard_calls
  -- Questions the caller asked that the agent could not answer from its knowledge,
  -- extracted from the transcript. This list IS the knowledge backlog.
  ADD COLUMN unanswered TEXT[],
  -- When the collector last processed this call, so it is not re-analysed on every
  -- tick and a failure can be retried without reprocessing everything.
  ADD COLUMN collected_at TIMESTAMPTZ;

-- The collector claims work with "ended, has a conversation id, not collected yet".
CREATE INDEX idx_switchboard_calls_uncollected
  ON switchboard_calls (created_at)
  WHERE collected_at IS NULL AND provider_conversation_id IS NOT NULL;

COMMENT ON COLUMN switchboard_calls.unanswered IS
  'Questions the receptionist could not answer on this call. Aggregated on the Phone System page as the knowledge backlog.';

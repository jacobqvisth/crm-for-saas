-- Forum candidates: stop assuming Reddit.
--
-- forum_candidates was built when Reddit was the only place we answered
-- questions, so the identity of a row is `reddit_id` and the dedup key is
-- (workspace_id, reddit_id). That shape blocks every other forum: Garaget
-- topic 352437 and a Reddit post cannot both live here without one of them
-- lying about what it is.
--
-- This generalises the row identity to (platform, external_id) and leaves the
-- Reddit columns in place, still populated for Reddit rows. Nothing is dropped
-- and nothing is rewritten, so a deploy that lands before this migration keeps
-- reading and writing exactly as it did.
--
--   platform     'reddit' | 'garaget'. Defaulted so existing rows are correct
--                without a backfill pass.
--   external_id  the platform's own id for the thread. Backfilled from
--                reddit_id, which is why it can go NOT NULL immediately.
--   board        the generic slot for `subreddit`: a subreddit name on Reddit,
--                a numeric board id on Garaget.
--   url          already generic, already the thing a human clicks.
--
-- The Reddit-shaped `subreddit` column stays as the display value the client
-- already reads; `board` is what platform-agnostic code keys on.

ALTER TABLE forum_candidates
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'reddit';

ALTER TABLE forum_candidates
  ADD COLUMN IF NOT EXISTS external_id TEXT;

ALTER TABLE forum_candidates
  ADD COLUMN IF NOT EXISTS board TEXT;

-- Backfill before the NOT NULL: every pre-existing row is a Reddit row, and
-- its reddit_id is exactly the external id we now want.
UPDATE forum_candidates
SET external_id = reddit_id
WHERE external_id IS NULL AND reddit_id IS NOT NULL;

UPDATE forum_candidates
SET board = subreddit
WHERE board IS NULL AND subreddit IS NOT NULL;

-- Any row that somehow has neither is unusable as a queue entry; drop it
-- rather than carry a row we can never dedupe or link back to a thread.
DELETE FROM forum_candidates WHERE external_id IS NULL;

ALTER TABLE forum_candidates
  ALTER COLUMN external_id SET NOT NULL;

-- reddit_id is now Reddit-only, so it has to be nullable for Garaget rows.
ALTER TABLE forum_candidates
  ALTER COLUMN reddit_id DROP NOT NULL;

ALTER TABLE forum_candidates
  DROP CONSTRAINT IF EXISTS forum_candidates_platform_check;
ALTER TABLE forum_candidates
  ADD CONSTRAINT forum_candidates_platform_check
  CHECK (platform IN ('reddit', 'garaget'));

-- The new identity. Created before the old one is dropped so there is never a
-- window without a uniqueness guarantee on the upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_candidates_platform_external
  ON forum_candidates (workspace_id, platform, external_id);

DROP INDEX IF EXISTS uq_forum_candidates_reddit;

-- The queue reads "open questions on this platform, newest first".
CREATE INDEX IF NOT EXISTS idx_forum_candidates_platform_status
  ON forum_candidates (workspace_id, platform, status, posted_at DESC);

COMMENT ON COLUMN forum_candidates.platform IS
  'Which forum this question came from: reddit | garaget.';
COMMENT ON COLUMN forum_candidates.external_id IS
  'The platform''s own thread id. Reddit base-36 post id, or a Garaget topic id.';
COMMENT ON COLUMN forum_candidates.board IS
  'Platform-agnostic board key: subreddit name on Reddit, board id on Garaget.';

-- forum_replies records which thread a draft answers, and its source_subreddit
-- column carries the same Reddit assumption. Same treatment: add the platform,
-- default it correctly, leave the existing column alone.
ALTER TABLE forum_replies
  ADD COLUMN IF NOT EXISTS source_platform TEXT NOT NULL DEFAULT 'reddit';

ALTER TABLE forum_replies
  DROP CONSTRAINT IF EXISTS forum_replies_source_platform_check;
ALTER TABLE forum_replies
  ADD CONSTRAINT forum_replies_source_platform_check
  CHECK (source_platform IN ('reddit', 'garaget'));

COMMENT ON COLUMN forum_replies.source_platform IS
  'Which forum the answered thread lives on: reddit | garaget.';

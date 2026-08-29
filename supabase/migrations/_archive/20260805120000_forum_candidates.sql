-- Forums → Answer posts: a PERSISTENT queue of candidate questions.
--
-- Before this, "Find posts" results lived only in React state in
-- answers-client.tsx: reload the page and every post you hadn't drafted a reply
-- to was gone. That made the page re-run the Apify scrape (one actor run per
-- subreddit, ~2 min cold, real money on a $5/mo cap) just to see posts we had
-- already fetched, and gave no way to tell a question you'd already rejected
-- from a genuinely new one.
--
-- Each discovered Reddit post is now one row here, upserted on
-- (workspace_id, reddit_id) so re-searching refreshes rather than duplicates.
-- `status` is what makes it a worklist instead of a log:
--   new      → still open, show it in the queue
--   answered → we drafted a reply (reply_id points at the forum_replies row)
--   skipped  → deliberately passed on; stays greyed out so it stops coming back
--
-- Shared team resource like the other forum_* tables: lives in the shared
-- forums workspace, RLS open to any authenticated user (see
-- 20260709000000_forums_shared_across_users.sql).

CREATE TABLE IF NOT EXISTS forum_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Reddit's base-36 post id ("1abc2de"), the dedup key. `fullname` is the
  -- t3_-prefixed form the traction reads want.
  reddit_id TEXT NOT NULL,
  fullname TEXT,
  subreddit TEXT,
  -- Snapshot of the question, so the queue stands on its own even if the
  -- original is edited or deleted (same reasoning as forum_replies.source_*).
  title TEXT NOT NULL,
  body TEXT,
  author TEXT,
  url TEXT,
  -- The source post's own traction, refreshed whenever we see it again.
  score INT,
  num_comments INT,
  -- When it was posted to Reddit (from the scrape's created_utc). Drives the
  -- "last 14 days" default window: a three-week-old question is a bad target.
  posted_at TIMESTAMPTZ,
  -- new | answered | skipped
  status TEXT NOT NULL DEFAULT 'new',
  -- Set when a reply gets drafted from this candidate. Soft link: dropping the
  -- draft returns the question to the queue rather than deleting the row.
  reply_id UUID REFERENCES forum_replies(id) ON DELETE SET NULL,
  skipped_reason TEXT,
  -- search | cron | backfill — how we most recently came across it, plus the
  -- query/sort that surfaced it (provenance for "why is this here?").
  discovered_via TEXT NOT NULL DEFAULT 'search',
  search_query TEXT,
  search_sort TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent re-discovery: one row per Reddit post in the workspace. The
-- upsert in /api/forums/replies/discover/status targets this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_candidates_reddit
  ON forum_candidates (workspace_id, reddit_id);

-- The queue read: status-filtered, newest question first.
CREATE INDEX IF NOT EXISTS idx_forum_candidates_queue
  ON forum_candidates (workspace_id, status, posted_at DESC);

ALTER TABLE forum_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "any authenticated user can access forum_candidates" ON forum_candidates;
CREATE POLICY "any authenticated user can access forum_candidates"
  ON forum_candidates FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_forum_candidates_updated_at ON forum_candidates;
CREATE TRIGGER update_forum_candidates_updated_at
  BEFORE UPDATE ON forum_candidates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Backfill: every post we already drafted a reply to becomes an `answered`
-- candidate, so the queue opens with real history instead of empty. DISTINCT ON
-- because a post can have several drafts and reddit_id is unique per workspace;
-- keep the oldest draft as the link.
INSERT INTO forum_candidates (
  workspace_id, reddit_id, fullname, subreddit, title, body, author, url,
  score, num_comments, status, reply_id, discovered_via, first_seen_at, last_seen_at
)
SELECT DISTINCT ON (r.workspace_id, substring(r.source_url from '/comments/([a-z0-9]+)'))
  r.workspace_id,
  substring(r.source_url from '/comments/([a-z0-9]+)') AS reddit_id,
  't3_' || substring(r.source_url from '/comments/([a-z0-9]+)') AS fullname,
  r.source_subreddit,
  COALESCE(NULLIF(r.source_title, ''), '(untitled post)'),
  r.source_body,
  r.source_author,
  r.source_url,
  r.source_score,
  r.source_num_comments,
  'answered',
  r.id,
  'backfill',
  r.created_at,
  r.created_at
FROM forum_replies r
WHERE r.source_url IS NOT NULL
  AND substring(r.source_url from '/comments/([a-z0-9]+)') IS NOT NULL
ORDER BY
  r.workspace_id,
  substring(r.source_url from '/comments/([a-z0-9]+)'),
  r.created_at ASC
ON CONFLICT (workspace_id, reddit_id) DO NOTHING;

-- Forums → contributor tracking. We now record who ACTUALLY contributed to a
-- posted forum item, from two trustworthy signals:
--   1. reddit_detected — their roster Reddit handle shows up as a commenter on
--      the actual Reddit thread (read via Apify). Authoritative.
--   2. slack_reaction  — they ✅'d their own comment in the #forum-posts thread.
--
-- `confirmed_via` gains 'reddit_detected'. We also stash the matched Reddit
-- comment permalink + author on the assignment, and give each board a slot for
-- a live "contributors so far" summary message we keep updated in the thread.

-- Widen the confirmed_via check to allow the new signal.
ALTER TABLE forum_comment_assignments
  DROP CONSTRAINT IF EXISTS forum_comment_assignments_confirmed_via_check;
ALTER TABLE forum_comment_assignments
  ADD CONSTRAINT forum_comment_assignments_confirmed_via_check
  CHECK (confirmed_via IN ('crm', 'slack_reaction', 'reddit_detected'));

ALTER TABLE forum_comment_assignments
  ADD COLUMN IF NOT EXISTS reddit_comment_url TEXT,
  ADD COLUMN IF NOT EXISTS detected_author TEXT;

-- The "contributors so far" summary message we post + edit in the Slack thread.
ALTER TABLE forum_distribution
  ADD COLUMN IF NOT EXISTS slack_summary_ts TEXT,
  ADD COLUMN IF NOT EXISTS slack_summary_channel TEXT;

ALTER TABLE forum_posts
  ADD COLUMN IF NOT EXISTS slack_summary_ts TEXT,
  ADD COLUMN IF NOT EXISTS slack_summary_channel TEXT;

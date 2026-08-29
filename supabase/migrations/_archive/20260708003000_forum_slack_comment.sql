-- Forums → Slack fan-out. When a forum post is marked *posted* in the CRM (on
-- either the Distribution board or the post generator), we post it to the Slack
-- channel #forum-posts so the team can open it and comment from their own Reddit
-- accounts. Alongside the link we send an AI-drafted reply they can paste.
--
-- Two columns on each forum table:
--   suggested_comment  — the drafted Reddit reply (generated once, reusable).
--   slack_notified_at  — set when we've posted to Slack, so we don't re-notify
--                        on every subsequent save/refresh.

ALTER TABLE forum_distribution
  ADD COLUMN IF NOT EXISTS suggested_comment TEXT,
  ADD COLUMN IF NOT EXISTS slack_notified_at TIMESTAMPTZ;

ALTER TABLE forum_posts
  ADD COLUMN IF NOT EXISTS suggested_comment TEXT,
  ADD COLUMN IF NOT EXISTS slack_notified_at TIMESTAMPTZ;

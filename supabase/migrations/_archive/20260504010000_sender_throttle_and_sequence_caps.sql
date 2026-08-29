-- Throttle + cap knobs for sending pipeline.
--   - gmail_accounts.min_send_interval_seconds: per-sender minimum gap between
--     two outgoing sends. Replaces the old hard-coded 60s constant in send.ts
--     so warm inboxes can be paced more conservatively (e.g. 300s) while fresh
--     ones stay at 60s.
--   - sequence.settings.daily_limit_total lives in the existing JSONB column,
--     no DDL needed. UI + send pipeline read it via SequenceSettings type.

ALTER TABLE gmail_accounts
  ADD COLUMN min_send_interval_seconds INTEGER NOT NULL DEFAULT 60;

COMMENT ON COLUMN gmail_accounts.min_send_interval_seconds IS
  'Minimum seconds between two sends from this Gmail account. Enforced in src/lib/gmail/send.ts. Default 60.';

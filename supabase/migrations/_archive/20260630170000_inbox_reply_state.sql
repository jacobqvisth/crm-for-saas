-- Inbox reply-workflow state.
--
-- Gives the inbox three workflow tabs ("Needs reply", "Started replying",
-- "Recently answered") a clean source of truth, instead of inferring reply
-- state from the activities stream on every load.
--
-- Why not reuse draft_en? That column is the AI auto-draft *cache* — it gets
-- populated automatically for every non-English message the moment the thread
-- is opened, so it does NOT mean "a human started replying". reply_draft is the
-- human-intent draft: it's only written when the user actually edits the
-- composer, and cleared when the reply is sent.

ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS replied_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply_draft            TEXT,
  ADD COLUMN IF NOT EXISTS reply_draft_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN inbox_messages.replied_at IS 'When a reply was sent in this thread. Set thread-wide on send + backfilled from email_sent activities. NULL = still needs a reply.';
COMMENT ON COLUMN inbox_messages.reply_draft IS 'Human-composed reply-in-progress (English). Autosaved as the user types, cleared on send. Distinct from draft_en (the AI auto-draft cache).';
COMMENT ON COLUMN inbox_messages.reply_draft_updated_at IS 'When reply_draft was last autosaved.';

-- Backfill replied_at: a message is "answered" if a reply went out in its
-- thread at or after it arrived. The reply route + mailbox-sync cron both log
-- outbound mail as email_sent activities carrying the gmail_thread_id.
UPDATE inbox_messages im
SET replied_at = sub.replied_at
FROM (
  SELECT
    metadata->>'gmail_thread_id' AS thread,
    MIN(created_at)              AS replied_at
  FROM activities
  WHERE type = 'email_sent'
    AND metadata->>'gmail_thread_id' IS NOT NULL
  GROUP BY 1
) sub
WHERE im.replied_at IS NULL
  AND im.gmail_thread_id = sub.thread
  AND sub.replied_at >= im.received_at;

-- "Needs reply" / "Started replying" both scan unanswered rows; "Recently
-- answered" scans answered rows newest-first. Partial indexes keep each tab cheap.
CREATE INDEX IF NOT EXISTS inbox_messages_needs_reply_idx
  ON inbox_messages (workspace_id, received_at DESC)
  WHERE replied_at IS NULL;

CREATE INDEX IF NOT EXISTS inbox_messages_answered_idx
  ON inbox_messages (workspace_id, replied_at DESC)
  WHERE replied_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS inbox_messages_draft_idx
  ON inbox_messages (workspace_id, reply_draft_updated_at DESC)
  WHERE reply_draft IS NOT NULL;

-- Mailbox sync — backfill + ongoing logging of ALL correspondence between
-- connected team mailboxes and CRM contacts (HubSpot-style email logging, but
-- server-side via the Gmail OAuth we already hold — no browser plugin / BCC).
--
-- The check-replies cron only ingests replies to *sequence* emails. This adds a
-- general mailbox-sync cron that walks each connected Gmail account's full
-- history (and then incrementally), matches both inbound and outbound messages
-- to contacts, and logs them as `email_received` / `email_sent` activities so
-- they show up on the contact timeline.
--
-- Idempotency:
--   * Inbound messages reuse inbox_messages.gmail_message_id (already UNIQUE) —
--     a freshly-inserted row gates the activity, which also dedups against
--     check-replies (it writes the same inbox_messages rows).
--   * Outbound (and the activity safety-net) use the partial unique index below
--     on activities(metadata->>'gmail_message_id') for mailbox-synced rows.

-- 1. Per-account sync cursor / position.
CREATE TABLE IF NOT EXISTS gmail_sync_state (
  gmail_account_id  UUID        PRIMARY KEY REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  workspace_id      UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Backfill walks history newest→oldest via messages.list pageTokens.
  backfill_cursor   TEXT,                 -- next pageToken; NULL once exhausted
  backfill_done_at  TIMESTAMPTZ,          -- set when the full history has been walked
  -- Incremental: only messages newer than this are fetched after backfill.
  last_synced_at    TIMESTAMPTZ,
  last_run_at       TIMESTAMPTZ,
  messages_synced   INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gmail_sync_state_workspace_id_idx
  ON gmail_sync_state(workspace_id);

ALTER TABLE gmail_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_can_access_gmail_sync_state"
  ON gmail_sync_state
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_gmail_sync_state_updated_at
  BEFORE UPDATE ON gmail_sync_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Idempotency guard for mailbox-synced activities. A unique violation (23505)
--    on insert means we've already logged this Gmail message — the cron swallows
--    it. Partial so it only constrains mailbox-sync rows, never the rest of the
--    activity stream.
CREATE UNIQUE INDEX IF NOT EXISTS activities_mailbox_sync_gmail_msg_uniq
  ON activities ((metadata->>'gmail_message_id'))
  WHERE metadata->>'synced_from' = 'mailbox_sync';

-- 3. Speeds up the "is this outbound message already a sequence send?" lookup
--    (and the existing bounce-matching path in check-replies).
CREATE INDEX IF NOT EXISTS email_queue_gmail_message_id_idx
  ON email_queue(gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

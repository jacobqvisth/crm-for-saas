-- Add gmail_thread_id to email_queue
ALTER TABLE email_queue ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT;

-- Create inbox_messages table
CREATE TABLE IF NOT EXISTS inbox_messages (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  gmail_account_id  UUID        NOT NULL REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  gmail_message_id  TEXT        NOT NULL UNIQUE,
  gmail_thread_id   TEXT        NOT NULL,
  email_queue_id    UUID        REFERENCES email_queue(id) ON DELETE SET NULL,
  contact_id        UUID        REFERENCES contacts(id) ON DELETE SET NULL,
  from_email        TEXT        NOT NULL,
  from_name         TEXT,
  subject           TEXT,
  body_html         TEXT,
  body_text         TEXT,
  received_at       TIMESTAMPTZ NOT NULL,
  is_read           BOOLEAN     NOT NULL DEFAULT FALSE,
  category          TEXT        NOT NULL DEFAULT 'uncategorized',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inbox_messages_workspace_id_idx ON inbox_messages(workspace_id);
CREATE INDEX IF NOT EXISTS inbox_messages_contact_id_idx ON inbox_messages(contact_id);
CREATE INDEX IF NOT EXISTS inbox_messages_gmail_thread_id_idx ON inbox_messages(gmail_thread_id);
CREATE INDEX IF NOT EXISTS inbox_messages_received_at_idx ON inbox_messages(received_at DESC);

ALTER TABLE inbox_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_can_access_inbox_messages"
  ON inbox_messages
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_inbox_messages_updated_at
  BEFORE UPDATE ON inbox_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

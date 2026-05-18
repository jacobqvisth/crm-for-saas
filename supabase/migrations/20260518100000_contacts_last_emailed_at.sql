-- Add last_emailed_at to contacts.
-- Source of truth: email_queue.status='sent' (i.e. the row was actually handed to Gmail's outbound API).
-- Updated by src/app/api/cron/process-emails/route.ts when flipping a queue row to 'sent'.
-- Used by the /contacts page "engagement" filter (Never emailed / Emailed) and as a "last sent" column.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_emailed_at timestamp with time zone;

-- Partial index: only ~1.9k of 12k contacts have ever been emailed; full index is wasteful.
CREATE INDEX IF NOT EXISTS contacts_workspace_last_emailed_at_idx
  ON contacts (workspace_id, last_emailed_at)
  WHERE last_emailed_at IS NOT NULL;

-- IS NULL filter (never emailed) — supports the most common query path.
CREATE INDEX IF NOT EXISTS contacts_workspace_never_emailed_idx
  ON contacts (workspace_id)
  WHERE last_emailed_at IS NULL;

COMMENT ON COLUMN contacts.last_emailed_at IS
  'Last time an email was actually sent to this contact (email_queue.sent_at where status=sent). NULL = never emailed.';

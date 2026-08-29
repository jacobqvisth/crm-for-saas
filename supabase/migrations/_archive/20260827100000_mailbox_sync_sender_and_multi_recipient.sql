-- Mailbox sync, round two: make a rep's own Gmail sends legible on the contact
-- timeline, and stop dropping recipients.
--
-- Two problems this fixes:
--
--   1. `mailbox-sync` never wrote `sender_name` / `sender_email` into the
--      activity metadata (only the opaque `gmail_account_id`). The contact
--      timeline renders "Email sent by <name>" off exactly those two keys, so
--      every email a rep sent from the Gmail web app showed up as an anonymous
--      "Email sent: ..." and read like system mail. The cron now stamps them;
--      this migration repairs the rows already logged.
--
--   2. The idempotency index allowed ONE activity per Gmail message, full stop.
--      A mail addressed to three CRM contacts could therefore only ever land on
--      one timeline. Widening the key to (message, contact) lets the cron log
--      the message once per recipient while still being safe to re-run.

-- 1. Widen the dedup key to (gmail message, contact).
--    COALESCE keeps the key total: a NULL contact_id would otherwise slip past
--    the unique constraint entirely and let the same message re-insert forever.
DROP INDEX IF EXISTS activities_mailbox_sync_gmail_msg_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS activities_mailbox_sync_gmail_msg_contact_uniq
  ON activities ((metadata->>'gmail_message_id'), COALESCE(contact_id::text, ''))
  WHERE metadata->>'synced_from' = 'mailbox_sync';

-- 2. Backfill the sender identity on already-synced OUTBOUND rows. The mailbox
--    is already recorded as metadata.gmail_account_id, so this is a pure join —
--    no Gmail round-trip needed.
UPDATE activities a
SET metadata = a.metadata
  || jsonb_build_object(
       'sender_email', g.email_address,
       'sender_name', g.display_name
     )
FROM gmail_accounts g
WHERE a.metadata->>'synced_from' = 'mailbox_sync'
  AND a.type = 'email_sent'
  AND a.metadata->>'gmail_account_id' = g.id::text
  AND a.metadata->>'sender_email' IS NULL;

-- 3. Same idea for INBOUND: record which of our mailboxes received the message.
UPDATE activities a
SET metadata = a.metadata || jsonb_build_object('mailbox_email', g.email_address)
FROM gmail_accounts g
WHERE a.metadata->>'synced_from' = 'mailbox_sync'
  AND a.type = 'email_received'
  AND a.metadata->>'gmail_account_id' = g.id::text
  AND a.metadata->>'mailbox_email' IS NULL;

-- 4. Inbound rows were all stamped with the literal subject "Email received",
--    so the timeline rendered "Reply received: Email received". The real
--    subject was sitting in inbox_messages the whole time — copy it across.
UPDATE activities a
SET subject = COALESCE(NULLIF(TRIM(m.subject), ''), '(no subject)')
FROM inbox_messages m
WHERE a.metadata->>'synced_from' = 'mailbox_sync'
  AND a.type = 'email_received'
  AND a.subject = 'Email received'
  AND a.metadata->>'gmail_message_id' = m.gmail_message_id;

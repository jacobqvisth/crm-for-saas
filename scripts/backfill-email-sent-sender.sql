-- Backfill activities.metadata with sender info for historic email_sent rows.
--
-- Looks up the email_queue row referenced by metadata->>'email_queue_id',
-- then merges sender_account_id / sender_email / sender_name from
-- gmail_accounts into the activity's metadata.
--
-- Run via psql or Supabase SQL editor. Idempotent — re-running is a no-op
-- once a row already has sender_email set.

UPDATE activities a
SET metadata = COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object(
  'sender_account_id', q.sender_account_id,
  'sender_email',      g.email_address,
  'sender_name',       g.display_name
)
FROM email_queue q
JOIN gmail_accounts g ON g.id = q.sender_account_id
WHERE a.type = 'email_sent'
  AND a.metadata ? 'email_queue_id'
  AND (a.metadata->>'email_queue_id')::uuid = q.id
  AND NOT (a.metadata ? 'sender_email');

-- Reply activities (inbox replies) store inbox_message_id; pull the
-- sender_account_id via the inbox_messages → email_queue chain.
UPDATE activities a
SET metadata = COALESCE(a.metadata, '{}'::jsonb) || jsonb_build_object(
  'sender_account_id', q.sender_account_id,
  'sender_email',      g.email_address,
  'sender_name',       g.display_name
)
FROM inbox_messages im
JOIN email_queue q     ON q.id = im.email_queue_id
JOIN gmail_accounts g  ON g.id = q.sender_account_id
WHERE a.type = 'email_sent'
  AND a.metadata ? 'inbox_message_id'
  AND (a.metadata->>'inbox_message_id')::uuid = im.id
  AND NOT (a.metadata ? 'sender_email');

-- App signup date on contacts, so smart call lists can filter on
-- "days since signup" without a join. Source of truth is
-- dashboard_users.signed_up_at (817/819 populated); the hourly
-- propagate-to-crm sync keeps it fresh, this backfills the start state.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS signed_up_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS contacts_signed_up_at_idx
  ON contacts (workspace_id, signed_up_at)
  WHERE signed_up_at IS NOT NULL;

UPDATE contacts c
SET signed_up_at = u.signed_up_at
FROM dashboard_users u
WHERE c.wl_user_id IS NOT NULL
  AND u.internal_user_id = c.wl_user_id::text
  AND u.signed_up_at IS NOT NULL
  AND c.signed_up_at IS DISTINCT FROM u.signed_up_at;

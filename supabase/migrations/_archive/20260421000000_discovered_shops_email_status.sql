-- Add email verification status columns to discovered_shops.
-- email_valid (bool) is kept for backward compat — a later migration can drop it.

ALTER TABLE discovered_shops
  ADD COLUMN IF NOT EXISTS email_status TEXT,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Backfill legacy bool → text so the "Verified email" filter keeps working after cutover.
UPDATE discovered_shops SET email_status = 'valid'   WHERE email_valid = true;
UPDATE discovered_shops SET email_status = 'invalid' WHERE email_valid = false;

CREATE INDEX IF NOT EXISTS discovered_shops_email_status_idx
  ON discovered_shops (email_status);

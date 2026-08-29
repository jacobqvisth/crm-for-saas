-- Forums → Distribution: track WHICH Reddit account posted each placement.
--
-- The team posts manually from their own Reddit accounts (roster lives in
-- reddit_accounts). Until now a marked-posted row only stored the URL, not who
-- posted it. Two new columns close that gap:
--   posted_by_account_id — the roster account the poster picked when marking it
--                          posted (nullable; SET NULL if the account is deleted)
--   posted_by_username   — the actual Reddit author handle, auto-captured from
--                          Reddit's JSON on traction refresh (source of truth,
--                          and a cross-check against the picked account)

ALTER TABLE forum_distribution
  ADD COLUMN IF NOT EXISTS posted_by_account_id UUID
    REFERENCES reddit_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_by_username TEXT;

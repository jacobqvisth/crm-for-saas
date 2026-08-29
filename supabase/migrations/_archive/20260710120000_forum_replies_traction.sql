-- Forums → Answer posts (/forums/answers): bring the Distribution board's two
-- power features to drafted replies —
--   1. "who posted it": which teammate's Reddit account the reply went out from
--   2. traction: how our reply is doing once it's live (upvotes + comments)
--
-- Until now a forum_replies row only tracked the source question's traction
-- (source_score / source_num_comments) and, on posting, a bare URL. These
-- columns mirror forum_distribution so the Answers UI can reuse the same
-- author-picker + refresh/manual-traction flow.
--
--   posted_by_account_id — roster account the poster picked when marking posted
--                          (nullable; SET NULL if the account is deleted)
--   posted_by_username   — the actual Reddit author handle, auto-captured from
--                          Reddit's JSON on traction refresh (source of truth)
--   score / num_comments / upvote_ratio — live traction on OUR reply's comment
--   traction_note        — human/last-error note when auto-fetch is blocked
--   last_checked_at      — when we last pulled traction

ALTER TABLE forum_replies
  ADD COLUMN IF NOT EXISTS posted_by_account_id UUID
    REFERENCES reddit_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_by_username TEXT,
  ADD COLUMN IF NOT EXISTS score INT,
  ADD COLUMN IF NOT EXISTS num_comments INT,
  ADD COLUMN IF NOT EXISTS upvote_ratio NUMERIC,
  ADD COLUMN IF NOT EXISTS traction_note TEXT,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

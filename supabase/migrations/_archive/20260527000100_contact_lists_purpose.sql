-- Distinguish lists built for phone outreach from regular email/segment
-- lists, so the new /calls page can show only calling lists while every
-- existing list keeps working unchanged. Reuses contact_lists +
-- contact_list_members wholesale; this is the only schema change needed.
--
-- 'email' (default) covers all pre-existing lists. 'calling' lists are
-- surfaced on the Calls page. Kept as free TEXT (not an enum) so we can
-- add purposes later without a migration.

ALTER TABLE contact_lists
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'email';

CREATE INDEX IF NOT EXISTS contact_lists_purpose_idx
  ON contact_lists (workspace_id, purpose);

-- Progress tracking on roadmap items, written by the AI "Update" button
-- (/api/roadmap/suggest-updates → apply). progress_note is a short, concrete
-- summary of what's actually been done, inferred from internal CRM data;
-- progress_updated_at stamps when that note was last set.

ALTER TABLE roadmap_items
  ADD COLUMN IF NOT EXISTS progress_note TEXT,
  ADD COLUMN IF NOT EXISTS progress_updated_at TIMESTAMPTZ;

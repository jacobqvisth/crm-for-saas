-- ==========================================================================
-- 20260423000001_extend_public_status_check.sql
-- Phase SE-Stockholm-5: extend contractor_directory.public_status CHECK
-- to allow Phase 5 values ('published', 'pending') alongside legacy trio.
-- Applied to Kundbolaget: ugibcnidxrhcxflqamxs
-- ==========================================================================

ALTER TABLE contractor_directory DROP CONSTRAINT IF EXISTS contractor_directory_public_status_check;
ALTER TABLE contractor_directory ADD CONSTRAINT contractor_directory_public_status_check
  CHECK (public_status = ANY (ARRAY['published'::text, 'pending'::text, 'listed'::text, 'suppressed'::text, 'pending_review'::text]));

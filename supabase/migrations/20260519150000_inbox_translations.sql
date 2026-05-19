-- Inbox message translation columns.
--
-- Auto-translates non-English replies at receipt-time so Jacob can read the inbox
-- in English without losing the original. Populated by the check-replies cron
-- (and a one-off backfill script for historic rows).

ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS detected_language TEXT,
  ADD COLUMN IF NOT EXISTS subject_translated_en TEXT,
  ADD COLUMN IF NOT EXISTS body_translated_en TEXT,
  ADD COLUMN IF NOT EXISTS translation_model TEXT;

COMMENT ON COLUMN inbox_messages.detected_language IS 'ISO 639-1 code of the source language (en, sv, lv, lt, et, fi, da, no, …). NULL = not yet processed.';
COMMENT ON COLUMN inbox_messages.subject_translated_en IS 'English translation of subject. NULL when detected_language=en or translation failed.';
COMMENT ON COLUMN inbox_messages.body_translated_en IS 'English translation of body_html (HTML preserved). NULL when detected_language=en or translation failed.';
COMMENT ON COLUMN inbox_messages.translation_model IS 'Model used for the translation (audit trail, e.g. claude-haiku-4-5-20251001).';

-- Partial index for the backfill script and any future "needs translation" sweep.
CREATE INDEX IF NOT EXISTS inbox_messages_needs_translation_idx
  ON inbox_messages (received_at DESC)
  WHERE detected_language IS NULL;

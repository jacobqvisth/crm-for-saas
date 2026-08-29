-- Phase 15: Sequence Reliability & Stop Logic
-- Add is_auto_reply column to inbox_messages
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS is_auto_reply boolean DEFAULT false;

-- No migration needed for SequenceSettings changes (JSON column)
-- No migration needed for enrollment status values (text column, not enum)

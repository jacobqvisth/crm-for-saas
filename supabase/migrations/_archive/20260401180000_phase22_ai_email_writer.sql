-- Add daily generation tracking to the existing workspace_ai_settings table
ALTER TABLE workspace_ai_settings
  ADD COLUMN IF NOT EXISTS daily_email_gen_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_email_gen_date DATE;

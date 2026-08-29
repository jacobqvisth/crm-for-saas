-- Phase 18: Contact Data Model Upgrade
-- Adds real queryable columns to contacts and companies, backfills from custom_fields

-- contacts: add new real columns
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS seniority TEXT,
  ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- companies: add new real columns
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS tech_stack TEXT[],
  ADD COLUMN IF NOT EXISTS revenue_range TEXT,
  ADD COLUMN IF NOT EXISTS founded_year INTEGER,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- companies: partial unique index on domain (NULLs are exempt)
CREATE UNIQUE INDEX IF NOT EXISTS companies_domain_workspace_unique
  ON companies (workspace_id, domain)
  WHERE domain IS NOT NULL;

-- Backfill contacts: copy from custom_fields into new real columns (additive only)
UPDATE contacts
SET
  title        = NULLIF(TRIM(custom_fields->>'title'), ''),
  city         = NULLIF(TRIM(custom_fields->>'city'), ''),
  country      = NULLIF(TRIM(custom_fields->>'country'), ''),
  linkedin_url = NULLIF(TRIM(custom_fields->>'linkedin_url'), '')
WHERE custom_fields IS NOT NULL
  AND (
    custom_fields ? 'title' OR
    custom_fields ? 'city'  OR
    custom_fields ? 'country' OR
    custom_fields ? 'linkedin_url'
  );

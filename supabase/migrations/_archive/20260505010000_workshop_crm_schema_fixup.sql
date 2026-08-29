-- Fixups to 20260505000000_workshop_crm_schema.sql:
--   1. companies.source column was missing
--   2. partial unique indexes on wl_workshop_id / wl_user_id can't be used as
--      ON CONFLICT arbiters via PostgREST — convert to full unique indexes
--      (Postgres treats NULLs as distinct, so multiple NULLs still allowed)

BEGIN;

-- 1. Add source column to companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS source TEXT;
CREATE INDEX IF NOT EXISTS companies_source_idx ON companies(source) WHERE source IS NOT NULL;

-- 2. Replace partial unique indexes with full unique indexes
DROP INDEX IF EXISTS companies_wl_workshop_id_idx;
CREATE UNIQUE INDEX companies_wl_workshop_id_idx ON companies(wl_workshop_id);

DROP INDEX IF EXISTS contacts_wl_user_id_idx;
CREATE UNIQUE INDEX contacts_wl_user_id_idx ON contacts(wl_user_id);

COMMIT;

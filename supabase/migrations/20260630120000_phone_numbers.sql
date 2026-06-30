-- Shared, labelled phone numbers for contacts + companies.
--
-- Replaces the old split model (contacts.phone + contacts.all_phones[] +
-- companies.phone) with one structured pool per COMPANY. Each number carries:
--   * label        — free text ("Stockholm", "Malmö", "Mobile", a contact name…)
--   * is_primary    — the company's default number (one per company scope)
--   * contact_id    — optional attribution to a specific contact
--   * company_id    — the owning company (the pool key)
--
-- Because a number is keyed on the company, every contact at that company sees
-- the full pool and the company profile shows all of them. A number can also be
-- attached to a company-less contact (company_id NULL, contact_id set).
--
-- The legacy columns (contacts.phone, contacts.all_phones, companies.phone) are
-- KEPT and mirror the primary number, so list views, CSV export, and the dialer
-- default keep working unchanged. The app writes both going forward.

CREATE TABLE phone_numbers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- The pool this number belongs to. A number is shared across every contact
  -- at the company. Either company_id or contact_id (or both) must be set.
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id)  ON DELETE SET NULL,

  number       TEXT NOT NULL,            -- E.164 when normalizable, else raw
  label        TEXT,                     -- "Stockholm", "Mobile", contact name…
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  country_code TEXT,                     -- ISO alpha-2 hint for re-normalization
  source       TEXT,                     -- 'manual' | 'csv' | 'website' | 'web-search' | 'backfill'

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT phone_numbers_has_owner CHECK (company_id IS NOT NULL OR contact_id IS NOT NULL)
);

CREATE INDEX phone_numbers_workspace_idx ON phone_numbers (workspace_id);
CREATE INDEX phone_numbers_company_idx   ON phone_numbers (company_id);
CREATE INDEX phone_numbers_contact_idx   ON phone_numbers (contact_id);

-- Dedupe within a company pool, and within a company-less contact's own list.
CREATE UNIQUE INDEX phone_numbers_company_number_idx
  ON phone_numbers (company_id, number)
  WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX phone_numbers_contact_number_idx
  ON phone_numbers (contact_id, number)
  WHERE company_id IS NULL AND contact_id IS NOT NULL;

-- RLS — workspace-scoped (mirrors call_sessions / contacts / companies).
ALTER TABLE phone_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can access phone_numbers"
  ON phone_numbers FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_phone_numbers_updated_at
  BEFORE UPDATE ON phone_numbers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- Backfill from the legacy columns.
--
-- Order matters: insert CONTACT-attributed numbers first (so they keep their
-- attribution + a contact-name label), then COMPANY numbers with ON CONFLICT
-- DO NOTHING so a number already attributed to a contact is not duplicated.
-- The contact's primary phone and the company's phone seed is_primary.
-- ---------------------------------------------------------------------------

-- 1. Each contact's primary phone → attributed, primary within its pool.
INSERT INTO phone_numbers (workspace_id, company_id, contact_id, number, label, is_primary, country_code, source)
SELECT
  c.workspace_id,
  c.company_id,
  c.id,
  c.phone,
  NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''),
  true,
  c.country_code,
  'backfill'
FROM contacts c
WHERE c.phone IS NOT NULL AND TRIM(c.phone) <> ''
ON CONFLICT DO NOTHING;

-- 2. Each contact's additional phones → attributed, not primary.
INSERT INTO phone_numbers (workspace_id, company_id, contact_id, number, label, is_primary, country_code, source)
SELECT
  c.workspace_id,
  c.company_id,
  c.id,
  ph,
  NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''),
  false,
  c.country_code,
  'backfill'
FROM contacts c
CROSS JOIN LATERAL unnest(c.all_phones) AS ph
WHERE c.all_phones IS NOT NULL
  AND ph IS NOT NULL AND TRIM(ph) <> ''
ON CONFLICT DO NOTHING;

-- 3. Each company's phone → company-pool number. Primary only if the pool has
--    no primary yet (a contact's primary already won the slot in step 1).
INSERT INTO phone_numbers (workspace_id, company_id, contact_id, number, label, is_primary, country_code, source)
SELECT
  co.workspace_id,
  co.id,
  NULL,
  co.phone,
  NULL,
  NOT EXISTS (
    SELECT 1 FROM phone_numbers p
    WHERE p.company_id = co.id AND p.is_primary
  ),
  co.country_code,
  'backfill'
FROM companies co
WHERE co.phone IS NOT NULL AND TRIM(co.phone) <> ''
ON CONFLICT DO NOTHING;

-- Guarantee at most one primary per company pool (in case step 1 attributed a
-- primary to two contacts at the same company sharing different numbers — keep
-- the earliest-created one).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY company_id ORDER BY created_at, id
  ) AS rn
  FROM phone_numbers
  WHERE company_id IS NOT NULL AND is_primary
)
UPDATE phone_numbers p
SET is_primary = false
FROM ranked r
WHERE p.id = r.id AND r.rn > 1;

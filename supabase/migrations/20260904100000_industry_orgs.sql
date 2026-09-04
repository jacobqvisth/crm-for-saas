-- Industry organisations: the trade associations, umbrella bodies, trade fairs, event
-- organisers and trade press of the European automotive sector.
--
-- Why a table rather than tags on `companies`. Same argument as `schools`: the org IS a
-- company in CRM terms and gets a companies row, but it also carries a registry-ish
-- identity that has nothing to do with outreach -- which European umbrella it belongs
-- to, whether its site could be verified, what kind of body it is. Filtering "every
-- Nordic trade fair" or "every CECRA member" off companies.tags would be a string scan.
--
-- Unlike schools there is no Skolverket here. The source is the umbrella bodies' own
-- member directories (CECRA, AECDR, FIGIEFA) plus per-country research, so `verified`
-- and `http_status` are first-class: an entry whose website does not resolve is kept
-- for the record but is not treated as real. That gate has already earned itself --
-- it caught ADIRA (Italy), which FIGIEFA still lists and whose domain now returns
-- "Account Suspended", and FOCWA (Netherlands), which now redirects to BOVAG.
--
-- affiliated_contacts holds people found on the org's pages who work somewhere else.
-- MRF's regional-board page lists branch chairs employed by member dealerships; they
-- are not association staff and must not be filed as such, but a regional chair of the
-- dealer federation is a good prospect on his own account, so they are kept here
-- rather than thrown away.

CREATE TABLE IF NOT EXISTS industry_orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,

  external_key TEXT NOT NULL,
  name TEXT NOT NULL,
  acronym TEXT,

  country TEXT,
  country_code TEXT,
  -- 'association' | 'umbrella' | 'trade_fair' | 'event_organiser' | 'media'
  org_type TEXT NOT NULL,
  sector TEXT,

  website TEXT,
  resolved_website TEXT,
  page_title TEXT,
  email TEXT,
  phone TEXT,

  -- Which European bodies this org sits under: CECRA, AECDR, FIGIEFA, AFCAR, ACEA...
  umbrellas TEXT[] NOT NULL DEFAULT '{}',

  verified BOOLEAN NOT NULL DEFAULT false,
  -- Real organisation whose site refuses automated requests. Kept and shown, but never
  -- crawled, so a 403 is not mistaken for a dead body.
  blocked BOOLEAN NOT NULL DEFAULT false,
  http_status TEXT,

  contact_count INTEGER NOT NULL DEFAULT 0,
  affiliated_contacts JSONB,

  source TEXT,
  notes TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS industry_orgs_workspace_key_idx
  ON industry_orgs (workspace_id, external_key);
CREATE INDEX IF NOT EXISTS industry_orgs_country_idx ON industry_orgs (workspace_id, country_code);
CREATE INDEX IF NOT EXISTS industry_orgs_type_idx ON industry_orgs (workspace_id, org_type);
CREATE INDEX IF NOT EXISTS industry_orgs_company_idx ON industry_orgs (company_id);

ALTER TABLE industry_orgs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace access for industry_orgs" ON industry_orgs;
CREATE POLICY "Workspace access for industry_orgs" ON industry_orgs
  FOR ALL USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP TRIGGER IF EXISTS set_updated_at ON industry_orgs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON industry_orgs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Configurator prospects: European companies that already run a product configurator,
-- and the vendors that sell them.
--
-- WHY THIS TABLE EXISTS
--
-- Animech's sharpest angle, in their own words, is that a 3D layer can be built OVER an
-- existing CPQ rather than replacing it -- as they did for Piab on top of Tacton. That
-- makes "already has a configurator" the qualifying fact, not a disqualifying one, and
-- it is a fact about the prospect that has nowhere to live on `companies`: which
-- platform runs it, where the live configurator is, and how good the evidence for that
-- claim actually is.
--
-- Same argument as `industry_orgs` and `schools`. The company IS a company in CRM terms
-- and gets a `companies` row; this table carries the registry-ish half. Filtering "every
-- German company running a non-3D CPQ" off companies.tags would be a string scan.
--
-- WHY `entry_type` HOLDS BOTH SIDES
--
-- Axel asked for two things that turn out to be one list: the companies running
-- configurators, and the companies selling them. The vendors are how the prospects were
-- found (every vendor publishes its customers), they are Animech's competitors, and a
-- vendor is itself a company that could resell or partner. Splitting them into two
-- tables would duplicate every column and make "who did this prospect buy from" a join
-- across two registries.
--
-- WHY `platform_source` IS A COLUMN AND NOT A COMMENT
--
-- The three ways of knowing which platform a company runs are not equally good:
--
--   'configurator page'      the live configurator loads that vendor's script. Decisive.
--   'homepage'               the homepage loads it. Strong.
--   'vendor reference page'  the vendor lists them as a customer. WEAK -- vendors leave
--                            churned logos up for years.
--
-- An outreach that says "we saw you are running Roomle" had better be right, so the page
-- shows which of the three it is rather than flattening them into one confident claim.
-- The weak case is not a defect: a company that left a vendor is a better prospect than
-- one that did not, but it must be approached as a question, not as a statement.

CREATE TABLE IF NOT EXISTS configurator_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,

  external_key TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT,

  -- 'prospect' = runs a configurator, is a lead.
  -- 'vendor'   = sells configurator or CPQ software, is a competitor.
  entry_type TEXT NOT NULL DEFAULT 'prospect',
  -- For vendors only: 'visual' (3D, competes with Animech head-on), 'cpq' (rules and
  -- pricing, Animech sells a 3D layer on top) or 'vertical' (furniture, kitchen, window).
  vendor_kind TEXT,

  country TEXT,
  country_code TEXT,
  -- How the country was decided: 'ccTLD', 'phone prefix', 'legal form',
  -- 'country named in footer'. A footer guess and a .de domain are not the same claim.
  country_source TEXT,
  industry TEXT,

  website TEXT,
  resolved_website TEXT,
  page_title TEXT,
  description TEXT,
  email TEXT,
  phone TEXT,

  -- The live configurator, which is the whole point: outreach opens with this link.
  configurator_url TEXT,
  -- 0-100 confidence that the URL really is a configurator. See lib_configurator.mjs.
  configurator_score INTEGER NOT NULL DEFAULT 0,
  -- Other pages that scored, kept so a human can correct a wrong pick without a re-crawl.
  configurator_candidates JSONB,

  -- Detected platform(s), e.g. {Roomle} or {Tacton,"Three.js (custom build)"}.
  platforms TEXT[] NOT NULL DEFAULT '{}',
  platform_source TEXT,
  -- Which vendors' reference pages named this company. More than one means they have
  -- changed configurator at least once, which is the strongest signal in the dataset.
  cited_by TEXT[] NOT NULL DEFAULT '{}',

  verified BOOLEAN NOT NULL DEFAULT false,
  -- A live site that refuses robots. Kept and shown, never crawled, so a 403 is not
  -- mistaken for a dead company.
  blocked BOOLEAN NOT NULL DEFAULT false,
  http_status TEXT,

  contact_count INTEGER NOT NULL DEFAULT 0,

  source TEXT,
  notes TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS configurator_prospects_workspace_key_idx
  ON configurator_prospects (workspace_id, external_key);
CREATE INDEX IF NOT EXISTS configurator_prospects_country_idx
  ON configurator_prospects (workspace_id, country_code);
CREATE INDEX IF NOT EXISTS configurator_prospects_type_idx
  ON configurator_prospects (workspace_id, entry_type);
CREATE INDEX IF NOT EXISTS configurator_prospects_company_idx
  ON configurator_prospects (company_id);

ALTER TABLE configurator_prospects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace access for configurator_prospects" ON configurator_prospects;
CREATE POLICY "Workspace access for configurator_prospects" ON configurator_prospects
  FOR ALL USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP TRIGGER IF EXISTS set_updated_at ON configurator_prospects;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON configurator_prospects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

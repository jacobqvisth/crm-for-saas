-- Swedish vehicle-education directory: schools and the programmes they run.
--
-- Why two new tables rather than columns on `companies`.
--
-- A school IS a company in CRM terms -- it gets a profile, contacts, an owner and can
-- be emailed -- so every school also gets a `companies` row and `schools.company_id`
-- points at it. What does not fit `companies` is the programme grain: one school runs
-- between one and eleven vehicle programmes (Fordons- och transportprogrammet plus the
-- programinriktat-val and yrkesintroduktion variants), each with its own study-path
-- code, admission points and inriktningar. That is a real one-to-many and it drives
-- the whole point of the /schools page: "which schools teach personbil", not "which
-- schools exist". Flattening it into companies.custom_fields would make every filter
-- on the overview page a JSON scan.
--
-- `schools` therefore carries the education-registry identity (Skolverket school-unit
-- code, huvudman, skolform) and `school_programs` carries the per-programme rows.
-- `companies` stays the outreach surface and is not reshaped at all.

CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,

  -- Stable key for re-imports. 'gy:<skolenhetskod>' for gymnasium units, which is
  -- Skolverket's own identifier, and 'ad:<provider slug>' for adult providers, which
  -- have no registry code of their own in the planned-educations API.
  external_key TEXT NOT NULL,
  school_unit_code TEXT,

  name TEXT NOT NULL,
  -- 'gymnasium' | 'anpassad_gymnasium' | 'yrkeshogskola' | 'komvux' | 'folkhogskola'
  -- | 'arbetsmarknadsutbildning' | 'nationell_yrkesutbildning' | 'hogskola'
  -- | 'forberedande'
  school_type TEXT NOT NULL,
  -- How close this school's vehicle teaching is to the workshop trade:
  -- 'core' cars, 'adjacent' trucks/plant/marine/air/rail, 'transport' driving roles.
  relevance_tier TEXT NOT NULL DEFAULT 'core',

  -- Huvudman: 'Kommunal' | 'Fristående' | 'Kommunalförbund' | 'Region' | 'Stat'.
  principal_organizer_type TEXT,
  corporation_name TEXT,
  org_number TEXT,

  website TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  postal_code TEXT,
  city TEXT,
  municipality TEXT,
  municipality_code TEXT,
  county TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  -- FT25 inriktningar read off the school's own site, because Skolverket's API does
  -- not expose which ones a unit actually runs: personbil, lastbil och mobila
  -- maskiner, karosseri och lackering, transport, godshantering.
  orientations TEXT[] NOT NULL DEFAULT '{}',
  program_count INTEGER NOT NULL DEFAULT 0,
  contact_count INTEGER NOT NULL DEFAULT 0,

  source TEXT,
  notes TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS schools_workspace_external_key_idx
  ON schools (workspace_id, external_key);
CREATE INDEX IF NOT EXISTS schools_workspace_type_idx ON schools (workspace_id, school_type);
CREATE INDEX IF NOT EXISTS schools_workspace_county_idx ON schools (workspace_id, county);
CREATE INDEX IF NOT EXISTS schools_company_idx ON schools (company_id);

CREATE TABLE IF NOT EXISTS school_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,

  -- Skolverket's education-event id, unique per (school, study path).
  education_event_id TEXT NOT NULL,
  -- Gy25 study-path code: FT25, FG25, IMVFTG, IMYFTJ... NULL for adult programmes,
  -- which are not coded this way.
  program_code TEXT,
  program_name TEXT NOT NULL,
  -- 'national' | 'adapted' | 'intro' | 'adult'
  program_kind TEXT,
  relevance_tier TEXT NOT NULL DEFAULT 'core',
  relevance_reason TEXT,
  -- 'gy' | 'gyan' for gymnasium, or the adult form label.
  school_form TEXT,
  orientations TEXT[] NOT NULL DEFAULT '{}',

  start_date DATE,
  credits TEXT,
  credits_system TEXT,
  pace_of_study TEXT,
  distance BOOLEAN,

  -- Merit points from the most recent admission round, as published. Kept as text
  -- because Skolverket returns Swedish decimal commas ("152,5").
  admission_points_min TEXT,
  admission_points_average TEXT,
  admission_points_semester TEXT,

  program_url TEXT,
  description TEXT,
  source TEXT,
  raw JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS school_programs_workspace_event_idx
  ON school_programs (workspace_id, education_event_id);
CREATE INDEX IF NOT EXISTS school_programs_school_idx ON school_programs (school_id);
CREATE INDEX IF NOT EXISTS school_programs_code_idx ON school_programs (workspace_id, program_code);

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Workspace access for schools" ON schools;
CREATE POLICY "Workspace access for schools" ON schools
  FOR ALL USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP POLICY IF EXISTS "Workspace access for school_programs" ON school_programs;
CREATE POLICY "Workspace access for school_programs" ON school_programs
  FOR ALL USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP TRIGGER IF EXISTS set_updated_at ON schools;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON school_programs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON school_programs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

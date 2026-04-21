-- ==========================================================================
-- 20260423000000_extend_contractor_directory.sql
-- Phase SE-Stockholm-5: extend contractor_directory with ~35 columns so it
-- can hold rich data promoted from discovered_shops (Phase 3/4 scrapes).
-- Applied to Kundbolaget: ugibcnidxrhcxflqamxs
-- ==========================================================================

-- Rich descriptive fields
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS about_text TEXT;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS services_text TEXT;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS photos TEXT[];

-- Location / registry
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS partial_org_number TEXT;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS founded_year INTEGER;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS years_in_business INTEGER;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS employee_count_range TEXT;

-- Cert + trust flags (nullable boolean tri-state: TRUE / FALSE / NULL=unknown)
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS rot_advertised BOOLEAN;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS gvk_certified BOOLEAN;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS saker_vatten_certified BOOLEAN;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS byggforetagen_member BOOLEAN;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS installatorsforetagen_member BOOLEAN;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS elsakerhetsverket_registered BOOLEAN;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS f_skatt_registered BOOLEAN;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS bankid_verified BOOLEAN;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS warranty_years INTEGER;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS insurance_carrier TEXT;

-- Reviews rollup (denormalized for page render speed)
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS composite_rating NUMERIC(3,2);
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS total_review_count INTEGER DEFAULT 0;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS review_sources_count INTEGER DEFAULT 0;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS reviews_recent JSONB;

-- Platform back-refs
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS servicefinder_id TEXT;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS servicefinder_jobs_completed INTEGER;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS dorunner_slug TEXT;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS dorunner_jobs_completed INTEGER;

-- Classification
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS all_categories TEXT[];
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS tags TEXT[];

-- Provenance + back-ref + admin
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS sources JSONB;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS discovered_shop_id UUID REFERENCES discovered_shops(id) ON DELETE SET NULL;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS shop_score INTEGER;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;
ALTER TABLE contractor_directory ADD COLUMN IF NOT EXISTS promote_source TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cd_state_status    ON contractor_directory (state, public_status);
CREATE INDEX IF NOT EXISTS idx_cd_category_status ON contractor_directory (category, public_status);
CREATE INDEX IF NOT EXISTS idx_cd_public_slug     ON contractor_directory (public_slug) WHERE public_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cd_composite       ON contractor_directory (composite_rating DESC NULLS LAST, total_review_count DESC) WHERE public_status = 'published';
CREATE INDEX IF NOT EXISTS idx_cd_all_categories  ON contractor_directory USING GIN (all_categories);
CREATE INDEX IF NOT EXISTS idx_cd_tags            ON contractor_directory USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_cd_discovered_shop ON contractor_directory (discovered_shop_id) WHERE discovered_shop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cd_servicefinder   ON contractor_directory (servicefinder_id) WHERE servicefinder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cd_dorunner        ON contractor_directory (dorunner_slug) WHERE dorunner_slug IS NOT NULL;

-- Reviews JOIN helper
CREATE OR REPLACE VIEW contractor_directory_reviews_v AS
SELECT r.*, d.id AS directory_id
FROM discovered_shop_reviews r
JOIN discovered_shops s ON s.id = r.shop_id
JOIN contractor_directory d ON d.discovered_shop_id = s.id;

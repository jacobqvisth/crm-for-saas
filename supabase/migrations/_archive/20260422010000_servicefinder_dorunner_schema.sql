-- ==========================================================================
-- 20260422010000_servicefinder_dorunner_schema.sql
-- Adds ServiceFinder + DoRunner columns, partial_org_number,
-- 9 "all info" columns, and the discovered_shop_reviews table.
-- Also re-creates coverage_stats view with new ratios.
-- Applied to Kundbolaget: ugibcnidxrhcxflqamxs
-- ==========================================================================

BEGIN;

-- ---------------------------------
-- ServiceFinder-specific columns
-- ---------------------------------
ALTER TABLE public.discovered_shops
  ADD COLUMN IF NOT EXISTS servicefinder_id           text,
  ADD COLUMN IF NOT EXISTS servicefinder_state        text,
  ADD COLUMN IF NOT EXISTS servicefinder_area_served  text[],
  ADD COLUMN IF NOT EXISTS servicefinder_jobs_completed integer;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_servicefinder_id
  ON public.discovered_shops (servicefinder_id)
  WHERE servicefinder_id IS NOT NULL;

-- ---------------------------------
-- DoRunner-specific columns
-- ---------------------------------
ALTER TABLE public.discovered_shops
  ADD COLUMN IF NOT EXISTS dorunner_rating        numeric(3,2),
  ADD COLUMN IF NOT EXISTS dorunner_review_count  integer,
  ADD COLUMN IF NOT EXISTS dorunner_url           text,
  ADD COLUMN IF NOT EXISTS dorunner_slug          text,
  ADD COLUMN IF NOT EXISTS dorunner_jobs_completed integer;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_dorunner_slug
  ON public.discovered_shops (dorunner_slug)
  WHERE dorunner_slug IS NOT NULL;

-- ---------------------------------
-- Partial org-number (6-digit prefix from SF taxID)
-- ---------------------------------
ALTER TABLE public.discovered_shops
  ADD COLUMN IF NOT EXISTS partial_org_number text;

CREATE INDEX IF NOT EXISTS idx_shops_partial_org_number
  ON public.discovered_shops (partial_org_number)
  WHERE partial_org_number IS NOT NULL;

-- ---------------------------------
-- "All info" customer-facing fields
-- ---------------------------------
ALTER TABLE public.discovered_shops
  ADD COLUMN IF NOT EXISTS logo_url              text,
  ADD COLUMN IF NOT EXISTS photos                text[],
  ADD COLUMN IF NOT EXISTS f_skatt_registered    boolean,
  ADD COLUMN IF NOT EXISTS bankid_verified       boolean,
  ADD COLUMN IF NOT EXISTS insurance_carrier     text,
  ADD COLUMN IF NOT EXISTS insurance_amount_sek  bigint,
  ADD COLUMN IF NOT EXISTS warranty_years        integer;

COMMENT ON COLUMN public.discovered_shops.f_skatt_registered IS
  '3-state: NULL=not evaluated, TRUE=F-skatt status found on website or SF/DR profile, FALSE=evaluated but no F-skatt claim found';
COMMENT ON COLUMN public.discovered_shops.bankid_verified IS
  'Specific to ServiceFinder -- TRUE if the SF profile shows the BankID verification badge. NULL if not evaluated / not on SF.';

-- ---------------------------------
-- New table: discovered_shop_reviews
-- ---------------------------------
CREATE TABLE IF NOT EXISTS public.discovered_shop_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.discovered_shops(id) ON DELETE CASCADE,

  -- Provenance
  source TEXT NOT NULL,                       -- 'servicefinder' | 'dorunner' | 'google' | 'reco' | 'trustpilot' | 'facebook'
  source_review_id TEXT NOT NULL,             -- synthetic: SHA1(source || profile_id || author || published_at) for idempotency
  source_profile_id TEXT,                     -- SF foretag id / DR slug / Reco slug / etc.
  source_url TEXT,                            -- deep link back to the review if one exists

  -- Review content
  author_name TEXT,                           -- first-name-only where the source already truncates it (SF / DR)
  rating NUMERIC(3,2) NOT NULL,
  best_rating NUMERIC(3,2) DEFAULT 5.0,
  review_title TEXT,                          -- SF ships these; DR usually doesn't
  review_body TEXT,                           -- nullable (some DR reviews are rating-only)
  published_at DATE,
  language TEXT DEFAULT 'sv',

  -- Audit
  raw JSONB,                                  -- full source object as-scraped
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id UUID REFERENCES public.scrape_runs(id),

  UNIQUE (source, source_review_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_shop      ON public.discovered_shop_reviews(shop_id);
CREATE INDEX IF NOT EXISTS idx_reviews_source    ON public.discovered_shop_reviews(source);
CREATE INDEX IF NOT EXISTS idx_reviews_published ON public.discovered_shop_reviews(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_rating    ON public.discovered_shop_reviews(rating);
CREATE INDEX IF NOT EXISTS idx_reviews_body_fts  ON public.discovered_shop_reviews
  USING gin (to_tsvector('swedish', coalesce(review_title,'') || ' ' || coalesce(review_body,'')));

-- RLS off (same as discovered_shops -- service-role-only enrichment pool, not CRM data)
ALTER TABLE public.discovered_shop_reviews DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.discovered_shop_reviews IS
  'Individual review bodies scraped from source platforms. One row per unique (source, source_review_id). Idempotent: re-running a scrape no-ops on already-seen reviews but bumps last_seen_at.';

-- ---------------------------------
-- Coverage stats view -- drop + recreate with new ratios
-- ---------------------------------
DROP VIEW IF EXISTS public.coverage_stats;

CREATE OR REPLACE VIEW public.coverage_stats AS
SELECT
  country_code,
  state,
  COUNT(*) AS total_shops,
  ROUND(100.0 * COUNT(phone)                  / NULLIF(COUNT(*), 0), 1) AS pct_with_phone,
  ROUND(100.0 * COUNT(primary_email)          / NULLIF(COUNT(*), 0), 1) AS pct_with_email,
  ROUND(100.0 * COUNT(CASE WHEN email_valid THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS pct_with_mx_valid_email,
  ROUND(100.0 * COUNT(description)            / NULLIF(COUNT(*), 0), 1) AS pct_with_description,
  ROUND(100.0 * COUNT(about_text)             / NULLIF(COUNT(*), 0), 1) AS pct_with_about_text,
  ROUND(100.0 * COUNT(services_text)          / NULLIF(COUNT(*), 0), 1) AS pct_with_services_text,
  ROUND(100.0 * COUNT(logo_url)               / NULLIF(COUNT(*), 0), 1) AS pct_with_logo,
  ROUND(100.0 * COUNT(CASE WHEN f_skatt_registered THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS pct_f_skatt_true,
  ROUND(100.0 * COUNT(servicefinder_id)       / NULLIF(COUNT(*), 0), 1) AS pct_on_servicefinder,
  ROUND(100.0 * COUNT(dorunner_slug)          / NULLIF(COUNT(*), 0), 1) AS pct_on_dorunner,
  ROUND(100.0 * COUNT(google_place_id)        / NULLIF(COUNT(*), 0), 1) AS pct_on_google_maps,
  ROUND(100.0 * COUNT(CASE WHEN servicefinder_review_count > 0 THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS pct_with_servicefinder_reviews,
  ROUND(100.0 * COUNT(CASE WHEN dorunner_review_count      > 0 THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS pct_with_dorunner_reviews
FROM public.discovered_shops
GROUP BY country_code, state;

COMMIT;

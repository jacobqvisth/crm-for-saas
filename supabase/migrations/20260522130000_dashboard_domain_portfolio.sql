-- Curated catalog of European TLD recommendations + per-row decision tracking.
-- One row per (country, TLD) pair. The seed (next migration) loads the
-- research catalog read-only; the status/domain_name/notes columns are
-- edited by the CEO from the /ceo/domain-portfolio page.

CREATE TABLE IF NOT EXISTS public.dashboard_domain_portfolio (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Catalog (seeded, treated as read-only after seed)
  country_code    text NOT NULL,                      -- ISO-3166-1 alpha-2 ('SE')
  country_name    text NOT NULL,
  country_flag    text,                               -- emoji
  region          text NOT NULL CHECK (region IN ('north','west','south','east')),
  tld             text NOT NULL,                      -- '.se', '.com', '.co.uk'
  rank            int  NOT NULL CHECK (rank BETWEEN 1 AND 9),
  tld_type        text NOT NULL CHECK (tld_type IN (
                    'native_cctld','generic','domain_hack',
                    'subdomain_convention','idn','sponsored'
                  )),
  registry        text,
  rationale       text NOT NULL,
  market_share    text,                               -- free-text ('~58%', 'dominant', etc.)
  restrictions    text,
  is_global_hack  boolean NOT NULL DEFAULT false,

  -- Decision tracking (editable by CEO)
  status          text NOT NULL DEFAULT 'not_started' CHECK (status IN (
                    'not_started','planning','bought','installed','skipped'
                  )),
  domain_name     text,                               -- 'wrenchlane.se' once decided
  registrar       text,
  annual_cost_eur numeric(10, 2),
  notes           text,
  purchased_at    timestamptz,
  installed_at    timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (country_code, tld)
);

CREATE INDEX IF NOT EXISTS dashboard_domain_portfolio_region_country_rank_idx
  ON public.dashboard_domain_portfolio (region, country_code, rank);

CREATE INDEX IF NOT EXISTS dashboard_domain_portfolio_status_idx
  ON public.dashboard_domain_portfolio (status);

COMMENT ON TABLE public.dashboard_domain_portfolio IS
  'Per-country TLD recommendations + CEO''s decision tracking. Read from /ceo/domain-portfolio.';

-- Touch updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION public.dashboard_domain_portfolio_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS dashboard_domain_portfolio_touch ON public.dashboard_domain_portfolio;
CREATE TRIGGER dashboard_domain_portfolio_touch
  BEFORE UPDATE ON public.dashboard_domain_portfolio
  FOR EACH ROW EXECUTE FUNCTION public.dashboard_domain_portfolio_touch();

-- RLS: CEO data layer uses the service-role client (bypasses RLS). Enable RLS
-- with no policies so any direct authenticated/anon access is denied.
ALTER TABLE public.dashboard_domain_portfolio ENABLE ROW LEVEL SECURITY;

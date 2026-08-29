-- SCB (Swedish Statistics Office) Företagsregistret enrichment fields.
-- Source: SCB Företagsregistret AE, SNI 95311 (auto repair).
-- Adds registry-level identity, size, geography, and compliance gates to companies.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS org_number text,
  ADD COLUMN IF NOT EXISTS cfar_number text,
  ADD COLUMN IF NOT EXISTS marketing_opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nix_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_sole_proprietor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS employee_size_band text,
  ADD COLUMN IF NOT EXISTS county text;

-- org_number: indexed but NOT unique — multi-branch chains share a legal entity ID.
CREATE INDEX IF NOT EXISTS companies_org_number_idx
  ON companies (workspace_id, org_number)
  WHERE org_number IS NOT NULL;

-- cfar_number: unique per workspace — CFARnr identifies one workplace globally,
-- so it doubles as the idempotency key for re-running SCB imports.
CREATE UNIQUE INDEX IF NOT EXISTS companies_cfar_workspace_unique
  ON companies (workspace_id, cfar_number)
  WHERE cfar_number IS NOT NULL;

-- county is read by Field Routes regionalization (see src/lib/routes/generate.ts REGION_CENTERS).
CREATE INDEX IF NOT EXISTS companies_county_idx
  ON companies (workspace_id, county)
  WHERE county IS NOT NULL;

COMMENT ON COLUMN companies.org_number IS 'Swedish Organisationsnummer (10 digits). One per legal entity; chains share this across branches.';
COMMENT ON COLUMN companies.cfar_number IS 'SCB CFARnr — unique workplace identifier. One per physical location.';
COMMENT ON COLUMN companies.marketing_opt_out IS 'Customer has opted out of marketing (SCB Reklamstatus). Send gate.';
COMMENT ON COLUMN companies.nix_blocked IS 'Phone number is NIX/telefonspärr-registered. Call gate.';
COMMENT ON COLUMN companies.is_sole_proprietor IS 'SCB Persondataflagga = fysisk person. Email is personal data under GDPR.';
COMMENT ON COLUMN companies.employee_size_band IS 'SCB Storleksklass: 0 / 1-4 / 5-9 / 10-19 / 20-49 / 50-99 / 100-199 / 200+.';
COMMENT ON COLUMN companies.county IS 'SCB Län (Swedish county).';

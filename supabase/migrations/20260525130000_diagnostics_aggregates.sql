-- ============================================================================
-- Diagnostics aggregates on contacts + companies
--
-- contacts already has diagnostics_total/_first_at/_last_at/_last_30d (added
-- in 20260505000000_workshop_crm_schema.sql) but they were never populated.
-- companies didn't have the columns at all. This migration:
--   1) Adds the same four columns to companies
--   2) Creates the refresh_diagnostics_aggregates() RPC that recomputes both
--      sides from public.dashboard_diagnostics in a single pass
--   3) Runs the RPC once to backfill
--
-- The RPC is called from src/lib/ceo/sync/propagate-to-crm.ts on every
-- CEO sync run after dashboard_diagnostics is refreshed from S3.
--
-- Identity join (note the text/UUID cast):
--   contacts.wl_user_id (UUID) ↔ dashboard_diagnostics.internal_user_id (text)
--   companies.wl_workshop_id (UUID) ↔ dashboard_diagnostics.workshop_id (text)
-- ============================================================================

BEGIN;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS diagnostics_total     INTEGER,
  ADD COLUMN IF NOT EXISTS diagnostics_first_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS diagnostics_last_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS diagnostics_last_30d  INTEGER;

COMMENT ON COLUMN companies.diagnostics_total IS
  'Lifetime diagnostic scan count for this workshop. Refreshed by refresh_diagnostics_aggregates().';
COMMENT ON COLUMN companies.diagnostics_first_at IS
  'Timestamp of this workshop''s first scan. NULL if no scans on record.';
COMMENT ON COLUMN companies.diagnostics_last_at IS
  'Timestamp of this workshop''s most recent scan. NULL if no scans on record.';
COMMENT ON COLUMN companies.diagnostics_last_30d IS
  'Scan count in the trailing 30 days. Use as the recency signal for active-customer UI.';

CREATE OR REPLACE FUNCTION public.refresh_diagnostics_aggregates()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  contacts_updated  integer;
  companies_updated integer;
BEGIN
  WITH user_stats AS (
    SELECT
      c.id AS contact_id,
      COUNT(d.diagnostic_id)                                                              AS total,
      MIN(d.created_at)                                                                   AS first_at,
      MAX(d.created_at)                                                                   AS last_at,
      COUNT(d.diagnostic_id) FILTER (WHERE d.created_at >= NOW() - INTERVAL '30 days')    AS last_30d
    FROM contacts c
    LEFT JOIN dashboard_diagnostics d
      ON d.internal_user_id = c.wl_user_id::text
    WHERE c.wl_user_id IS NOT NULL
    GROUP BY c.id
  ),
  contact_upd AS (
    UPDATE contacts c
       SET diagnostics_total    = COALESCE(s.total, 0),
           diagnostics_first_at = s.first_at,
           diagnostics_last_at  = s.last_at,
           diagnostics_last_30d = COALESCE(s.last_30d, 0)
      FROM user_stats s
     WHERE c.id = s.contact_id
       AND (
         COALESCE(c.diagnostics_total, -1)    IS DISTINCT FROM COALESCE(s.total, 0)
      OR COALESCE(c.diagnostics_first_at, 'epoch'::timestamptz) IS DISTINCT FROM COALESCE(s.first_at, 'epoch'::timestamptz)
      OR COALESCE(c.diagnostics_last_at,  'epoch'::timestamptz) IS DISTINCT FROM COALESCE(s.last_at,  'epoch'::timestamptz)
      OR COALESCE(c.diagnostics_last_30d, -1) IS DISTINCT FROM COALESCE(s.last_30d, 0)
       )
    RETURNING 1
  )
  SELECT COUNT(*) INTO contacts_updated FROM contact_upd;

  WITH workshop_stats AS (
    SELECT
      co.id AS company_id,
      COUNT(d.diagnostic_id)                                                              AS total,
      MIN(d.created_at)                                                                   AS first_at,
      MAX(d.created_at)                                                                   AS last_at,
      COUNT(d.diagnostic_id) FILTER (WHERE d.created_at >= NOW() - INTERVAL '30 days')    AS last_30d
    FROM companies co
    LEFT JOIN dashboard_diagnostics d
      ON d.workshop_id = co.wl_workshop_id::text
    WHERE co.wl_workshop_id IS NOT NULL
    GROUP BY co.id
  ),
  company_upd AS (
    UPDATE companies co
       SET diagnostics_total    = COALESCE(s.total, 0),
           diagnostics_first_at = s.first_at,
           diagnostics_last_at  = s.last_at,
           diagnostics_last_30d = COALESCE(s.last_30d, 0)
      FROM workshop_stats s
     WHERE co.id = s.company_id
       AND (
         COALESCE(co.diagnostics_total, -1)    IS DISTINCT FROM COALESCE(s.total, 0)
      OR COALESCE(co.diagnostics_first_at, 'epoch'::timestamptz) IS DISTINCT FROM COALESCE(s.first_at, 'epoch'::timestamptz)
      OR COALESCE(co.diagnostics_last_at,  'epoch'::timestamptz) IS DISTINCT FROM COALESCE(s.last_at,  'epoch'::timestamptz)
      OR COALESCE(co.diagnostics_last_30d, -1) IS DISTINCT FROM COALESCE(s.last_30d, 0)
       )
    RETURNING 1
  )
  SELECT COUNT(*) INTO companies_updated FROM company_upd;

  RETURN json_build_object(
    'contacts_updated', contacts_updated,
    'companies_updated', companies_updated,
    'refreshed_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_diagnostics_aggregates() IS
  'Recomputes contacts.diagnostics_* and companies.diagnostics_* from dashboard_diagnostics. Idempotent — only UPDATEs rows whose aggregates actually changed. Called from src/lib/ceo/sync/propagate-to-crm.ts after each S3 dashboard sync.';

REVOKE ALL ON FUNCTION public.refresh_diagnostics_aggregates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_diagnostics_aggregates() TO service_role;

-- One-shot backfill on first apply. Safe to re-run — the RPC is idempotent.
SELECT public.refresh_diagnostics_aggregates();

COMMIT;

-- ============================================================================
-- 1) contacts.active_days_count — distinct days on which the linked app user
--    performed a real product action (a diagnostic, or any day-granularity
--    dashboard_feature_usage row: chat, ai_search, vrm_lookups, infopro/motor
--    vehicle lookups). Bare logins deliberately do NOT count.
--
--    Refreshed by refresh_active_days_aggregates(), called from
--    src/lib/ceo/sync/propagate-to-crm.ts on every hourly core_app sync,
--    right after refresh_diagnostics_aggregates(). Exposed as a dynamic-list
--    filter field so cohorts like "used the product on 2+ distinct days"
--    stay current without any materialization job.
--
-- 2) sequence_auto_enrollments — persistent link "list X continuously feeds
--    sequence Y", consumed by the hourly /api/cron/auto-enroll route. Each
--    run resolves the (typically dynamic) list, applies its stored
--    exclusions, and enrolls not-yet-enrolled members via enrollContacts().
-- ============================================================================

BEGIN;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS active_days_count INTEGER;

COMMENT ON COLUMN contacts.active_days_count IS
  'Distinct Stockholm-time days with at least one product action (diagnostics + day-granularity feature usage). Refreshed by refresh_active_days_aggregates().';

CREATE OR REPLACE FUNCTION public.refresh_active_days_aggregates()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  contacts_updated integer;
BEGIN
  WITH action_days AS (
    SELECT internal_user_id,
           (created_at AT TIME ZONE 'Europe/Stockholm')::date AS d
      FROM dashboard_diagnostics
    UNION
    SELECT internal_user_id, period_start
      FROM dashboard_feature_usage
     WHERE granularity = 'day'
  ),
  user_stats AS (
    SELECT c.id AS contact_id,
           COUNT(DISTINCT a.d) AS active_days
      FROM contacts c
      LEFT JOIN action_days a
        ON a.internal_user_id = c.wl_user_id::text
     WHERE c.wl_user_id IS NOT NULL
     GROUP BY c.id
  ),
  contact_upd AS (
    UPDATE contacts c
       SET active_days_count = COALESCE(s.active_days, 0)
      FROM user_stats s
     WHERE c.id = s.contact_id
       AND COALESCE(c.active_days_count, -1) IS DISTINCT FROM COALESCE(s.active_days, 0)
    RETURNING 1
  )
  SELECT COUNT(*) INTO contacts_updated FROM contact_upd;

  RETURN json_build_object(
    'contacts_updated', contacts_updated,
    'refreshed_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_active_days_aggregates() IS
  'Recomputes contacts.active_days_count from dashboard_diagnostics + dashboard_feature_usage (day granularity). Idempotent — only UPDATEs changed rows. Called from src/lib/ceo/sync/propagate-to-crm.ts after each dashboard sync.';

REVOKE ALL ON FUNCTION public.refresh_active_days_aggregates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_active_days_aggregates() TO service_role;

-- ----------------------------------------------------------------------------
-- Continuous list → sequence enrollment links
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sequence_auto_enrollments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sequence_id           UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  list_id               UUID NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  enabled               BOOLEAN NOT NULL DEFAULT true,
  -- Passed through to enrollContacts. Audiences of app users need true,
  -- otherwise both the enroll guard and the send-time cron guard cancel.
  allow_customers       BOOLEAN NOT NULL DEFAULT false,
  -- When true, an ACTIVE enrollment whose contact no longer matches the list
  -- (e.g. a free user who upgraded to paid) is completed and its queued
  -- emails cancelled on the next cron run.
  unenroll_when_left_list BOOLEAN NOT NULL DEFAULT false,
  sender_account_id     UUID REFERENCES gmail_accounts(id) ON DELETE SET NULL,
  last_run_at           TIMESTAMPTZ,
  last_result           JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sequence_id, list_id)
);

COMMENT ON TABLE sequence_auto_enrollments IS
  'Continuous enrollment: /api/cron/auto-enroll resolves list_id (dynamic lists roll forward on their own) and enrolls new members into sequence_id via enrollContacts(). Dedup is inherent — enrollContacts skips contacts ever enrolled in the sequence.';

ALTER TABLE sequence_auto_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can access sequence_auto_enrollments"
  ON sequence_auto_enrollments FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

-- One-shot backfill of active_days_count on first apply. Safe to re-run.
SELECT public.refresh_active_days_aggregates();

COMMIT;

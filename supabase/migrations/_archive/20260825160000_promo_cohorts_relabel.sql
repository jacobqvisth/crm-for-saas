-- Promo Users: fix a wrong cohort label, and add the like-for-like cohorts.
--
-- The comparison cohort was called "paid_no_promo" and defined as
--   ever_paid OR trial_end IS NOT NULL OR plan_key <> 'free'
-- which is "reached checkout", NOT "paid". Of its 125 users only 37 were ever
-- charged: 66 started a trial and never paid, and 22 carded at checkout without
-- a trial and were never charged. So the table showed a cohort labelled "Paid,
-- no promo" whose "Ever paid real money" cell read 30%, which is exactly as
-- contradictory as it sounds. This is the documented plan_key trial trap:
-- plan_key and trial_end are stamped at checkout, before any money moves.
--
-- Renamed to `checkout_no_promo`, and two genuinely comparable cohorts added:
--   charged_no_promo  — not promo AND ever_paid (37)
--   promo_charged     — promo AND ever_paid (37)
-- Those two are the honest apples-to-apples read, and they change the finding:
-- activation (62.2 vs 64.9%), repeat (54.1 vs 54.1%) and 30-day retention
-- (35.1 vs 35.1%) are the SAME. Only volume differs.
--
-- charged_no_promo is a SUBSET of checkout_no_promo and promo_charged is a
-- SUBSET of promo, so these rows must never be summed. The page labels them as
-- subsets for that reason.

CREATE OR REPLACE FUNCTION promo_cohort_stats()
RETURNS TABLE (
  cohort TEXT,
  users INTEGER,
  workshops INTEGER,
  total_diagnostics BIGINT,
  total_active_days BIGINT,
  avg_diagnostics NUMERIC,
  median_diagnostics NUMERIC,
  max_diagnostics INTEGER,
  pct_activated NUMERIC,
  pct_repeat NUMERIC,
  pct_power NUMERIC,
  avg_active_days NUMERIC,
  pct_active_30d NUMERIC,
  pct_ever_paid NUMERIC,
  avg_chats NUMERIC,
  avg_feature_events NUMERIC,
  avg_logins NUMERIC,
  stage_logged_in INTEGER,
  stage_activated INTEGER,
  stage_repeat INTEGER,
  stage_habit INTEGER,
  stage_paid INTEGER,
  stage_active_30d INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH u AS (
    SELECT * FROM promo_user_analysis(FALSE) WHERE NOT is_internal_test
  ),
  -- One row per (cohort, user). A user can appear in two cohorts on purpose:
  -- the charged cohorts are subsets of the wider ones.
  tagged AS (
    SELECT 'promo' AS cohort, u.* FROM u WHERE u.is_promo
    UNION ALL
    SELECT 'promo_charged', u.* FROM u WHERE u.is_promo AND u.ever_paid
    UNION ALL
    SELECT 'charged_no_promo', u.* FROM u WHERE NOT u.is_promo AND u.ever_paid
    UNION ALL
    SELECT 'checkout_no_promo', u.*
    FROM u
    WHERE NOT u.is_promo
      AND (
        u.ever_paid
        OR u.trial_end IS NOT NULL
        OR (u.plan_key IS NOT NULL AND u.plan_key <> 'free')
      )
    UNION ALL
    SELECT 'free_no_promo', u.*
    FROM u
    WHERE NOT u.is_promo
      AND NOT u.ever_paid
      AND u.trial_end IS NULL
      AND (u.plan_key IS NULL OR u.plan_key = 'free')
  )
  SELECT
    t.cohort,
    COUNT(*)::INTEGER,
    COUNT(DISTINCT t.workshop_id)::INTEGER,
    SUM(t.diagnostics_total)::BIGINT,
    SUM(t.active_days)::BIGINT,
    ROUND(AVG(t.diagnostics_total), 3),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.diagnostics_total)::NUMERIC,
    MAX(t.diagnostics_total)::INTEGER,
    ROUND(100.0 * COUNT(*) FILTER (WHERE t.diagnostics_total > 0) / COUNT(*), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE t.diagnostics_total >= 2) / COUNT(*), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE t.diagnostics_total >= 10) / COUNT(*), 2),
    ROUND(AVG(t.active_days), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE t.diagnostics_30d > 0) / COUNT(*), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE t.ever_paid) / COUNT(*), 2),
    ROUND(AVG(t.chats), 3),
    ROUND(AVG(t.feature_events), 2),
    ROUND(AVG(t.logins), 2),
    COUNT(*) FILTER (WHERE t.logins > 0)::INTEGER,
    COUNT(*) FILTER (WHERE t.diagnostics_total > 0)::INTEGER,
    COUNT(*) FILTER (WHERE t.diagnostics_total >= 2)::INTEGER,
    COUNT(*) FILTER (WHERE t.diagnostics_total >= 10)::INTEGER,
    COUNT(*) FILTER (WHERE t.ever_paid)::INTEGER,
    COUNT(*) FILTER (WHERE t.diagnostics_30d > 0)::INTEGER
  FROM tagged t
  GROUP BY t.cohort
$$;

-- How the checkout cohort actually splits, so the page can explain in one line
-- why its "ever paid" cell is well under 100%.
CREATE OR REPLACE FUNCTION promo_checkout_composition()
RETURNS TABLE (
  charged INTEGER,
  trial_only INTEGER,
  carded_never_charged INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH u AS (
    SELECT * FROM promo_user_analysis(FALSE)
    WHERE NOT is_internal_test
      AND NOT is_promo
      AND (
        ever_paid
        OR trial_end IS NOT NULL
        OR (plan_key IS NOT NULL AND plan_key <> 'free')
      )
  )
  SELECT
    COUNT(*) FILTER (WHERE ever_paid)::INTEGER,
    COUNT(*) FILTER (WHERE NOT ever_paid AND trial_end IS NOT NULL)::INTEGER,
    COUNT(*) FILTER (
      WHERE NOT ever_paid
        AND trial_end IS NULL
        AND plan_key IS NOT NULL
        AND plan_key <> 'free'
    )::INTEGER
  FROM u
$$;

GRANT EXECUTE ON FUNCTION promo_cohort_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION promo_checkout_composition() TO authenticated, service_role;

-- Promo Users: keep the per-user read small, aggregate cohorts in SQL.
--
-- promo_user_analysis() as first written returns one row per app user: 1,806
-- rows today. PostgREST caps every response at db-max-rows (1000 on this
-- project) and TRUNCATES SILENTLY — error is null, the response just ends
-- short. The cohort comparison would therefore have been computed from an
-- arbitrary 1,000-row slice of the user base and looked entirely plausible.
--
-- Two changes:
--   1. promo_user_analysis(promo_only) defaults to promo users only (~53 rows),
--      which is all the per-user tabs actually render.
--   2. promo_cohort_stats() does the cohort maths in Postgres and returns
--      exactly three rows, so no cap can bite.
--
-- The parameter has to arrive via DROP + CREATE: CREATE OR REPLACE with a new
-- argument list creates an overload instead of replacing, and PostgREST would
-- then not know which one to call.

DROP FUNCTION IF EXISTS promo_user_analysis();

CREATE OR REPLACE FUNCTION promo_user_analysis(promo_only BOOLEAN DEFAULT TRUE)
RETURNS TABLE (
  internal_user_id TEXT,
  workshop_id TEXT,
  workshop_name TEXT,
  country TEXT,
  plan_key TEXT,
  subscription_status TEXT,
  payment_status TEXT,
  trial_end TIMESTAMPTZ,
  signed_up_at TIMESTAMPTZ,
  churned_at TIMESTAMPTZ,
  is_internal_test BOOLEAN,
  contact_id UUID,
  contact_email TEXT,
  is_promo BOOLEAN,
  promo_code TEXT,
  promo_coupon_id TEXT,
  promo_percent_off NUMERIC,
  promo_applied_at TIMESTAMPTZ,
  promo_last_applied_at TIMESTAMPTZ,
  promo_discount_cents BIGINT,
  promo_currency TEXT,
  promo_active BOOLEAN,
  promo_invoices INTEGER,
  ever_paid BOOLEAN,
  diagnostics_total INTEGER,
  diagnostics_first_at TIMESTAMPTZ,
  diagnostics_last_at TIMESTAMPTZ,
  diagnostics_30d INTEGER,
  diagnostics_before INTEGER,
  diagnostics_after INTEGER,
  diagnostics_after_30d INTEGER,
  chats INTEGER,
  feature_events INTEGER,
  logins INTEGER,
  active_days INTEGER,
  last_active_at TIMESTAMPTZ,
  calls INTEGER,
  calls_connected INTEGER,
  first_call_at TIMESTAMPTZ,
  last_call_at TIMESTAMPTZ,
  emails_sent INTEGER,
  first_email_at TIMESTAMPTZ,
  last_email_at TIMESTAMPTZ,
  opens INTEGER,
  clicks INTEGER,
  replies INTEGER,
  activity_count INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      u.internal_user_id,
      u.workshop_id,
      u.signed_up_at,
      u.churned_at,
      COALESCE(u.is_internal_test, FALSE) AS is_internal_test,
      w.name AS workshop_name,
      w.country,
      w.plan_key,
      w.core_subscription_status,
      w.payment_status,
      w.trial_end
    FROM dashboard_users u
    LEFT JOIN dashboard_workshops w ON w.workshop_id = u.workshop_id
  ),
  ct AS (
    SELECT DISTINCT ON (c.wl_user_id)
      c.wl_user_id::TEXT AS uid,
      c.id AS contact_id,
      LOWER(c.email) AS email,
      c.last_active_at
    FROM contacts c
    WHERE c.wl_user_id IS NOT NULL
    ORDER BY c.wl_user_id, c.last_contacted_at DESC NULLS LAST, c.created_at ASC
  ),
  ug AS (
    SELECT
      b.internal_user_id,
      MIN(g.first_applied_at) AS applied_at,
      MAX(g.last_applied_at) AS last_applied_at,
      SUM(g.total_discount_cents)::BIGINT AS discount_cents,
      MAX(g.currency) AS currency,
      BOOL_OR(g.active_on_subscription) AS active,
      SUM(g.invoice_count)::INTEGER AS invoices,
      (ARRAY_AGG(g.promotion_code ORDER BY g.total_discount_cents DESC NULLS LAST))[1] AS code,
      (ARRAY_AGG(g.coupon_id ORDER BY g.total_discount_cents DESC))[1] AS coupon_id,
      MAX(g.percent_off) AS percent_off
    FROM base b
    LEFT JOIN ct ON ct.uid = b.internal_user_id
    JOIN dashboard_promo_grants g
      ON g.workshop_id = b.workshop_id
      OR g.internal_user_id = b.internal_user_id
      OR (ct.email IS NOT NULL AND LOWER(g.customer_email) = ct.email)
    GROUP BY b.internal_user_id
  ),
  paid AS (
    SELECT s.workshop_id, BOOL_OR(s.metadata->>'ever_paid' = 'true') AS ever_paid
    FROM dashboard_subscriptions s
    WHERE s.workshop_id IS NOT NULL
    GROUP BY s.workshop_id
  ),
  diag AS (
    SELECT
      d.internal_user_id AS uid,
      COUNT(*)::INTEGER AS total,
      MIN(d.created_at) AS first_at,
      MAX(d.created_at) AS last_at,
      COUNT(*) FILTER (WHERE d.created_at >= NOW() - INTERVAL '30 days')::INTEGER AS last_30d
    FROM dashboard_diagnostics d
    WHERE d.internal_user_id IS NOT NULL
    GROUP BY d.internal_user_id
  ),
  ba AS (
    SELECT
      d.internal_user_id AS uid,
      COUNT(*) FILTER (WHERE d.created_at < ug.applied_at)::INTEGER AS before_count,
      COUNT(*) FILTER (WHERE d.created_at >= ug.applied_at)::INTEGER AS after_count,
      COUNT(*) FILTER (
        WHERE d.created_at >= ug.applied_at
          AND d.created_at < ug.applied_at + INTERVAL '30 days'
      )::INTEGER AS after_30d
    FROM dashboard_diagnostics d
    JOIN ug ON ug.internal_user_id = d.internal_user_id
    WHERE ug.applied_at IS NOT NULL
    GROUP BY d.internal_user_id
  ),
  chat AS (
    SELECT c.internal_user_id AS uid, COUNT(*)::INTEGER AS n
    FROM dashboard_diagnostic_chats c
    WHERE c.internal_user_id IS NOT NULL
    GROUP BY c.internal_user_id
  ),
  feat AS (
    SELECT f.internal_user_id AS uid, COALESCE(SUM(f.usage_count), 0)::INTEGER AS n
    FROM dashboard_feature_usage f
    WHERE f.granularity = 'day'
    GROUP BY f.internal_user_id
  ),
  logi AS (
    SELECT l.internal_user_id AS uid, COUNT(*)::INTEGER AS n, MAX(l.logged_in_at) AS last_at
    FROM dashboard_user_logins l
    GROUP BY l.internal_user_id
  ),
  act_days AS (
    SELECT uid, COUNT(DISTINCT day)::INTEGER AS n
    FROM (
      SELECT internal_user_id AS uid, DATE(created_at) AS day
      FROM dashboard_diagnostics WHERE internal_user_id IS NOT NULL
      UNION
      SELECT internal_user_id, DATE(period_start)
      FROM dashboard_feature_usage WHERE granularity = 'day'
      UNION
      SELECT internal_user_id, DATE(logged_in_at) FROM dashboard_user_logins
    ) s
    GROUP BY uid
  ),
  crm_calls AS (
    SELECT
      cs.contact_id,
      COUNT(*)::INTEGER AS n,
      COUNT(*) FILTER (WHERE cs.connected_at IS NOT NULL)::INTEGER AS connected,
      MIN(cs.started_at) AS first_at,
      MAX(cs.started_at) AS last_at
    FROM call_sessions cs
    WHERE cs.contact_id IS NOT NULL
    GROUP BY cs.contact_id
  ),
  crm_emails AS (
    SELECT eq.contact_id, COUNT(*)::INTEGER AS n, MIN(eq.sent_at) AS first_at, MAX(eq.sent_at) AS last_at
    FROM email_queue eq
    WHERE eq.contact_id IS NOT NULL AND eq.status = 'sent'
    GROUP BY eq.contact_id
  ),
  crm_events AS (
    SELECT
      eq.contact_id,
      COUNT(*) FILTER (WHERE e.event_type = 'open')::INTEGER AS opens,
      COUNT(*) FILTER (WHERE e.event_type = 'click')::INTEGER AS clicks
    FROM email_events e
    JOIN email_queue eq ON eq.id = e.email_queue_id
    WHERE eq.contact_id IS NOT NULL
    GROUP BY eq.contact_id
  ),
  crm_replies AS (
    SELECT im.contact_id, COUNT(*)::INTEGER AS n
    FROM inbox_messages im
    WHERE im.contact_id IS NOT NULL
    GROUP BY im.contact_id
  ),
  crm_acts AS (
    SELECT a.contact_id, COUNT(*)::INTEGER AS n
    FROM activities a
    WHERE a.contact_id IS NOT NULL
    GROUP BY a.contact_id
  )
  SELECT
    b.internal_user_id,
    b.workshop_id,
    b.workshop_name,
    b.country,
    b.plan_key,
    b.core_subscription_status,
    b.payment_status,
    b.trial_end,
    b.signed_up_at,
    b.churned_at,
    b.is_internal_test,
    ct.contact_id,
    ct.email,
    (ug.internal_user_id IS NOT NULL) AS is_promo,
    ug.code,
    ug.coupon_id,
    ug.percent_off,
    ug.applied_at,
    ug.last_applied_at,
    COALESCE(ug.discount_cents, 0),
    ug.currency,
    COALESCE(ug.active, FALSE),
    COALESCE(ug.invoices, 0),
    COALESCE(paid.ever_paid, FALSE),
    COALESCE(diag.total, 0),
    diag.first_at,
    diag.last_at,
    COALESCE(diag.last_30d, 0),
    COALESCE(ba.before_count, 0),
    COALESCE(ba.after_count, 0),
    COALESCE(ba.after_30d, 0),
    COALESCE(chat.n, 0),
    COALESCE(feat.n, 0),
    COALESCE(logi.n, 0),
    COALESCE(act_days.n, 0),
    NULLIF(GREATEST(
      COALESCE(diag.last_at, '-infinity'::TIMESTAMPTZ),
      COALESCE(logi.last_at, '-infinity'::TIMESTAMPTZ),
      COALESCE(ct.last_active_at, '-infinity'::TIMESTAMPTZ)
    ), '-infinity'::TIMESTAMPTZ) AS last_active_at,
    COALESCE(crm_calls.n, 0),
    COALESCE(crm_calls.connected, 0),
    crm_calls.first_at,
    crm_calls.last_at,
    COALESCE(crm_emails.n, 0),
    crm_emails.first_at,
    crm_emails.last_at,
    COALESCE(crm_events.opens, 0),
    COALESCE(crm_events.clicks, 0),
    COALESCE(crm_replies.n, 0),
    COALESCE(crm_acts.n, 0)
  FROM base b
  LEFT JOIN ct ON ct.uid = b.internal_user_id
  LEFT JOIN ug ON ug.internal_user_id = b.internal_user_id
  LEFT JOIN paid ON paid.workshop_id = b.workshop_id
  LEFT JOIN diag ON diag.uid = b.internal_user_id
  LEFT JOIN ba ON ba.uid = b.internal_user_id
  LEFT JOIN chat ON chat.uid = b.internal_user_id
  LEFT JOIN feat ON feat.uid = b.internal_user_id
  LEFT JOIN logi ON logi.uid = b.internal_user_id
  LEFT JOIN act_days ON act_days.uid = b.internal_user_id
  LEFT JOIN crm_calls ON crm_calls.contact_id = ct.contact_id
  LEFT JOIN crm_emails ON crm_emails.contact_id = ct.contact_id
  LEFT JOIN crm_events ON crm_events.contact_id = ct.contact_id
  LEFT JOIN crm_replies ON crm_replies.contact_id = ct.contact_id
  LEFT JOIN crm_acts ON crm_acts.contact_id = ct.contact_id
  WHERE (NOT promo_only) OR ug.internal_user_id IS NOT NULL
$$;

-- ---------------------------------------------------------------------------
-- Cohort comparison, three rows, no row cap to worry about.
--
-- Internal-test users are excluded on dashboard_users.is_internal_test, the
-- flag the sync maintains from the email domain. The page's own promo tables
-- additionally consult dashboard_internal_test_patterns via
-- loadInternalTestSets, which is a superset; for cohort denominators in the
-- thousands the difference is immaterial and doing it here keeps the maths in
-- one pass.
-- ---------------------------------------------------------------------------
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
    SELECT
      a.*,
      CASE
        WHEN a.is_promo THEN 'promo'
        WHEN a.ever_paid
          OR a.trial_end IS NOT NULL
          OR (a.plan_key IS NOT NULL AND a.plan_key <> 'free') THEN 'paid_no_promo'
        ELSE 'free_no_promo'
      END AS cohort
    FROM promo_user_analysis(FALSE) a
    WHERE NOT a.is_internal_test
  )
  SELECT
    u.cohort,
    COUNT(*)::INTEGER,
    COUNT(DISTINCT u.workshop_id)::INTEGER,
    SUM(u.diagnostics_total)::BIGINT,
    SUM(u.active_days)::BIGINT,
    ROUND(AVG(u.diagnostics_total), 3),
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY u.diagnostics_total)::NUMERIC,
    MAX(u.diagnostics_total)::INTEGER,
    ROUND(100.0 * COUNT(*) FILTER (WHERE u.diagnostics_total > 0) / COUNT(*), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE u.diagnostics_total >= 2) / COUNT(*), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE u.diagnostics_total >= 10) / COUNT(*), 2),
    ROUND(AVG(u.active_days), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE u.diagnostics_30d > 0) / COUNT(*), 2),
    ROUND(100.0 * COUNT(*) FILTER (WHERE u.ever_paid) / COUNT(*), 2),
    ROUND(AVG(u.chats), 3),
    ROUND(AVG(u.feature_events), 2),
    ROUND(AVG(u.logins), 2),
    COUNT(*) FILTER (WHERE u.logins > 0)::INTEGER,
    COUNT(*) FILTER (WHERE u.diagnostics_total > 0)::INTEGER,
    COUNT(*) FILTER (WHERE u.diagnostics_total >= 2)::INTEGER,
    COUNT(*) FILTER (WHERE u.diagnostics_total >= 10)::INTEGER,
    COUNT(*) FILTER (WHERE u.ever_paid)::INTEGER,
    COUNT(*) FILTER (WHERE u.diagnostics_30d > 0)::INTEGER
  FROM u
  GROUP BY u.cohort
$$;

GRANT EXECUTE ON FUNCTION promo_user_analysis(BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION promo_cohort_stats() TO authenticated, service_role;

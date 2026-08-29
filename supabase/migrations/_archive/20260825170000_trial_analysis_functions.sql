-- Trial Users deep analysis (/dashboard/trial-users).
--
-- Everyone who ever opened a One / Small / Large free trial: what they did with
-- it, whether they were ever charged, and what separates the trials that
-- converted from the ones that did not.
--
-- The same reasons the promo page aggregates in Postgres apply here. PostgREST
-- cannot GROUP BY, and the per-user rollup joins diagnostics + feature usage +
-- logins + five CRM tables; paging all of that into Node would blow both the
-- 8s per-statement timeout and the 60s route budget. It also caps every
-- response at 1000 rows and truncates SILENTLY, so any function that could
-- return one row per app user (1,806 today) must default to the trial subset.
--
-- SECURITY INVOKER (the default) is deliberate, matching promo_user_analysis:
-- these read workspace-scoped CRM tables and invoker semantics keep RLS applied
-- for an authenticated caller. The dashboard reads through the service-role
-- client, which bypasses RLS as it already does for every dashboard_* table.
--
-- search_path is pinned on each function so a caller cannot shadow the tables.
--
-- ---------------------------------------------------------------------------
-- GRAINS. Three are in play and mixing them produces wrong numbers:
--   * A TRIAL is one dashboard_subscriptions row with a trial_end. 385 trials
--     across 364 workshops today, because a handful of customers trialled
--     twice. Conversion rate is quoted per trial and per workshop, never mixed.
--   * BEHAVIOUR is per APP USER: a diagnosis is run by a person, and a
--     workshop can have several techs.
--   * OUTREACH is per CRM CONTACT, deduped, so a workshop's shared phone call
--     is not counted once per tech.
--
-- TRIAL TIER is deliberately NOT resolved here. dashboard_subscriptions.plan_key
-- holds Stripe PRICE IDS on historical rows and plan names on newer ones, and
-- the id -> tier table is hand-maintained; keeping a second copy of it in SQL is
-- how it drifts. These functions return the raw plan_key and the TypeScript
-- side resolves it through src/lib/ceo/plan-prices.ts, which is also what flags
-- an unrecognised price instead of silently mislabelling a tier.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. The trial spine: one row per trial, with a usable trial WINDOW.
--
-- Stripe knows exactly when a trial opened, but the warehouse never stored it:
-- the closest date on the row was the Stripe CUSTOMER creation date, and a
-- customer is routinely created at an abandoned checkout weeks before any trial
-- starts. 142 of 335 trial rows had a customer-to-trial-end gap over 40 days,
-- so treating that gap as the trial window counted activity from long before
-- the trial began.
--
-- The Stripe sync now writes metadata.trial_start (see stripe.ts). Until it has
-- run once, trial_start is absent on every historical row, so the window falls
-- back in two steps and REPORTS which one it used, rather than presenting an
-- estimate as a measurement:
--   'stripe'   — metadata.trial_start, exact.
--   'customer' — customer_created_at, but only when it lands within 40 days
--                before trial_end (covers the 7 / 14 / 30-day trials plus slop).
--   'assumed'  — trial_end minus the product's default 14 days.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trial_subscriptions()
RETURNS TABLE (
  stripe_subscription_id TEXT,
  workshop_id TEXT,
  stripe_customer_id TEXT,
  customer_email TEXT,
  workshop_name TEXT,
  country TEXT,
  is_internal_test BOOLEAN,
  status TEXT,
  plan_key TEXT,
  workshop_plan_key TEXT,
  currency TEXT,
  mrr_amount_cents INTEGER,
  trial_start TIMESTAMPTZ,
  trial_start_source TEXT,
  trial_end TIMESTAMPTZ,
  trial_length_days INTEGER,
  ever_paid BOOLEAN,
  first_paid_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  cancel_at TIMESTAMPTZ,
  has_promo BOOLEAN,
  is_partner BOOLEAN,
  extension_reason TEXT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH s AS (
    SELECT
      sub.*,
      (sub.metadata->>'trial_start')::TIMESTAMPTZ AS meta_trial_start,
      (sub.metadata->>'customer_created_at')::TIMESTAMPTZ AS meta_customer_created_at
    FROM dashboard_subscriptions sub
    WHERE sub.trial_end IS NOT NULL
  ),
  windowed AS (
    SELECT
      s.*,
      CASE
        WHEN s.meta_trial_start IS NOT NULL THEN s.meta_trial_start
        WHEN s.meta_customer_created_at
             BETWEEN s.trial_end - INTERVAL '40 days' AND s.trial_end
          THEN s.meta_customer_created_at
        ELSE s.trial_end - INTERVAL '14 days'
      END AS resolved_start,
      CASE
        WHEN s.meta_trial_start IS NOT NULL THEN 'stripe'
        WHEN s.meta_customer_created_at
             BETWEEN s.trial_end - INTERVAL '40 days' AND s.trial_end
          THEN 'customer'
        ELSE 'assumed'
      END AS resolved_source
    FROM s
  )
  SELECT
    w.stripe_subscription_id,
    w.workshop_id,
    w.stripe_customer_id,
    w.metadata->>'customer_email',
    ws.name,
    ws.country,
    COALESCE(ws.is_internal_test, FALSE),
    w.status,
    w.plan_key,
    ws.plan_key,
    w.currency,
    w.mrr_amount_cents,
    w.resolved_start,
    w.resolved_source,
    w.trial_end,
    GREATEST(
      0,
      ROUND(EXTRACT(EPOCH FROM (w.trial_end - w.resolved_start)) / 86400)
    )::INTEGER,
    (w.metadata->>'ever_paid' = 'true'),
    (w.metadata->>'first_paid_at')::TIMESTAMPTZ,
    w.canceled_at,
    w.cancel_at,
    EXISTS (
      SELECT 1 FROM dashboard_promo_grants g
      WHERE (w.workshop_id IS NOT NULL AND g.workshop_id = w.workshop_id)
         OR (w.stripe_customer_id IS NOT NULL AND g.stripe_customer_id = w.stripe_customer_id)
    ),
    (w.metadata ? 'partner' OR w.metadata ? 'partner_comp'),
    w.metadata->>'extension_reason'
  FROM windowed w
  LEFT JOIN dashboard_workshops ws ON ws.workshop_id = w.workshop_id
$$;


-- ---------------------------------------------------------------------------
-- 2. Per-user rollup for everyone inside a trial workshop.
--
-- Window vs outcome, for the three workshops that trialled twice: the WINDOW is
-- anchored on the FIRST trial (that is the one whose usage predicts anything),
-- while ever_paid is BOOL_OR across all of the workshop's trials and the status
-- columns come from the LATEST one. trial_count exposes the multiplicity so the
-- page can say so rather than hide it.
--
-- trial_only defaults to TRUE (~384 rows). Calling it with FALSE returns every
-- app user, which PostgREST truncates at 1000 rows with error = null — the
-- cohort function below is the only caller allowed to do that, and it runs
-- inside Postgres where no cap applies.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trial_user_analysis(trial_only BOOLEAN DEFAULT TRUE)
RETURNS TABLE (
  internal_user_id TEXT,
  workshop_id TEXT,
  workshop_name TEXT,
  country TEXT,
  is_internal_test BOOLEAN,
  contact_id UUID,
  email TEXT,
  signed_up_at TIMESTAMPTZ,
  churned_at TIMESTAMPTZ,
  is_trialer BOOLEAN,
  trial_count INTEGER,
  trial_start TIMESTAMPTZ,
  trial_start_source TEXT,
  trial_end TIMESTAMPTZ,
  trial_length_days INTEGER,
  trial_status TEXT,
  trial_plan_key TEXT,
  workshop_plan_key TEXT,
  trial_currency TEXT,
  trial_mrr_cents INTEGER,
  ever_paid BOOLEAN,
  first_paid_at TIMESTAMPTZ,
  trial_canceled_at TIMESTAMPTZ,
  has_promo BOOLEAN,
  diagnostics_total INTEGER,
  diagnostics_first_at TIMESTAMPTZ,
  diagnostics_last_at TIMESTAMPTZ,
  diagnostics_30d INTEGER,
  diagnostics_before_trial INTEGER,
  diagnostics_during_trial INTEGER,
  diagnostics_after_trial INTEGER,
  days_to_first_diagnosis INTEGER,
  chats INTEGER,
  feature_events INTEGER,
  logins INTEGER,
  active_days INTEGER,
  active_days_during_trial INTEGER,
  last_active_at TIMESTAMPTZ,
  calls INTEGER,
  calls_connected INTEGER,
  calls_during_trial INTEGER,
  first_call_at TIMESTAMPTZ,
  last_call_at TIMESTAMPTZ,
  emails_sent INTEGER,
  emails_during_trial INTEGER,
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
  WITH ts AS (
    SELECT * FROM trial_subscriptions() WHERE workshop_id IS NOT NULL
  ),
  -- One row per workshop: window from the first trial, outcome from the latest.
  wt AS (
    SELECT
      t.workshop_id,
      COUNT(*)::INTEGER AS trial_count,
      (ARRAY_AGG(t.trial_start ORDER BY t.trial_start))[1] AS trial_start,
      (ARRAY_AGG(t.trial_start_source ORDER BY t.trial_start))[1] AS trial_start_source,
      (ARRAY_AGG(t.trial_end ORDER BY t.trial_start))[1] AS trial_end,
      (ARRAY_AGG(t.trial_length_days ORDER BY t.trial_start))[1] AS trial_length_days,
      (ARRAY_AGG(t.status ORDER BY t.trial_end DESC))[1] AS status,
      (ARRAY_AGG(t.plan_key ORDER BY t.trial_end DESC))[1] AS plan_key,
      (ARRAY_AGG(t.workshop_plan_key ORDER BY t.trial_end DESC))[1] AS workshop_plan_key,
      (ARRAY_AGG(t.currency ORDER BY t.trial_end DESC))[1] AS currency,
      (ARRAY_AGG(t.mrr_amount_cents ORDER BY t.trial_end DESC))[1] AS mrr_amount_cents,
      (ARRAY_AGG(t.customer_email ORDER BY t.trial_end DESC))[1] AS customer_email,
      BOOL_OR(t.ever_paid) AS ever_paid,
      MIN(t.first_paid_at) AS first_paid_at,
      MAX(t.canceled_at) AS canceled_at,
      BOOL_OR(t.has_promo) AS has_promo
    FROM ts t
    GROUP BY t.workshop_id
  ),
  base AS (
    SELECT
      u.internal_user_id,
      u.workshop_id,
      u.signed_up_at,
      u.churned_at,
      COALESCE(u.is_internal_test, FALSE) AS is_internal_test,
      w.name AS workshop_name,
      w.country
    FROM dashboard_users u
    LEFT JOIN dashboard_workshops w ON w.workshop_id = u.workshop_id
  ),
  -- DISTINCT ON matters: a duplicated contact would multiply every CRM
  -- aggregate joined through it.
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
  -- Before / during / after the trial window. This is the cut that speaks to
  -- whether the trial was actually used, as opposed to merely paid for.
  ba AS (
    SELECT
      b.internal_user_id AS uid,
      COUNT(*) FILTER (WHERE d.created_at < wt.trial_start)::INTEGER AS before_count,
      COUNT(*) FILTER (
        WHERE d.created_at >= wt.trial_start AND d.created_at < wt.trial_end
      )::INTEGER AS during_count,
      COUNT(*) FILTER (WHERE d.created_at >= wt.trial_end)::INTEGER AS after_count
    FROM base b
    JOIN wt ON wt.workshop_id = b.workshop_id
    JOIN dashboard_diagnostics d ON d.internal_user_id = b.internal_user_id
    GROUP BY b.internal_user_id
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
  -- Active days are the union of real activity, never login counts: sessions
  -- here are long-lived and the median user has one login event ever.
  act_raw AS (
    SELECT internal_user_id AS uid, DATE(created_at) AS day
    FROM dashboard_diagnostics WHERE internal_user_id IS NOT NULL
    UNION
    SELECT internal_user_id, DATE(period_start)
    FROM dashboard_feature_usage WHERE granularity = 'day'
    UNION
    SELECT internal_user_id, DATE(logged_in_at) FROM dashboard_user_logins
  ),
  act_days AS (
    SELECT uid, COUNT(*)::INTEGER AS n FROM act_raw GROUP BY uid
  ),
  act_days_trial AS (
    SELECT a.uid, COUNT(*)::INTEGER AS n
    FROM act_raw a
    JOIN base b ON b.internal_user_id = a.uid
    JOIN wt ON wt.workshop_id = b.workshop_id
    WHERE a.day >= DATE(wt.trial_start) AND a.day < DATE(wt.trial_end)
    GROUP BY a.uid
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
  crm_calls_trial AS (
    SELECT cs.contact_id, COUNT(*)::INTEGER AS n
    FROM call_sessions cs
    JOIN ct ON ct.contact_id = cs.contact_id
    JOIN base b ON b.internal_user_id = ct.uid
    JOIN wt ON wt.workshop_id = b.workshop_id
    WHERE cs.started_at >= wt.trial_start AND cs.started_at < wt.trial_end
    GROUP BY cs.contact_id
  ),
  crm_emails AS (
    SELECT eq.contact_id, COUNT(*)::INTEGER AS n, MIN(eq.sent_at) AS first_at, MAX(eq.sent_at) AS last_at
    FROM email_queue eq
    WHERE eq.contact_id IS NOT NULL AND eq.status = 'sent'
    GROUP BY eq.contact_id
  ),
  crm_emails_trial AS (
    SELECT eq.contact_id, COUNT(*)::INTEGER AS n
    FROM email_queue eq
    JOIN ct ON ct.contact_id = eq.contact_id
    JOIN base b ON b.internal_user_id = ct.uid
    JOIN wt ON wt.workshop_id = b.workshop_id
    WHERE eq.status = 'sent'
      AND eq.sent_at >= wt.trial_start AND eq.sent_at < wt.trial_end
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
    b.is_internal_test,
    ct.contact_id,
    COALESCE(ct.email, LOWER(wt.customer_email)),
    b.signed_up_at,
    b.churned_at,
    (wt.workshop_id IS NOT NULL) AS is_trialer,
    COALESCE(wt.trial_count, 0),
    wt.trial_start,
    wt.trial_start_source,
    wt.trial_end,
    wt.trial_length_days,
    wt.status,
    wt.plan_key,
    wt.workshop_plan_key,
    wt.currency,
    wt.mrr_amount_cents,
    COALESCE(wt.ever_paid, FALSE),
    wt.first_paid_at,
    wt.canceled_at,
    COALESCE(wt.has_promo, FALSE),
    COALESCE(diag.total, 0),
    diag.first_at,
    diag.last_at,
    COALESCE(diag.last_30d, 0),
    COALESCE(ba.before_count, 0),
    COALESCE(ba.during_count, 0),
    COALESCE(ba.after_count, 0),
    CASE
      WHEN wt.trial_start IS NULL OR diag.first_at IS NULL THEN NULL
      ELSE ROUND(EXTRACT(EPOCH FROM (diag.first_at - wt.trial_start)) / 86400)::INTEGER
    END,
    COALESCE(chat.n, 0),
    COALESCE(feat.n, 0),
    COALESCE(logi.n, 0),
    COALESCE(act_days.n, 0),
    COALESCE(act_days_trial.n, 0),
    NULLIF(GREATEST(
      COALESCE(diag.last_at, '-infinity'::TIMESTAMPTZ),
      COALESCE(logi.last_at, '-infinity'::TIMESTAMPTZ),
      COALESCE(ct.last_active_at, '-infinity'::TIMESTAMPTZ)
    ), '-infinity'::TIMESTAMPTZ),
    COALESCE(crm_calls.n, 0),
    COALESCE(crm_calls.connected, 0),
    COALESCE(crm_calls_trial.n, 0),
    crm_calls.first_at,
    crm_calls.last_at,
    COALESCE(crm_emails.n, 0),
    COALESCE(crm_emails_trial.n, 0),
    crm_emails.first_at,
    crm_emails.last_at,
    COALESCE(crm_events.opens, 0),
    COALESCE(crm_events.clicks, 0),
    COALESCE(crm_replies.n, 0),
    COALESCE(crm_acts.n, 0)
  FROM base b
  LEFT JOIN wt ON wt.workshop_id = b.workshop_id
  LEFT JOIN ct ON ct.uid = b.internal_user_id
  LEFT JOIN diag ON diag.uid = b.internal_user_id
  LEFT JOIN ba ON ba.uid = b.internal_user_id
  LEFT JOIN chat ON chat.uid = b.internal_user_id
  LEFT JOIN feat ON feat.uid = b.internal_user_id
  LEFT JOIN logi ON logi.uid = b.internal_user_id
  LEFT JOIN act_days ON act_days.uid = b.internal_user_id
  LEFT JOIN act_days_trial ON act_days_trial.uid = b.internal_user_id
  LEFT JOIN crm_calls ON crm_calls.contact_id = ct.contact_id
  LEFT JOIN crm_calls_trial ON crm_calls_trial.contact_id = ct.contact_id
  LEFT JOIN crm_emails ON crm_emails.contact_id = ct.contact_id
  LEFT JOIN crm_emails_trial ON crm_emails_trial.contact_id = ct.contact_id
  LEFT JOIN crm_events ON crm_events.contact_id = ct.contact_id
  LEFT JOIN crm_replies ON crm_replies.contact_id = ct.contact_id
  LEFT JOIN crm_acts ON crm_acts.contact_id = ct.contact_id
  WHERE (NOT trial_only) OR wt.workshop_id IS NOT NULL
$$;


-- ---------------------------------------------------------------------------
-- 3. Cohort comparison, a handful of rows, no row cap to worry about.
--
-- Four cohorts. `trial_converted` and `trial_expired` are the two halves of the
-- concluded-trial population; `trial_live` is still running and its outcome is
-- unknown, so it must never be folded into a conversion denominator. The
-- never-trialed free base is the contrast that says whether trialers were a
-- different kind of user in the first place.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trial_cohort_stats()
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
  avg_diagnostics_during_trial NUMERIC,
  pct_used_during_trial NUMERIC,
  stage_logged_in INTEGER,
  stage_activated INTEGER,
  stage_used_in_trial INTEGER,
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
    SELECT * FROM trial_user_analysis(FALSE) WHERE NOT is_internal_test
  ),
  tagged AS (
    SELECT 'trial_converted' AS cohort, u.* FROM u WHERE u.is_trialer AND u.ever_paid
    UNION ALL
    SELECT 'trial_expired', u.*
    FROM u
    WHERE u.is_trialer AND NOT u.ever_paid AND u.trial_end <= NOW()
    UNION ALL
    SELECT 'trial_live', u.*
    FROM u
    WHERE u.is_trialer AND NOT u.ever_paid AND u.trial_end > NOW()
    UNION ALL
    SELECT 'never_trialed', u.* FROM u WHERE NOT u.is_trialer
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
    ROUND(AVG(t.diagnostics_during_trial), 3),
    ROUND(100.0 * COUNT(*) FILTER (WHERE t.diagnostics_during_trial > 0) / COUNT(*), 2),
    COUNT(*) FILTER (WHERE t.logins > 0)::INTEGER,
    COUNT(*) FILTER (WHERE t.diagnostics_total > 0)::INTEGER,
    COUNT(*) FILTER (WHERE t.diagnostics_during_trial > 0)::INTEGER,
    COUNT(*) FILTER (WHERE t.diagnostics_total >= 2)::INTEGER,
    COUNT(*) FILTER (WHERE t.diagnostics_total >= 10)::INTEGER,
    COUNT(*) FILTER (WHERE t.ever_paid)::INTEGER,
    COUNT(*) FILTER (WHERE t.diagnostics_30d > 0)::INTEGER
  FROM tagged t
  GROUP BY t.cohort
$$;


-- ---------------------------------------------------------------------------
-- 4. Weekly trial flow: started, ended, converted.
--
-- Buckets are seeded from the requested range rather than from the data, so a
-- week in which nothing happened renders as a zero instead of vanishing and
-- silently shortening the axis.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trial_weekly_flow(weeks INTEGER DEFAULT 26)
RETURNS TABLE (
  week DATE,
  started INTEGER,
  ended INTEGER,
  converted INTEGER,
  diagnostics INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH t AS (
    SELECT * FROM trial_subscriptions() WHERE NOT is_internal_test
  ),
  spine AS (
    SELECT generate_series(
      DATE_TRUNC('week', NOW() - (weeks || ' weeks')::INTERVAL)::DATE,
      DATE_TRUNC('week', NOW())::DATE,
      '1 week'::INTERVAL
    )::DATE AS week
  ),
  trial_users AS (
    SELECT DISTINCT u.internal_user_id
    FROM dashboard_users u
    JOIN t ON t.workshop_id = u.workshop_id
  ),
  d AS (
    SELECT DATE_TRUNC('week', dg.created_at)::DATE AS week, COUNT(*)::INTEGER AS n
    FROM dashboard_diagnostics dg
    JOIN trial_users tu ON tu.internal_user_id = dg.internal_user_id
    WHERE dg.created_at >= DATE_TRUNC('week', NOW() - (weeks || ' weeks')::INTERVAL)
    GROUP BY 1
  )
  SELECT
    s.week,
    (SELECT COUNT(*) FROM t WHERE DATE_TRUNC('week', t.trial_start)::DATE = s.week)::INTEGER,
    (SELECT COUNT(*) FROM t WHERE DATE_TRUNC('week', t.trial_end)::DATE = s.week)::INTEGER,
    (SELECT COUNT(*) FROM t
      WHERE t.ever_paid AND DATE_TRUNC('week', t.first_paid_at)::DATE = s.week)::INTEGER,
    COALESCE(d.n, 0)
  FROM spine s
  LEFT JOIN d ON d.week = s.week
  ORDER BY s.week
$$;


GRANT EXECUTE ON FUNCTION trial_subscriptions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION trial_user_analysis(BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION trial_cohort_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION trial_weekly_flow(INTEGER) TO authenticated, service_role;

-- Promo Users deep analysis (/dashboard/promo-users).
--
-- The first version of the page answered "who got a discount" by reading a few
-- dozen promo rows. Answering "does giving people promo codes actually work"
-- needs the opposite shape: per-user rollups for the WHOLE user base so the
-- promo cohort can be compared against everyone else, plus weekly time series.
--
-- That is a GROUP BY, and PostgREST cannot express one. Paging every row of
-- diagnostics + feature usage + logins + activities into the Node layer to
-- group them there would be ~50k rows per page load against a 60s budget and
-- an 8s per-statement PostgREST timeout. So the aggregation lives here, where
-- it is one indexed pass per table.
--
-- SECURITY INVOKER (the default) is deliberate: these functions read
-- workspace-scoped CRM tables (contacts, call_sessions, email_queue), and
-- invoker semantics keep RLS applied for an authenticated caller. The dashboard
-- reads through the service-role client, which bypasses RLS as it already does
-- for every dashboard_* table.
--
-- search_path is pinned on each function so a caller cannot shadow the tables.

-- ---------------------------------------------------------------------------
-- 0. Align workshop_id with the rest of the warehouse.
--
-- dashboard_promo_grants shipped with workshop_id as UUID, but every other
-- dashboard_* table stores workshop ids as TEXT (dashboard_users.workshop_id,
-- dashboard_workshops.workshop_id, dashboard_subscriptions.workshop_id). The
-- mismatch made every join below fail with `operator does not exist: uuid =
-- text`. Casting at each call site would have hidden the inconsistency and
-- defeated any index; changing the column is lossless and removes the footgun.
-- ---------------------------------------------------------------------------
ALTER TABLE dashboard_promo_grants
  ALTER COLUMN workshop_id TYPE TEXT USING workshop_id::TEXT;

-- ---------------------------------------------------------------------------
-- 1. Per-user rollup: one row per app user, promo attributes + all activity.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_user_analysis()
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
  -- One contact per app user. DISTINCT ON matters: a duplicated contact would
  -- multiply every CRM aggregate joined through it.
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
  -- A grant is matched to a user by workshop, by app user id, or by billing
  -- email. All three are needed: 42 of 45 grants carry a workshop, 38 an app
  -- user id, and email is the only bridge for the rest.
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
  -- Before/after the promo landed. This is the only cut that speaks to whether
  -- the discount CHANGED behaviour rather than merely coincided with it.
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
  -- Active days are derived the same way for both cohorts (union of real
  -- activity), never from login counts: sessions here are long-lived and the
  -- median user has one login event ever.
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
    GREATEST(
      COALESCE(diag.last_at, '-infinity'::TIMESTAMPTZ),
      COALESCE(logi.last_at, '-infinity'::TIMESTAMPTZ),
      COALESCE(ct.last_active_at, '-infinity'::TIMESTAMPTZ)
    ) AS last_active_at,
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
$$;

-- ---------------------------------------------------------------------------
-- 2. Weekly activity by cohort, for the trend charts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_weekly_activity(weeks INTEGER DEFAULT 26)
RETURNS TABLE (
  week DATE,
  cohort TEXT,
  active_users INTEGER,
  diagnostics INTEGER,
  chats INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH promo_users AS (
    SELECT DISTINCT u.internal_user_id
    FROM dashboard_users u
    LEFT JOIN (
      SELECT DISTINCT ON (c.wl_user_id) c.wl_user_id::TEXT AS uid, LOWER(c.email) AS email
      FROM contacts c WHERE c.wl_user_id IS NOT NULL
      ORDER BY c.wl_user_id, c.created_at
    ) ct ON ct.uid = u.internal_user_id
    JOIN dashboard_promo_grants g
      ON g.workshop_id = u.workshop_id
      OR g.internal_user_id = u.internal_user_id
      OR (ct.email IS NOT NULL AND LOWER(g.customer_email) = ct.email)
  ),
  -- Buckets are seeded from the requested range, not from the data, so a week
  -- in which one cohort did nothing renders as a zero instead of vanishing and
  -- silently shortening the axis.
  spine AS (
    SELECT generate_series(
      DATE_TRUNC('week', NOW() - (weeks || ' weeks')::INTERVAL)::DATE,
      DATE_TRUNC('week', NOW())::DATE,
      '1 week'::INTERVAL
    )::DATE AS week
  ),
  cohorts AS (SELECT 'promo' AS cohort UNION ALL SELECT 'control'),
  d AS (
    SELECT
      DATE_TRUNC('week', d.created_at)::DATE AS week,
      CASE WHEN pu.internal_user_id IS NOT NULL THEN 'promo' ELSE 'control' END AS cohort,
      d.internal_user_id AS uid,
      d.has_chat
    FROM dashboard_diagnostics d
    LEFT JOIN promo_users pu ON pu.internal_user_id = d.internal_user_id
    WHERE d.internal_user_id IS NOT NULL
      AND d.created_at >= DATE_TRUNC('week', NOW() - (weeks || ' weeks')::INTERVAL)
  )
  SELECT
    s.week,
    c.cohort,
    COALESCE(COUNT(DISTINCT d.uid), 0)::INTEGER,
    COALESCE(COUNT(d.uid), 0)::INTEGER,
    COALESCE(COUNT(d.uid) FILTER (WHERE d.has_chat), 0)::INTEGER
  FROM spine s
  CROSS JOIN cohorts c
  LEFT JOIN d ON d.week = s.week AND d.cohort = c.cohort
  GROUP BY s.week, c.cohort
  ORDER BY s.week, c.cohort
$$;

-- ---------------------------------------------------------------------------
-- 3. Diagnostics by week RELATIVE to the promo landing, for the before/after
--    read. Promo users only — a control user has no promo date to anchor on.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promo_relative_activity(span INTEGER DEFAULT 8)
RETURNS TABLE (
  rel_week INTEGER,
  diagnostics INTEGER,
  active_users INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH anchor AS (
    SELECT u.internal_user_id AS uid, MIN(g.first_applied_at) AS applied_at
    FROM dashboard_users u
    LEFT JOIN (
      SELECT DISTINCT ON (c.wl_user_id) c.wl_user_id::TEXT AS uid, LOWER(c.email) AS email
      FROM contacts c WHERE c.wl_user_id IS NOT NULL
      ORDER BY c.wl_user_id, c.created_at
    ) ct ON ct.uid = u.internal_user_id
    JOIN dashboard_promo_grants g
      ON g.workshop_id = u.workshop_id
      OR g.internal_user_id = u.internal_user_id
      OR (ct.email IS NOT NULL AND LOWER(g.customer_email) = ct.email)
    GROUP BY u.internal_user_id
    HAVING MIN(g.first_applied_at) IS NOT NULL
  ),
  spine AS (
    SELECT generate_series(-span, span)::INTEGER AS rel_week
  ),
  d AS (
    SELECT
      FLOOR(EXTRACT(EPOCH FROM (d.created_at - a.applied_at)) / 604800)::INTEGER AS rel_week,
      d.internal_user_id AS uid
    FROM dashboard_diagnostics d
    JOIN anchor a ON a.uid = d.internal_user_id
    WHERE d.created_at >= a.applied_at - (span || ' weeks')::INTERVAL
      AND d.created_at < a.applied_at + ((span + 1) || ' weeks')::INTERVAL
  )
  SELECT
    s.rel_week,
    COALESCE(COUNT(d.uid), 0)::INTEGER,
    COALESCE(COUNT(DISTINCT d.uid), 0)::INTEGER
  FROM spine s
  LEFT JOIN d ON d.rel_week = s.rel_week
  GROUP BY s.rel_week
  ORDER BY s.rel_week
$$;

GRANT EXECUTE ON FUNCTION promo_user_analysis() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION promo_weekly_activity(INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION promo_relative_activity(INTEGER) TO authenticated, service_role;

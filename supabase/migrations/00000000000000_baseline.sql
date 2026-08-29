--
-- Baseline schema for crm-for-saas.
--
-- Generated 2026-08-29 from the live Wrenchlane database (project
-- wdgiwuhehqpkhpvdzzzl) by `pg_dump --schema-only --no-owner --no-privileges
-- --schema=public`, then completed by hand with the parts pg_dump omits.
--
-- Why this file exists: the 129 migrations now in `_archive/` do not reproduce
-- the live schema. Many local files were never recorded as applied on the
-- remote and many remote entries have no local file, so `supabase db push`
-- refused to run. This file IS the schema, verified by round-tripping it
-- through an empty Supabase project and diffing the result against the live
-- dump. See docs/plans/productisation/01-migration-baseline.md.
--
-- Three things pg_dump did not give us and that are added by hand below:
--
--   1. CREATE EXTENSION. pg_net, pg_trgm and unaccent are installed into
--      `public`, and a --schema=public dump emits index and function bodies
--      that depend on them (public.gin_trgm_ops, public.unaccent) without
--      emitting the extensions themselves. Without this block the baseline
--      fails to apply.
--   2. The storage buckets and the one storage policy, which live outside
--      the public schema.
--   3. Nothing else. CREATE SCHEMA public and COMMENT ON SCHEMA public were
--      stripped because Supabase rejects them.
--
-- Deliberately NOT carried across: the nine pg_cron job rows. They have
-- Wrenchlane's production URL hardcoded in them, and restoring them into
-- another tenant's database would make it hammer Wrenchlane's app nine times
-- an hour. See ground rule R6.
--
-- Four tables have RLS deliberately disabled, matching production exactly:
-- _ops_queue_pause_2026_04_28, dashboard_cta_clicks,
-- dashboard_domain_health_checks and discovered_shops. discovered_shops is
-- almost certainly an isolation leak and is tracked to be fixed before phase
-- 08; it is carried faithfully here because changing behaviour would break
-- ground rule R1.
--

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


--
-- Extensions. These must come first: index expressions and function bodies
-- below reference public.gin_trgm_ops and public.unaccent.
--

CREATE SCHEMA IF NOT EXISTS extensions;

-- Installed into public (this is load-bearing: public.unaccent is referenced
-- as a regdictionary by public.immutable_unaccent).
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;

-- Installed into extensions.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- Pinned to pg_catalog by their own control files, so no WITH SCHEMA.
CREATE EXTENSION IF NOT EXISTS plpgsql;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Supabase-managed, present on every Supabase project.
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: dashboard_domain_portfolio_touch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dashboard_domain_portfolio_touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;


--
-- Name: find_fuzzy_company_matches(uuid, text, text, numeric, numeric, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_fuzzy_company_matches(p_workspace_id uuid, p_country_code text, p_name text, p_min_sim numeric DEFAULT 0.6, p_max_sim numeric DEFAULT 0.95, p_limit integer DEFAULT 10) RETURNS TABLE(id uuid, name text, similarity numeric, wl_workshop_id uuid, source text, org_number text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  SELECT
    c.id,
    c.name,
    similarity(lower(public.immutable_unaccent(c.name)), lower(public.immutable_unaccent(p_name)))::numeric AS similarity,
    c.wl_workshop_id,
    c.source,
    c.org_number
  FROM companies c
  WHERE c.workspace_id = p_workspace_id
    AND c.country_code = p_country_code
    AND similarity(lower(public.immutable_unaccent(c.name)), lower(public.immutable_unaccent(p_name)))
        BETWEEN p_min_sim AND p_max_sim
  ORDER BY similarity DESC, c.created_at ASC
  LIMIT p_limit;
$$;


--
-- Name: find_strict_company_match(uuid, text, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_strict_company_match(p_workspace_id uuid, p_country_code text, p_name text, p_min_sim numeric DEFAULT 0.95) RETURNS TABLE(id uuid, name text, similarity numeric, wl_workshop_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  SELECT
    c.id,
    c.name,
    similarity(lower(public.immutable_unaccent(c.name)), lower(public.immutable_unaccent(p_name)))::numeric AS similarity,
    c.wl_workshop_id
  FROM companies c
  WHERE c.workspace_id = p_workspace_id
    AND c.country_code = p_country_code
    AND similarity(lower(public.immutable_unaccent(c.name)), lower(public.immutable_unaccent(p_name))) >= p_min_sim
  ORDER BY similarity DESC, c.created_at ASC
  LIMIT 1;
$$;


--
-- Name: get_engaged_prospects(uuid, integer, integer, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_engaged_prospects(p_workspace_id uuid, p_min_opens integer DEFAULT 3, p_min_clicks integer DEFAULT 0, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 1000) RETURNS TABLE(contact_id uuid, first_name text, last_name text, email text, phone text, company_id uuid, company_name text, lead_status text, country_code text, primary_owner_id uuid, last_contacted_at timestamp with time zone, opens bigint, clicks bigint, emails_opened bigint, first_engaged_at timestamp with time zone, last_engaged_at timestamp with time zone, last_clicked_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
begin
  if auth.uid() is not null
     and p_workspace_id not in (select get_user_workspace_ids()) then
    raise exception 'not a member of workspace %', p_workspace_id
      using errcode = '42501';
  end if;

  return query
  with engagement as (
    select
      q.contact_id as cid,
      count(*) filter (where e.event_type = 'open') as n_opens,
      count(*) filter (where e.event_type = 'click') as n_clicks,
      count(distinct q.id) filter (where e.event_type = 'open') as n_emails_opened,
      min(e.created_at) as first_at,
      max(e.created_at) as last_at,
      max(e.created_at) filter (where e.event_type = 'click') as last_click_at
    from email_queue q
    join email_events e on e.email_queue_id = q.id
    where q.workspace_id = p_workspace_id
      and q.contact_id is not null
      and e.event_type in ('open', 'click')
    group by q.contact_id
  )
  select
    c.id,
    c.first_name::text,
    c.last_name::text,
    c.email::text,
    c.phone::text,
    c.company_id,
    co.name::text,
    c.lead_status::text,
    c.country_code::text,
    c.primary_owner_id,
    c.last_contacted_at,
    g.n_opens,
    g.n_clicks,
    g.n_emails_opened,
    g.first_at,
    g.last_at,
    g.last_click_at
  from engagement g
  join contacts c on c.id = g.cid
  left join companies co on co.id = c.company_id
  where c.workspace_id = p_workspace_id
    and c.status = 'active'
    and c.wl_user_id is null
    and g.n_opens >= p_min_opens
    and g.n_clicks >= p_min_clicks
    and (p_since is null or g.last_at >= p_since)
  order by g.n_clicks desc, g.last_at desc, g.n_opens desc, c.id
  limit p_limit;
end;
$$;


--
-- Name: FUNCTION get_engaged_prospects(p_workspace_id uuid, p_min_opens integer, p_min_clicks integer, p_since timestamp with time zone, p_limit integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_engaged_prospects(p_workspace_id uuid, p_min_opens integer, p_min_clicks integer, p_since timestamp with time zone, p_limit integer) IS 'Per-contact email engagement for non-app-user prospects, filtered to an engagement bar. Backs the Call Planner engaged_prospect playbook.';


--
-- Name: get_next_send_time(timestamp with time zone, text[], integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_next_send_time(p_after timestamp with time zone, p_send_days text[], p_start_hour integer, p_end_hour integer, p_timezone text) RETURNS timestamp with time zone
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_candidate TIMESTAMPTZ;
  v_local_time TIME;
  v_day_name TEXT;
  v_max_attempts INTEGER := 14; -- max 2 weeks lookahead
BEGIN
  v_candidate := p_after;
  
  FOR i IN 1..v_max_attempts LOOP
    v_local_time := (v_candidate AT TIME ZONE p_timezone)::TIME;
    v_day_name := lower(to_char(v_candidate AT TIME ZONE p_timezone, 'Dy'));
    
    -- Check if this day is a send day and within hours
    IF v_day_name = ANY(p_send_days) AND 
       EXTRACT(HOUR FROM v_local_time) >= p_start_hour AND
       EXTRACT(HOUR FROM v_local_time) < p_end_hour THEN
      RETURN v_candidate;
    END IF;
    
    -- If today is a send day but before start hour, jump to start hour
    IF v_day_name = ANY(p_send_days) AND EXTRACT(HOUR FROM v_local_time) < p_start_hour THEN
      RETURN date_trunc('day', v_candidate AT TIME ZONE p_timezone) + (p_start_hour || ' hours')::INTERVAL AT TIME ZONE p_timezone;
    END IF;
    
    -- Otherwise move to start of next day
    v_candidate := date_trunc('day', v_candidate AT TIME ZONE p_timezone) + INTERVAL '1 day' + (p_start_hour || ' hours')::INTERVAL AT TIME ZONE p_timezone;
  END LOOP;
  
  -- Fallback: return the candidate as-is
  RETURN v_candidate;
END;
$$;


--
-- Name: get_organic_analysis(timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_organic_analysis(p_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  WITH bounds AS (
    SELECT
      COALESCE(p_start, '2000-01-01'::timestamptz) AS lo,
      COALESCE(p_end, now() + interval '1 day') AS hi
  ),
  base AS (
    SELECT
      s.period_start,
      s.dimensions,
      max(s.value) FILTER (WHERE s.metric_key = 'organic_search_clicks') AS clicks,
      max(s.value) FILTER (WHERE s.metric_key = 'organic_search_impressions') AS impressions,
      max(s.value) FILTER (WHERE s.metric_key = 'organic_search_position') AS position
    FROM dashboard_metric_snapshots s, bounds b
    WHERE s.source_key = 'search_console'
      AND s.period_start >= b.lo
      AND s.period_start < b.hi
    GROUP BY s.period_start, s.dimension_key, s.dimensions
  ),
  totals AS (
    SELECT * FROM base
    WHERE dimensions IS NULL OR dimensions = '{}'::jsonb
  ),
  pages AS (
    SELECT
      period_start,
      dimensions->>'page' AS page,
      split_part(dimensions->>'page', '/', 3) AS host,
      clicks, impressions, position
    FROM base
    WHERE dimensions ? 'page'
  ),
  queries AS (
    SELECT period_start, dimensions->>'query' AS query, clicks, impressions, position
    FROM base
    WHERE dimensions ? 'query'
  ),
  countries AS (
    SELECT period_start, dimensions->>'country' AS country, clicks, impressions
    FROM base
    WHERE dimensions ? 'country'
  ),
  query_agg AS (
    SELECT
      query,
      sum(clicks) AS clicks,
      sum(impressions) AS impressions,
      CASE WHEN sum(impressions) > 0
        THEN round((sum(position * impressions) / sum(impressions))::numeric, 1)
        ELSE 0 END AS position
    FROM queries
    GROUP BY query
  ),
  page_agg AS (
    SELECT
      page,
      split_part(page, '/', 3) AS host,
      sum(clicks) AS clicks,
      sum(impressions) AS impressions,
      CASE WHEN sum(impressions) > 0
        THEN round((sum(position * impressions) / sum(impressions))::numeric, 1)
        ELSE 0 END AS position
    FROM pages
    GROUP BY page
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'range_start', (SELECT lo FROM bounds),
    'range_end', (SELECT hi FROM bounds),
    'daily', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.date)
      FROM (
        SELECT
          period_start::date AS date,
          COALESCE(sum(clicks), 0) AS clicks,
          COALESCE(sum(impressions), 0) AS impressions,
          COALESCE(round(avg(position)::numeric, 1), 0) AS position
        FROM totals GROUP BY 1
      ) x
    ), '[]'::jsonb),
    'daily_by_host', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.date, x.host)
      FROM (
        SELECT
          period_start::date AS date,
          host,
          COALESCE(sum(clicks), 0) AS clicks,
          COALESCE(sum(impressions), 0) AS impressions
        FROM pages WHERE host <> '' GROUP BY 1, 2
      ) x
    ), '[]'::jsonb),
    'monthly_by_host', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.month, x.host)
      FROM (
        SELECT
          date_trunc('month', period_start)::date AS month,
          host,
          COALESCE(sum(clicks), 0) AS clicks,
          COALESCE(sum(impressions), 0) AS impressions,
          count(DISTINCT page) FILTER (WHERE impressions > 0) AS pages
        FROM pages WHERE host <> '' GROUP BY 1, 2
      ) x
    ), '[]'::jsonb),
    'branded_monthly', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.month)
      FROM (
        SELECT
          date_trunc('month', period_start)::date AS month,
          COALESCE(sum(clicks) FILTER (WHERE is_brand), 0) AS branded_clicks,
          COALESCE(sum(impressions) FILTER (WHERE is_brand), 0) AS branded_impressions,
          COALESCE(sum(clicks) FILTER (WHERE NOT is_brand), 0) AS nonbranded_clicks,
          COALESCE(sum(impressions) FILTER (WHERE NOT is_brand), 0) AS nonbranded_impressions
        FROM (
          SELECT
            period_start, clicks, impressions,
            (query ILIKE '%wrenchlane%'
              OR query ILIKE '%wrench lane%'
              OR query ILIKE '%codeoc%') AS is_brand
          FROM queries
        ) q
        GROUP BY 1
      ) x
    ), '[]'::jsonb),
    'position_buckets', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.sort)
      FROM (
        SELECT
          CASE
            WHEN position <= 3 THEN '1-3'
            WHEN position <= 10 THEN '4-10'
            WHEN position <= 20 THEN '11-20'
            ELSE '21+'
          END AS bucket,
          CASE
            WHEN position <= 3 THEN 1
            WHEN position <= 10 THEN 2
            WHEN position <= 20 THEN 3
            ELSE 4
          END AS sort,
          COALESCE(sum(impressions), 0) AS impressions,
          COALESCE(sum(clicks), 0) AS clicks
        FROM queries WHERE position IS NOT NULL GROUP BY 1, 2
      ) x
    ), '[]'::jsonb),
    'zero_click', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.impressions DESC)
      FROM (
        SELECT query, impressions, clicks, position
        FROM query_agg
        WHERE clicks = 0 AND impressions >= 50
        ORDER BY impressions DESC LIMIT 25
      ) x
    ), '[]'::jsonb),
    'page_two', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.impressions DESC)
      FROM (
        SELECT query, impressions, clicks, position
        FROM query_agg
        WHERE position > 10 AND position <= 20 AND impressions >= 50
        ORDER BY impressions DESC LIMIT 25
      ) x
    ), '[]'::jsonb),
    'countries', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.impressions DESC)
      FROM (
        SELECT
          country,
          COALESCE(sum(clicks), 0) AS clicks,
          COALESCE(sum(impressions), 0) AS impressions,
          CASE WHEN sum(impressions) > 0
            THEN round((sum(clicks) / sum(impressions) * 100)::numeric, 2)
            ELSE 0 END AS ctr
        FROM countries GROUP BY 1
        ORDER BY 3 DESC LIMIT 20
      ) x
    ), '[]'::jsonb),
    'top_pages', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.impressions DESC)
      FROM (
        SELECT page, host, clicks, impressions, position,
          CASE WHEN impressions > 0
            THEN round((clicks / impressions * 100)::numeric, 2)
            ELSE 0 END AS ctr
        FROM page_agg
        ORDER BY impressions DESC LIMIT 25
      ) x
    ), '[]'::jsonb)
  );
$$;


--
-- Name: get_sequence_conversions(uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_sequence_conversions(p_workspace_id uuid, p_since timestamp with time zone DEFAULT (now() - '90 days'::interval)) RETURNS TABLE(sequence_id uuid, sequence_name text, sequence_status text, total_sends bigint, unique_recipients bigint, opened_recipients bigint, clicked_recipients bigint, attributed_signups bigint, conversion_rate numeric, median_lag_days numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  WITH attributed AS (
    SELECT
      c.attributed_to_sequence_id AS sequence_id,
      count(*) AS signups,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (c.created_at - c.attributed_at)) / 86400.0
      ) AS median_lag_days
    FROM contacts c
    WHERE c.workspace_id = p_workspace_id
      AND c.attributed_to_sequence_id IS NOT NULL
      AND c.created_at >= p_since
    GROUP BY 1
  ),
  sent_q AS (
    SELECT
      se.sequence_id,
      eq.id AS queue_id,
      eq.contact_id,
      EXISTS (
        SELECT 1 FROM email_events ev
        WHERE ev.email_queue_id = eq.id AND ev.event_type = 'open'
      ) AS opened,
      EXISTS (
        SELECT 1 FROM email_events ev
        WHERE ev.email_queue_id = eq.id AND ev.event_type = 'click'
      ) AS clicked
    FROM email_queue eq
    JOIN sequence_enrollments se ON eq.enrollment_id = se.id
    WHERE eq.workspace_id = p_workspace_id
      AND eq.status = 'sent'
      AND eq.sent_at >= p_since
  ),
  sends AS (
    SELECT
      sequence_id,
      count(*) AS sent_count,
      count(DISTINCT contact_id) AS unique_recipients,
      count(DISTINCT contact_id) FILTER (WHERE opened) AS opened_recipients,
      count(DISTINCT contact_id) FILTER (WHERE clicked) AS clicked_recipients
    FROM sent_q
    GROUP BY 1
  )
  SELECT
    s.id,
    s.name,
    s.status,
    COALESCE(sends.sent_count, 0)::bigint,
    COALESCE(sends.unique_recipients, 0)::bigint,
    COALESCE(sends.opened_recipients, 0)::bigint,
    COALESCE(sends.clicked_recipients, 0)::bigint,
    COALESCE(attributed.signups, 0)::bigint,
    CASE WHEN COALESCE(sends.unique_recipients, 0) > 0
      THEN ROUND(
        (COALESCE(attributed.signups, 0)::numeric / sends.unique_recipients::numeric) * 100,
        2
      )
      ELSE NULL END,
    ROUND(attributed.median_lag_days::numeric, 1)
  FROM sequences s
  LEFT JOIN sends ON sends.sequence_id = s.id
  LEFT JOIN attributed ON attributed.sequence_id = s.id
  WHERE s.workspace_id = p_workspace_id
    AND (sends.sent_count > 0 OR attributed.signups > 0)
  ORDER BY attributed.signups DESC NULLS LAST, sends.sent_count DESC NULLS LAST;
$$;


--
-- Name: get_sequence_stats(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_sequence_stats(p_sequence_id uuid) RETURNS json
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT json_build_object(
    'enrolled',     (SELECT COUNT(*) FROM sequence_enrollments WHERE sequence_id = p_sequence_id),
    'sent',         (SELECT COUNT(*) FROM email_queue eq JOIN sequence_enrollments se ON se.id = eq.enrollment_id WHERE se.sequence_id = p_sequence_id AND eq.status = 'sent'),
    'opened',       (SELECT COUNT(DISTINCT eq.id) FROM email_queue eq JOIN sequence_enrollments se ON se.id = eq.enrollment_id JOIN email_events ee ON ee.email_queue_id = eq.id WHERE se.sequence_id = p_sequence_id AND ee.event_type = 'open'),
    'clicked',      (SELECT COUNT(DISTINCT eq.id) FROM email_queue eq JOIN sequence_enrollments se ON se.id = eq.enrollment_id JOIN email_events ee ON ee.email_queue_id = eq.id WHERE se.sequence_id = p_sequence_id AND ee.event_type = 'click'),
    'replied',      (SELECT COUNT(DISTINCT eq.id) FROM email_queue eq JOIN sequence_enrollments se ON se.id = eq.enrollment_id JOIN email_events ee ON ee.email_queue_id = eq.id WHERE se.sequence_id = p_sequence_id AND ee.event_type = 'reply'),
    'bounced',      (SELECT COUNT(DISTINCT eq.id) FROM email_queue eq JOIN sequence_enrollments se ON se.id = eq.enrollment_id JOIN email_events ee ON ee.email_queue_id = eq.id WHERE se.sequence_id = p_sequence_id AND ee.event_type = 'bounce'),
    'unsubscribed', (SELECT COUNT(DISTINCT eq.id) FROM email_queue eq JOIN sequence_enrollments se ON se.id = eq.enrollment_id JOIN email_events ee ON ee.email_queue_id = eq.id WHERE se.sequence_id = p_sequence_id AND ee.event_type = 'unsubscribe')
  );
$$;


--
-- Name: get_user_workspace_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_workspace_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid();
$$;


--
-- Name: immutable_unaccent(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.immutable_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    SET search_path TO 'public', 'extensions'
    AS $_$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $_$;


--
-- Name: increment_variant_sends(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_variant_sends(p_variant_id uuid, p_delta integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE sequence_step_variants
  SET sends_count = sends_count + p_delta
  WHERE id = p_variant_id;
END;
$$;


--
-- Name: is_workspace_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_workspace_admin(ws_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;


--
-- Name: merge_companies(uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_companies(p_keep_id uuid, p_drop_id uuid, p_candidate_row_id uuid DEFAULT NULL::uuid, p_reviewer_id uuid DEFAULT NULL::uuid) RETURNS TABLE(keep_company_id uuid, dropped_company_id uuid, contacts_moved integer, deals_moved integer, activities_moved integer, list_memberships_moved integer, tags_after text[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  v_keep_workspace UUID;
  v_drop_workspace UUID;
  v_contacts_moved INT := 0;
  v_deals_moved INT := 0;
  v_activities_moved INT := 0;
  v_list_moved INT := 0;
  v_tags_after TEXT[];
  v_drop_row RECORD;
  v_keep_row RECORD;
BEGIN
  IF p_keep_id = p_drop_id THEN
    RAISE EXCEPTION 'keep_id and drop_id must differ';
  END IF;

  SELECT workspace_id INTO v_keep_workspace FROM companies WHERE id = p_keep_id;
  SELECT workspace_id INTO v_drop_workspace FROM companies WHERE id = p_drop_id;

  IF v_keep_workspace IS NULL OR v_drop_workspace IS NULL THEN
    RAISE EXCEPTION 'one or both companies not found';
  END IF;
  IF v_keep_workspace <> v_drop_workspace THEN
    RAISE EXCEPTION 'cross-workspace merge rejected';
  END IF;

  SELECT * INTO v_keep_row FROM companies WHERE id = p_keep_id;
  SELECT * INTO v_drop_row FROM companies WHERE id = p_drop_id;

  UPDATE contacts SET company_id = p_keep_id WHERE company_id = p_drop_id;
  GET DIAGNOSTICS v_contacts_moved = ROW_COUNT;

  UPDATE deals SET company_id = p_keep_id WHERE company_id = p_drop_id;
  GET DIAGNOSTICS v_deals_moved = ROW_COUNT;

  UPDATE activities SET company_id = p_keep_id WHERE company_id = p_drop_id;
  GET DIAGNOSTICS v_activities_moved = ROW_COUNT;

  v_list_moved := 0;

  v_tags_after := (
    SELECT ARRAY(
      SELECT DISTINCT unnest(
        COALESCE(v_keep_row.tags, ARRAY[]::text[])
        || COALESCE(v_drop_row.tags, ARRAY[]::text[])
      )
    )
  );

  UPDATE companies SET
    domain                  = COALESCE(v_keep_row.domain, v_drop_row.domain),
    website                 = COALESCE(v_keep_row.website, v_drop_row.website),
    phone                   = COALESCE(v_keep_row.phone, v_drop_row.phone),
    address                 = COALESCE(v_keep_row.address, v_drop_row.address),
    city                    = COALESCE(v_keep_row.city, v_drop_row.city),
    postal_code             = COALESCE(v_keep_row.postal_code, v_drop_row.postal_code),
    country                 = COALESCE(v_keep_row.country, v_drop_row.country),
    country_code            = COALESCE(v_keep_row.country_code, v_drop_row.country_code),
    industry                = COALESCE(v_keep_row.industry, v_drop_row.industry),
    category                = COALESCE(v_keep_row.category, v_drop_row.category),
    employee_count          = COALESCE(v_keep_row.employee_count, v_drop_row.employee_count),
    google_place_id         = COALESCE(v_keep_row.google_place_id, v_drop_row.google_place_id),
    rating                  = COALESCE(v_keep_row.rating, v_drop_row.rating),
    review_count            = COALESCE(v_keep_row.review_count, v_drop_row.review_count),
    linkedin_url            = COALESCE(v_keep_row.linkedin_url, v_drop_row.linkedin_url),
    instagram_url           = COALESCE(v_keep_row.instagram_url, v_drop_row.instagram_url),
    facebook_url            = COALESCE(v_keep_row.facebook_url, v_drop_row.facebook_url),
    org_number              = COALESCE(v_keep_row.org_number, v_drop_row.org_number),
    wl_workshop_id          = COALESCE(v_keep_row.wl_workshop_id, v_drop_row.wl_workshop_id),
    plan                    = COALESCE(v_keep_row.plan, v_drop_row.plan),
    customer_status         = COALESCE(v_keep_row.customer_status, v_drop_row.customer_status),
    lifecycle_stage         = COALESCE(v_keep_row.lifecycle_stage, v_drop_row.lifecycle_stage),
    activated_at            = COALESCE(v_keep_row.activated_at, v_drop_row.activated_at),
    stripe_customer_id      = COALESCE(v_keep_row.stripe_customer_id, v_drop_row.stripe_customer_id),
    stripe_subscription_id  = COALESCE(v_keep_row.stripe_subscription_id, v_drop_row.stripe_subscription_id),
    notes                   = COALESCE(v_keep_row.notes, v_drop_row.notes),
    tags                    = v_tags_after
  WHERE id = p_keep_id;

  UPDATE company_merge_candidates
  SET status = 'merged',
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE status = 'pending'
    AND (
      (primary_company_id = p_keep_id AND candidate_company_id = p_drop_id)
      OR (primary_company_id = p_drop_id AND candidate_company_id = p_keep_id)
    );

  UPDATE company_merge_candidates
  SET primary_company_id = p_keep_id
  WHERE status = 'pending' AND primary_company_id = p_drop_id;
  UPDATE company_merge_candidates
  SET candidate_company_id = p_keep_id
  WHERE status = 'pending' AND candidate_company_id = p_drop_id;
  DELETE FROM company_merge_candidates
  WHERE status = 'pending'
    AND primary_company_id = candidate_company_id;

  DELETE FROM companies WHERE id = p_drop_id;

  RETURN QUERY
  SELECT
    p_keep_id,
    p_drop_id,
    v_contacts_moved,
    v_deals_moved,
    v_activities_moved,
    v_list_moved,
    v_tags_after;
END;
$$;


--
-- Name: promo_checkout_composition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promo_checkout_composition() RETURNS TABLE(charged integer, trial_only integer, carded_never_charged integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
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


--
-- Name: promo_cohort_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promo_cohort_stats() RETURNS TABLE(cohort text, users integer, workshops integer, total_diagnostics bigint, total_active_days bigint, avg_diagnostics numeric, median_diagnostics numeric, max_diagnostics integer, pct_activated numeric, pct_repeat numeric, pct_power numeric, avg_active_days numeric, pct_active_30d numeric, pct_ever_paid numeric, avg_chats numeric, avg_feature_events numeric, avg_logins numeric, stage_logged_in integer, stage_activated integer, stage_repeat integer, stage_habit integer, stage_paid integer, stage_active_30d integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
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


--
-- Name: promo_relative_activity(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promo_relative_activity(span integer DEFAULT 8) RETURNS TABLE(rel_week integer, diagnostics integer, active_users integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
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


--
-- Name: promo_user_analysis(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promo_user_analysis(promo_only boolean DEFAULT true) RETURNS TABLE(internal_user_id text, workshop_id text, workshop_name text, country text, plan_key text, subscription_status text, payment_status text, trial_end timestamp with time zone, signed_up_at timestamp with time zone, churned_at timestamp with time zone, is_internal_test boolean, contact_id uuid, contact_email text, is_promo boolean, promo_code text, promo_coupon_id text, promo_percent_off numeric, promo_applied_at timestamp with time zone, promo_last_applied_at timestamp with time zone, promo_discount_cents bigint, promo_currency text, promo_active boolean, promo_invoices integer, ever_paid boolean, diagnostics_total integer, diagnostics_first_at timestamp with time zone, diagnostics_last_at timestamp with time zone, diagnostics_30d integer, diagnostics_before integer, diagnostics_after integer, diagnostics_after_30d integer, chats integer, feature_events integer, logins integer, active_days integer, last_active_at timestamp with time zone, calls integer, calls_connected integer, first_call_at timestamp with time zone, last_call_at timestamp with time zone, emails_sent integer, first_email_at timestamp with time zone, last_email_at timestamp with time zone, opens integer, clicks integer, replies integer, activity_count integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
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


--
-- Name: promo_weekly_activity(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promo_weekly_activity(weeks integer DEFAULT 26) RETURNS TABLE(week date, cohort text, active_users integer, diagnostics integer, chats integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
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


--
-- Name: recompute_company_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_company_owner(p_company_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_auto      boolean;
  v_primary   uuid;
  v_secondary uuid;
  v_source    text;
  v_touched   timestamptz;
begin
  select owner_auto into v_auto from public.companies where id = p_company_id;
  if v_auto is distinct from true then
    return;
  end if;

  -- Company touches = activities on the company itself + activities on any of
  -- its contacts.
  with touches as (
    select rt.rep_user_id, rt.touched_at, rt.type
    from public.rep_touches rt
    left join public.contacts c on c.id = rt.contact_id
    where rt.rep_user_id is not null
      and (rt.company_id = p_company_id or c.company_id = p_company_id)
  ),
  ranked as (
    select
      rep_user_id,
      max(touched_at) as last_touch,
      (array_agg(type order by touched_at desc))[1] as last_type
    from touches
    group by rep_user_id
    order by max(touched_at) desc
  )
  select
    (select rep_user_id from ranked offset 0 limit 1),
    (select rep_user_id from ranked offset 1 limit 1),
    (select last_type   from ranked offset 0 limit 1),
    (select last_touch  from ranked offset 0 limit 1)
  into v_primary, v_secondary, v_source, v_touched;

  update public.companies co
  set
    primary_owner_id     = v_primary,
    secondary_owner_id   = v_secondary,
    primary_owner_source = v_source,
    owner_updated_at     = case
      when co.primary_owner_id is distinct from v_primary
        or co.secondary_owner_id is distinct from v_secondary
      then coalesce(v_touched, now())
      else co.owner_updated_at
    end
  where co.id = p_company_id;
end;
$$;


--
-- Name: recompute_contact_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_contact_owner(p_contact_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
declare
  v_auto      boolean;
  v_primary   uuid;
  v_secondary uuid;
  v_source    text;
  v_touched   timestamptz;
begin
  select owner_auto into v_auto from public.contacts where id = p_contact_id;
  if v_auto is distinct from true then
    return; -- locked: never auto-overwrite a manual assignment
  end if;

  with ranked as (
    select
      rep_user_id,
      max(touched_at) as last_touch,
      (array_agg(type order by touched_at desc))[1] as last_type
    from public.rep_touches
    where contact_id = p_contact_id and rep_user_id is not null
    group by rep_user_id
    order by max(touched_at) desc
  )
  select
    (select rep_user_id from ranked offset 0 limit 1),
    (select rep_user_id from ranked offset 1 limit 1),
    (select last_type   from ranked offset 0 limit 1),
    (select last_touch  from ranked offset 0 limit 1)
  into v_primary, v_secondary, v_source, v_touched;

  update public.contacts c
  set
    primary_owner_id     = v_primary,
    secondary_owner_id   = v_secondary,
    primary_owner_source = v_source,
    owner_updated_at     = case
      when c.primary_owner_id is distinct from v_primary
        or c.secondary_owner_id is distinct from v_secondary
      then coalesce(v_touched, now())
      else c.owner_updated_at
    end
  where c.id = p_contact_id;
end;
$$;


--
-- Name: refresh_active_days_aggregates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_active_days_aggregates() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: FUNCTION refresh_active_days_aggregates(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_active_days_aggregates() IS 'Recomputes contacts.active_days_count from dashboard_diagnostics + dashboard_feature_usage (day granularity). Idempotent — only UPDATEs changed rows. Called from src/lib/ceo/sync/propagate-to-crm.ts after each dashboard sync.';


--
-- Name: refresh_diagnostics_aggregates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_diagnostics_aggregates() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: FUNCTION refresh_diagnostics_aggregates(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_diagnostics_aggregates() IS 'Recomputes contacts.diagnostics_* and companies.diagnostics_* from dashboard_diagnostics. Idempotent — only UPDATEs rows whose aggregates actually changed. Called from src/lib/ceo/sync/propagate-to-crm.ts after each S3 dashboard sync.';


--
-- Name: reorder_route_stops(uuid, uuid, jsonb, integer, integer, integer, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reorder_route_stops(p_route_id uuid, p_workspace_id uuid, p_stop_orders jsonb, p_total_drive_seconds integer, p_total_drive_meters integer, p_estimated_day_seconds integer, p_google_maps_deeplink text, p_routes_api_response jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_existing_count INT;
  v_input_count    INT;
BEGIN
  -- Verify the route belongs to the workspace
  IF NOT EXISTS (
    SELECT 1 FROM daily_routes
    WHERE id = p_route_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'route % not found in workspace %', p_route_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Verify the input set matches the existing stops 1:1 (no dupes, no extras, no missing)
  SELECT COUNT(*) INTO v_existing_count FROM route_stops WHERE route_id = p_route_id;
  SELECT COUNT(DISTINCT (s->>'id')::uuid) INTO v_input_count
    FROM jsonb_array_elements(p_stop_orders) s;
  IF v_existing_count <> v_input_count THEN
    RAISE EXCEPTION 'stopIds count mismatch: existing=% input_distinct=%',
      v_existing_count, v_input_count
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_stop_orders) s
    LEFT JOIN route_stops rs
      ON rs.id = (s->>'id')::uuid AND rs.route_id = p_route_id
    WHERE rs.id IS NULL
  ) THEN
    RAISE EXCEPTION 'stopIds contain ids not belonging to route %', p_route_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Phase A: bump every stop's order to a negative offset so the UNIQUE
  -- (route_id, stop_order) constraint can't collide during reassignment.
  UPDATE route_stops
  SET stop_order = -1 - stop_order
  WHERE route_id = p_route_id;

  -- Phase B: apply the new orders + leg drives.
  UPDATE route_stops rs
  SET
    stop_order        = (s->>'stop_order')::int,
    leg_drive_seconds = NULLIF(s->>'leg_drive_seconds', '')::int,
    leg_drive_meters  = NULLIF(s->>'leg_drive_meters',  '')::int
  FROM jsonb_array_elements(p_stop_orders) s
  WHERE rs.id = (s->>'id')::uuid
    AND rs.route_id = p_route_id;

  -- Update parent route totals + deeplink + raw response
  UPDATE daily_routes
  SET
    total_drive_seconds   = p_total_drive_seconds,
    total_drive_meters    = p_total_drive_meters,
    estimated_day_seconds = p_estimated_day_seconds,
    google_maps_deeplink  = p_google_maps_deeplink,
    routes_api_response   = p_routes_api_response,
    updated_at            = now()
  WHERE id = p_route_id;
END;
$$;


--
-- Name: reset_daily_send_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_daily_send_counts() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE gmail_accounts
  SET daily_sends_count = 0, daily_sends_reset_at = now()
  WHERE daily_sends_reset_at < now() - INTERVAL '24 hours';
END;
$$;


--
-- Name: safe_uuid(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.safe_uuid(t text) RETURNS uuid
    LANGUAGE plpgsql IMMUTABLE
    AS $$
begin
  return t::uuid;
exception when others then
  return null;
end;
$$;


--
-- Name: trg_recompute_owner_from_activity(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_recompute_owner_from_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_company uuid;
begin
  if new.contact_id is not null then
    perform public.recompute_contact_owner(new.contact_id);
    select company_id into v_company from public.contacts where id = new.contact_id;
    if v_company is not null then
      perform public.recompute_company_owner(v_company);
    end if;
  end if;

  if new.company_id is not null and new.company_id is distinct from v_company then
    perform public.recompute_company_owner(new.company_id);
  end if;

  return null;
end;
$$;


--
-- Name: trial_cohort_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trial_cohort_stats() RETURNS TABLE(cohort text, users integer, workshops integer, total_diagnostics bigint, total_active_days bigint, avg_diagnostics numeric, median_diagnostics numeric, max_diagnostics integer, pct_activated numeric, pct_repeat numeric, pct_power numeric, avg_active_days numeric, pct_active_30d numeric, pct_ever_paid numeric, avg_chats numeric, avg_feature_events numeric, avg_logins numeric, avg_diagnostics_during_trial numeric, pct_used_during_trial numeric, stage_logged_in integer, stage_activated integer, stage_used_in_trial integer, stage_repeat integer, stage_habit integer, stage_paid integer, stage_active_30d integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
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


--
-- Name: trial_subscriptions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trial_subscriptions() RETURNS TABLE(stripe_subscription_id text, workshop_id text, stripe_customer_id text, customer_email text, workshop_name text, country text, is_internal_test boolean, status text, plan_key text, workshop_plan_key text, currency text, mrr_amount_cents integer, trial_start timestamp with time zone, trial_start_source text, trial_end timestamp with time zone, trial_length_days integer, ever_paid boolean, first_paid_at timestamp with time zone, canceled_at timestamp with time zone, cancel_at timestamp with time zone, has_promo boolean, is_partner boolean, extension_reason text)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
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


--
-- Name: trial_user_analysis(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trial_user_analysis(trial_only boolean DEFAULT true) RETURNS TABLE(internal_user_id text, workshop_id text, workshop_name text, country text, is_internal_test boolean, contact_id uuid, email text, signed_up_at timestamp with time zone, churned_at timestamp with time zone, is_trialer boolean, trial_count integer, trial_start timestamp with time zone, trial_start_source text, trial_end timestamp with time zone, trial_length_days integer, trial_status text, trial_plan_key text, workshop_plan_key text, trial_currency text, trial_mrr_cents integer, ever_paid boolean, first_paid_at timestamp with time zone, trial_canceled_at timestamp with time zone, has_promo boolean, diagnostics_total integer, diagnostics_first_at timestamp with time zone, diagnostics_last_at timestamp with time zone, diagnostics_30d integer, diagnostics_before_trial integer, diagnostics_during_trial integer, diagnostics_after_trial integer, days_to_first_diagnosis integer, chats integer, feature_events integer, logins integer, active_days integer, active_days_during_trial integer, last_active_at timestamp with time zone, calls integer, calls_connected integer, calls_during_trial integer, first_call_at timestamp with time zone, last_call_at timestamp with time zone, emails_sent integer, emails_during_trial integer, first_email_at timestamp with time zone, last_email_at timestamp with time zone, opens integer, clicks integer, replies integer, activity_count integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
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


--
-- Name: trial_weekly_flow(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trial_weekly_flow(weeks integer DEFAULT 26) RETURNS TABLE(week date, started integer, ended integer, converted integer, diagnostics integer)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
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


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: workspace_ai_knowledge_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workspace_ai_knowledge_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    domain text,
    industry text,
    employee_count integer,
    annual_revenue numeric,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    country text,
    city text,
    linkedin_url text,
    tech_stack text[],
    revenue_range text,
    founded_year integer,
    description text,
    phone text,
    website text,
    address text,
    postal_code text,
    country_code character(2),
    instagram_url text,
    facebook_url text,
    google_place_id text,
    rating numeric(3,1),
    review_count integer,
    category text,
    parent_company_id uuid,
    tags text[],
    notes text,
    wl_workshop_id uuid,
    lifecycle_stage text,
    customer_status text,
    plan text,
    plan_billing_cycle text,
    mrr_cents integer,
    arr_cents integer,
    currency text,
    trial_ends_at timestamp with time zone,
    activated_at timestamp with time zone,
    churned_at timestamp with time zone,
    churn_reason text,
    stripe_customer_id text,
    stripe_subscription_id text,
    subscription_status text,
    payment_status text,
    acquisition_source text,
    created_by_agent text,
    account_owner_id uuid,
    member_count integer,
    last_active_at timestamp with time zone,
    health_score integer,
    source text,
    latitude double precision,
    longitude double precision,
    geocoded_at timestamp with time zone,
    skip_auto_followup boolean DEFAULT false NOT NULL,
    do_not_contact boolean DEFAULT false NOT NULL,
    min_revisit_interval_days integer,
    do_not_route boolean DEFAULT false NOT NULL,
    do_not_route_reason text,
    do_not_route_at timestamp with time zone,
    last_visited_at timestamp with time zone,
    org_number text,
    cfar_number text,
    marketing_opt_out boolean DEFAULT false NOT NULL,
    nix_blocked boolean DEFAULT false NOT NULL,
    is_sole_proprietor boolean DEFAULT false NOT NULL,
    employee_size_band text,
    county text,
    diagnostics_total integer,
    diagnostics_first_at timestamp with time zone,
    diagnostics_last_at timestamp with time zone,
    diagnostics_last_30d integer,
    primary_owner_id uuid,
    secondary_owner_id uuid,
    owner_auto boolean DEFAULT true NOT NULL,
    owner_updated_at timestamp with time zone,
    primary_owner_source text,
    is_partner boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN companies.wl_workshop_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.wl_workshop_id IS 'Wrenchlane platform workshop UUID. Populated only for rows that originated from the Wrenchlane app (existing customers). NULL for prospects, scraped shops, manual adds.';


--
-- Name: COLUMN companies.lifecycle_stage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.lifecycle_stage IS 'Sales/CS funnel stage: lead | mql | sql | trial | paying | churned | reactivation';


--
-- Name: COLUMN companies.customer_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.customer_status IS 'Operational customer status: trialing | active | paused | inactive | churned';


--
-- Name: COLUMN companies.mrr_cents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.mrr_cents IS 'Normalized monthly recurring revenue in minor units (yearly plans / 12).';


--
-- Name: COLUMN companies.org_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.org_number IS 'Swedish Organisationsnummer (10 digits). One per legal entity; chains share this across branches.';


--
-- Name: COLUMN companies.cfar_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.cfar_number IS 'SCB CFARnr — unique workplace identifier. One per physical location.';


--
-- Name: COLUMN companies.marketing_opt_out; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.marketing_opt_out IS 'Customer has opted out of marketing (SCB Reklamstatus). Send gate.';


--
-- Name: COLUMN companies.nix_blocked; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.nix_blocked IS 'Phone number is NIX/telefonspärr-registered. Call gate.';


--
-- Name: COLUMN companies.is_sole_proprietor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.is_sole_proprietor IS 'SCB Persondataflagga = fysisk person. Email is personal data under GDPR.';


--
-- Name: COLUMN companies.employee_size_band; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.employee_size_band IS 'SCB Storleksklass: 0 / 1-4 / 5-9 / 10-19 / 20-49 / 50-99 / 100-199 / 200+.';


--
-- Name: COLUMN companies.county; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.county IS 'SCB Län (Swedish county).';


--
-- Name: COLUMN companies.diagnostics_total; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.diagnostics_total IS 'Lifetime diagnostic scan count for this workshop. Refreshed by refresh_diagnostics_aggregates().';


--
-- Name: COLUMN companies.diagnostics_first_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.diagnostics_first_at IS 'Timestamp of this workshop''s first scan. NULL if no scans on record.';


--
-- Name: COLUMN companies.diagnostics_last_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.diagnostics_last_at IS 'Timestamp of this workshop''s most recent scan. NULL if no scans on record.';


--
-- Name: COLUMN companies.diagnostics_last_30d; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.diagnostics_last_30d IS 'Scan count in the trailing 30 days. Use as the recency signal for active-customer UI.';


--
-- Name: COLUMN companies.owner_auto; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.companies.owner_auto IS 'When true, primary/secondary owner are auto-assigned by most-recent contact. When false, the assignment is locked to whatever was set manually.';


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email text NOT NULL,
    first_name text,
    last_name text,
    phone text,
    company_id uuid,
    status text DEFAULT 'active'::text,
    lead_status text DEFAULT 'new'::text,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    last_contacted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    source text,
    title text,
    city text,
    country text,
    linkedin_url text,
    seniority text,
    email_status text DEFAULT 'unknown'::text NOT NULL,
    email_verified_at timestamp with time zone,
    address text,
    postal_code text,
    country_code character(2),
    all_emails text[],
    all_phones text[],
    instagram_url text,
    facebook_url text,
    language text,
    tags text[],
    notes text,
    is_primary boolean DEFAULT false,
    wl_user_id uuid,
    app_username text,
    app_role text,
    last_login_at timestamp with time zone,
    last_active_at timestamp with time zone,
    login_count integer,
    credits_remaining integer,
    user_plan_type text,
    user_subscription_status text,
    user_stripe_customer_id text,
    user_stripe_subscription_id text,
    diagnostics_total integer,
    diagnostics_first_at timestamp with time zone,
    diagnostics_last_at timestamp with time zone,
    diagnostics_last_30d integer,
    last_visited_at timestamp with time zone,
    last_emailed_at timestamp with time zone,
    attributed_to_send_id uuid,
    attributed_to_sequence_id uuid,
    attributed_via text,
    attributed_at timestamp with time zone,
    signed_up_at timestamp with time zone,
    website text,
    primary_owner_id uuid,
    secondary_owner_id uuid,
    owner_auto boolean DEFAULT true NOT NULL,
    owner_updated_at timestamp with time zone,
    primary_owner_source text,
    phone_searched_at timestamp with time zone,
    phone_search_outcome text,
    active_days_count integer,
    payment_status text,
    CONSTRAINT contacts_lead_status_check CHECK ((lead_status = ANY (ARRAY['new'::text, 'contacted'::text, 'qualified'::text, 'customer'::text, 'churned'::text]))),
    CONSTRAINT contacts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'bounced'::text, 'unsubscribed'::text, 'archived'::text])))
);


--
-- Name: COLUMN contacts.wl_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.wl_user_id IS 'Wrenchlane platform user UUID (AWS Cognito sub). Populated only for rows that originated from the Wrenchlane app. NULL for cold contacts/prospects.';


--
-- Name: COLUMN contacts.app_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.app_role IS 'Role inside the Wrenchlane app: admin | mechanic';


--
-- Name: COLUMN contacts.last_emailed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.last_emailed_at IS 'Last time an email was actually sent to this contact (email_queue.sent_at where status=sent). NULL = never emailed.';


--
-- Name: COLUMN contacts.website; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.website IS 'Website URL for this contact (their company/personal site). Mirrors companies.website.';


--
-- Name: COLUMN contacts.owner_auto; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.owner_auto IS 'When true, primary/secondary owner are auto-assigned by most-recent contact. When false, the assignment is locked to whatever was set manually.';


--
-- Name: COLUMN contacts.active_days_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.active_days_count IS 'Distinct Stockholm-time days with at least one product action (diagnostics + day-granularity feature usage). Refreshed by refresh_active_days_aggregates().';


--
-- Name: COLUMN contacts.payment_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contacts.payment_status IS 'Billing payment status of the app workshop this contact belongs to, mirrored from dashboard_workshops.payment_status by propagate-to-crm. Values: active | payment_failed | null (no subscription ever).';


--
-- Name: suppressions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppressions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email text,
    domain text,
    reason text NOT NULL,
    source text,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT suppressions_email_or_domain CHECK (((email IS NOT NULL) OR (domain IS NOT NULL)))
);


--
-- Name: google_ads_customer_match; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.google_ads_customer_match AS
 SELECT (c.id)::text AS user_id,
    lower(btrim(c.email)) AS email,
    NULLIF(btrim(c.phone), ''::text) AS phone_number,
    lower(NULLIF(btrim(c.first_name), ''::text)) AS first_name,
    lower(NULLIF(btrim(c.last_name), ''::text)) AS last_name,
    upper(NULLIF((c.country_code)::text, ''::text)) AS country_code,
    NULLIF(btrim(c.postal_code), ''::text) AS postal_code,
    (c.wl_user_id IS NOT NULL) AS is_app_user
   FROM (public.contacts c
     LEFT JOIN public.companies co ON ((co.id = c.company_id)))
  WHERE ((c.email IS NOT NULL) AND (c.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text) AND (lower(c.email) !~~ '%@wrenchlane.com'::text) AND (lower(c.email) !~~ '%@example.com'::text) AND (lower(c.email) !~~ '%test%@%'::text) AND (c.status <> ALL (ARRAY['bounced'::text, 'unsubscribed'::text])) AND (COALESCE(co.do_not_contact, false) = false) AND (COALESCE(co.marketing_opt_out, false) = false) AND (COALESCE(co.nix_blocked, false) = false) AND (NOT (EXISTS ( SELECT 1
           FROM public.suppressions s
          WHERE (s.active AND (lower(s.email) = lower(c.email)))))));


--
-- Name: google_ads_prospects; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.google_ads_prospects AS
 SELECT user_id,
    email,
    phone_number,
    first_name,
    last_name,
    country_code,
    postal_code
   FROM public.google_ads_customer_match
  WHERE (is_app_user = false);


--
-- Name: dashboard_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_users (
    internal_user_id text NOT NULL,
    workshop_id text,
    email_hash text,
    customer_io_id text,
    ga_client_id text,
    created_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    name text,
    phone text,
    core_stripe_customer_id text,
    is_internal_test boolean DEFAULT false NOT NULL,
    is_internal_test_exempt boolean DEFAULT false NOT NULL,
    internal_test_note text,
    internal_test_set_at timestamp with time zone,
    internal_test_set_by text,
    signed_up_at timestamp with time zone,
    churned_at timestamp with time zone
);


--
-- Name: COLUMN dashboard_users.signed_up_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.dashboard_users.signed_up_at IS 'Canonical signup timestamp. Populated by core_app sync writer using priority chain: user_created_at -> created_at -> workshop.created_at -> customer_io_created_at -> stripe_customer_created_at. The winning source is stamped on metadata.signed_up_at_source. Read directly by /ceo/new-users; do not recompute downstream.';


--
-- Name: google_ads_seg_base; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.google_ads_seg_base AS
 SELECT m.user_id,
    m.email,
    m.phone_number,
    m.first_name,
    m.last_name,
    m.country_code,
    m.postal_code,
    m.is_app_user,
    (du.metadata ->> 'plan_type'::text) AS plan_type,
    (du.metadata ->> 'subscription_status'::text) AS subscription_status,
    co.employee_size_band AS size_band
   FROM (((public.google_ads_customer_match m
     JOIN public.contacts c ON (((c.id)::text = m.user_id)))
     LEFT JOIN public.companies co ON ((co.id = c.company_id)))
     LEFT JOIN public.dashboard_users du ON (((du.internal_user_id = (c.wl_user_id)::text) AND (du.is_internal_test IS NOT TRUE))));


--
-- Name: google_ads_seg_free_users; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.google_ads_seg_free_users AS
 SELECT user_id,
    email,
    phone_number,
    first_name,
    last_name,
    country_code,
    postal_code
   FROM public.google_ads_seg_base
  WHERE (is_app_user AND ((plan_type IS NULL) OR (plan_type = 'free'::text)));


--
-- Name: google_ads_seg_paid_active; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.google_ads_seg_paid_active AS
 SELECT user_id,
    email,
    phone_number,
    first_name,
    last_name,
    country_code,
    postal_code
   FROM public.google_ads_seg_base
  WHERE (is_app_user AND (plan_type IS NOT NULL) AND (plan_type <> 'free'::text) AND (subscription_status = ANY (ARRAY['active'::text, 'trialing'::text])));


--
-- Name: google_ads_seg_paid_lapsed; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.google_ads_seg_paid_lapsed AS
 SELECT user_id,
    email,
    phone_number,
    first_name,
    last_name,
    country_code,
    postal_code
   FROM public.google_ads_seg_base
  WHERE (is_app_user AND (plan_type IS NOT NULL) AND (plan_type <> 'free'::text) AND ((subscription_status IS NULL) OR (subscription_status <> ALL (ARRAY['active'::text, 'trialing'::text]))));


--
-- Name: google_ads_seg_prospect_large; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.google_ads_seg_prospect_large AS
 SELECT user_id,
    email,
    phone_number,
    first_name,
    last_name,
    country_code,
    postal_code
   FROM public.google_ads_seg_base
  WHERE ((NOT is_app_user) AND (size_band = ANY (ARRAY['5-9'::text, '10-19'::text, '20-49'::text, '50-99'::text, '100-199'::text])));


--
-- Name: google_ads_seg_prospect_one; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.google_ads_seg_prospect_one AS
 SELECT user_id,
    email,
    phone_number,
    first_name,
    last_name,
    country_code,
    postal_code
   FROM public.google_ads_seg_base
  WHERE ((NOT is_app_user) AND (size_band = '0'::text));


--
-- Name: google_ads_seg_prospect_small; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.google_ads_seg_prospect_small AS
 SELECT user_id,
    email,
    phone_number,
    first_name,
    last_name,
    country_code,
    postal_code
   FROM public.google_ads_seg_base
  WHERE ((NOT is_app_user) AND (size_band = '1-4'::text));


--
-- Name: google_ads_wl_users; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.google_ads_wl_users AS
 SELECT (id)::text AS user_id,
    lower(btrim(email)) AS email,
    NULLIF(btrim(phone), ''::text) AS phone_number,
    lower(NULLIF(btrim(first_name), ''::text)) AS first_name,
    lower(NULLIF(btrim(last_name), ''::text)) AS last_name,
    upper(NULLIF((country_code)::text, ''::text)) AS country_code,
    NULLIF(btrim(postal_code), ''::text) AS postal_code
   FROM public.contacts c
  WHERE ((wl_user_id IS NOT NULL) AND (email IS NOT NULL) AND (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'::text) AND (lower(email) !~~ '%@wrenchlane.com'::text) AND (lower(email) !~~ '%@example.com'::text) AND (lower(email) !~~ '%test%@%'::text));


--
-- Name: VIEW google_ads_wl_users; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.google_ads_wl_users IS 'Customer Match audience: WrenchLane app users with TOS-accepted advertising consent. Read by the google_ads_reader role via the Google Ads Data Manager PostgreSQL connector. Recreated 2026-05-18.';


--
-- Name: _ops_queue_pause_2026_04_28; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._ops_queue_pause_2026_04_28 (
    queue_id uuid NOT NULL,
    contact_id uuid,
    country_code text,
    email text,
    scheduled_for timestamp with time zone,
    captured_at timestamp with time zone DEFAULT now()
);


--
-- Name: activation_plan_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activation_plan_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    name text DEFAULT 'New channel'::text NOT NULL,
    color text DEFAULT 'blue'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    collapsed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activation_plan_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activation_plan_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    group_id uuid NOT NULL,
    title text DEFAULT 'New touchpoint'::text NOT NULL,
    description text,
    day_start integer DEFAULT 0 NOT NULL,
    day_end integer DEFAULT 0 NOT NULL,
    trigger_type text DEFAULT 'day_offset'::text NOT NULL,
    anchor_event text,
    status text,
    color text,
    cio_campaign_id text,
    link_url text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    scenario_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    source_note text,
    CONSTRAINT activation_plan_items_day_start_nonneg CHECK ((day_start >= 0)),
    CONSTRAINT activation_plan_items_days_ordered CHECK ((day_end >= day_start)),
    CONSTRAINT activation_plan_items_trigger_type CHECK ((trigger_type = ANY (ARRAY['day_offset'::text, 'event'::text])))
);


--
-- Name: activation_plan_scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activation_plan_scenarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    plan_id uuid NOT NULL,
    name text DEFAULT 'New scenario'::text NOT NULL,
    description text,
    color text DEFAULT 'blue'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activation_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activation_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text DEFAULT 'Activation plan'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    type text NOT NULL,
    contact_id uuid,
    company_id uuid,
    deal_id uuid,
    user_id uuid,
    subject text,
    body text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    outcome text,
    CONSTRAINT activities_outcome_check CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['interested'::text, 'not_interested'::text, 'closed'::text, 'no_answer'::text, 'skipped'::text, 'left_voicemail'::text, 'callback_scheduled'::text, 'wrong_number'::text])))),
    CONSTRAINT activities_type_check CHECK ((type = ANY (ARRAY['email_sent'::text, 'email_received'::text, 'email_opened'::text, 'email_clicked'::text, 'email_bounced'::text, 'email_logged'::text, 'link_clicked'::text, 'contact_unsubscribed'::text, 'contact_created'::text, 'call'::text, 'meeting'::text, 'note'::text, 'task'::text, 'system'::text, 'deal_stage_change'::text, 'sequence_paused'::text, 'field_visit'::text, 'route_stop_removed'::text])))
);


--
-- Name: ai_failure_stories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_failure_stories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source_url text,
    source_subreddit text,
    source_author text,
    symptom text NOT NULL,
    ai_tool text,
    ai_claimed_cause text,
    action_taken text,
    cost_amount numeric,
    cost_currency text DEFAULT 'USD'::text,
    actual_cause text,
    outcome text DEFAULT 'failure'::text NOT NULL,
    our_verdict text DEFAULT 'not_reviewed'::text NOT NULL,
    our_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: articles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.articles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source_kind text DEFAULT 'free_topic'::text NOT NULL,
    source_ref text,
    source_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    format text NOT NULL,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    language text DEFAULT 'en'::text NOT NULL,
    title text,
    body text,
    hooks jsonb DEFAULT '[]'::jsonb NOT NULL,
    hashtags text[] DEFAULT '{}'::text[] NOT NULL,
    seo jsonb DEFAULT '{}'::jsonb NOT NULL,
    claims jsonb DEFAULT '[]'::jsonb NOT NULL,
    impact jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    published_url text,
    published_at timestamp with time zone,
    model text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    webflow_item_id text
);


--
-- Name: COLUMN articles.webflow_item_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.articles.webflow_item_id IS 'Webflow CMS item id, set when the article is first sent to the site. Present and status=approved means staged but not public; present and status=published means live.';


--
-- Name: call_agent_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_agent_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    company_id uuid,
    list_id uuid,
    campaign_key text,
    objective text,
    status text DEFAULT 'queued'::text NOT NULL,
    scheduled_for timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    skip_reason text,
    error text,
    call_session_id uuid,
    provider_conversation_id text,
    enqueued_by uuid,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT call_agent_jobs_status_check CHECK ((status = ANY (ARRAY['pending_approval'::text, 'queued'::text, 'processing'::text, 'calling'::text, 'done'::text, 'failed'::text, 'skipped'::text, 'dismissed'::text])))
);


--
-- Name: call_agent_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_agent_settings (
    workspace_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    mode text DEFAULT 'approve_each'::text NOT NULL,
    provider text DEFAULT 'elevenlabs'::text NOT NULL,
    provider_api_key_encrypted text,
    provider_agent_ids jsonb DEFAULT '{}'::jsonb NOT NULL,
    provider_kb_doc_id text,
    webhook_secret text,
    persona_name text DEFAULT 'Elsa'::text NOT NULL,
    voice_ids jsonb DEFAULT '{}'::jsonb NOT NULL,
    greeting_note text,
    daily_cap integer DEFAULT 10 NOT NULL,
    max_attempts_per_contact integer DEFAULT 2 NOT NULL,
    min_days_between_calls integer DEFAULT 30 NOT NULL,
    call_start_hour integer DEFAULT 9 NOT NULL,
    call_end_hour integer DEFAULT 16 NOT NULL,
    call_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
    languages_enabled text[] DEFAULT '{sv,en}'::text[] NOT NULL,
    callback_owner_user_id uuid,
    daily_call_count integer DEFAULT 0 NOT NULL,
    daily_call_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT call_agent_settings_mode_check CHECK ((mode = ANY (ARRAY['approve_each'::text, 'autonomous'::text])))
);


--
-- Name: call_exclusions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_exclusions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    value text NOT NULL,
    label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT call_exclusions_kind_check CHECK ((kind = ANY (ARRAY['domain'::text, 'email'::text, 'company'::text])))
);


--
-- Name: call_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    activity_id uuid,
    contact_id uuid,
    company_id uuid,
    user_id uuid,
    category text NOT NULL,
    severity text,
    title text,
    body text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT call_feedback_category_check CHECK ((category = ANY (ARRAY['bug'::text, 'feature_request'::text, 'complaint'::text, 'praise'::text, 'other'::text]))),
    CONSTRAINT call_feedback_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT call_feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'triaged'::text, 'planned'::text, 'shipped'::text, 'wont_do'::text])))
);


--
-- Name: call_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    contact_id uuid,
    company_id uuid,
    user_id uuid,
    list_id uuid,
    provider text DEFAULT '46elks'::text NOT NULL,
    provider_call_id text,
    direction text DEFAULT 'outbound'::text NOT NULL,
    from_number text,
    agent_number text,
    to_number text,
    status text DEFAULT 'dialing'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    connected_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_seconds integer,
    error text,
    recording_url text,
    recording_storage_path text,
    transcript jsonb,
    summary text,
    ai_json jsonb,
    ai_model text,
    ai_processed_at timestamp with time zone,
    live_tips jsonb,
    activity_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    initiated_by text DEFAULT 'human'::text NOT NULL,
    agent_job_id uuid,
    provider_conversation_id text,
    CONSTRAINT call_sessions_direction_check CHECK ((direction = ANY (ARRAY['outbound'::text, 'inbound'::text]))),
    CONSTRAINT call_sessions_initiated_by_check CHECK ((initiated_by = ANY (ARRAY['human'::text, 'agent'::text, 'switchboard'::text]))),
    CONSTRAINT call_sessions_status_check CHECK ((status = ANY (ARRAY['dialing'::text, 'in_progress'::text, 'completed'::text, 'processing'::text, 'processed'::text, 'failed'::text, 'no_recording'::text])))
);


--
-- Name: company_merge_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_merge_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    primary_company_id uuid NOT NULL,
    candidate_company_id uuid NOT NULL,
    similarity_score numeric(4,3) NOT NULL,
    match_signals jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_merge_candidates_no_self CHECK ((primary_company_id <> candidate_company_id)),
    CONSTRAINT company_merge_candidates_similarity_score_check CHECK (((similarity_score >= (0)::numeric) AND (similarity_score <= (1)::numeric))),
    CONSTRAINT company_merge_candidates_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'merged'::text, 'dismissed'::text])))
);


--
-- Name: contact_list_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_list_members (
    list_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now()
);


--
-- Name: contact_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_dynamic boolean DEFAULT false,
    filters jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    purpose text DEFAULT 'email'::text NOT NULL,
    exclusions jsonb
);


--
-- Name: daily_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_routes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    generated_by uuid,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    generation_batch_id uuid NOT NULL,
    mode text NOT NULL,
    mode_fallback_reason text,
    cluster_label text NOT NULL,
    origin_address text NOT NULL,
    origin_latitude double precision NOT NULL,
    origin_longitude double precision NOT NULL,
    scheduled_for date,
    status text DEFAULT 'candidate'::text NOT NULL,
    stop_count integer NOT NULL,
    total_drive_seconds integer NOT NULL,
    total_drive_meters integer NOT NULL,
    estimated_day_seconds integer NOT NULL,
    google_maps_deeplink text NOT NULL,
    routes_api_response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_to uuid,
    CONSTRAINT daily_routes_mode_check CHECK ((mode = ANY (ARRAY['mixed'::text, 'cold'::text, 'lapsed'::text]))),
    CONSTRAINT daily_routes_status_check CHECK ((status = ANY (ARRAY['candidate'::text, 'scheduled'::text, 'in_progress'::text, 'completed'::text, 'discarded'::text])))
);


--
-- Name: dashboard_cost_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_cost_entries (
    cost_entry_id text NOT NULL,
    section text NOT NULL,
    item_key text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    unit text DEFAULT 'count'::text NOT NULL,
    snapshot_at timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: dashboard_cta_clicks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_cta_clicks (
    id bigint NOT NULL,
    date date NOT NULL,
    host_name text NOT NULL,
    page_path text NOT NULL,
    button_text text DEFAULT ''::text NOT NULL,
    cta_location text DEFAULT ''::text NOT NULL,
    events integer DEFAULT 0 NOT NULL,
    users integer DEFAULT 0 NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_cta_clicks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dashboard_cta_clicks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dashboard_cta_clicks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dashboard_cta_clicks_id_seq OWNED BY public.dashboard_cta_clicks.id;


--
-- Name: dashboard_diagnostic_chats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_diagnostic_chats (
    chat_id text NOT NULL,
    diagnostic_id text,
    workshop_id text,
    internal_user_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    message_count integer DEFAULT 0 NOT NULL,
    chat_cost numeric DEFAULT 0 NOT NULL,
    total_input_tokens integer DEFAULT 0 NOT NULL,
    total_output_tokens integer DEFAULT 0 NOT NULL,
    total_thinking_tokens integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: dashboard_diagnostics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_diagnostics (
    diagnostic_id text NOT NULL,
    workshop_id text,
    internal_user_id text,
    parent_diagnostic_id text,
    status text,
    created_at timestamp with time zone,
    completed_at timestamp with time zone,
    analyzed_at timestamp with time zone,
    ai_model text,
    diag_cost numeric DEFAULT 0 NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    num_causes integer DEFAULT 0 NOT NULL,
    has_chat boolean DEFAULT false NOT NULL,
    has_invoice boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_domain_health_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_domain_health_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    domain text NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    dns_records jsonb DEFAULT '{}'::jsonb NOT NULL,
    blocklists jsonb DEFAULT '[]'::jsonb NOT NULL,
    send_metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    alerts jsonb DEFAULT '[]'::jsonb NOT NULL,
    run_notes text,
    CONSTRAINT dashboard_domain_health_checks_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'warning'::text, 'critical'::text])))
);


--
-- Name: TABLE dashboard_domain_health_checks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.dashboard_domain_health_checks IS 'Daily DNS + reputation + send-health snapshot per sending domain (currently wrenchlane.com). Written by /api/cron/domain-health.';


--
-- Name: dashboard_domain_portfolio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_domain_portfolio (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country_code text NOT NULL,
    country_name text NOT NULL,
    country_flag text,
    region text NOT NULL,
    tld text NOT NULL,
    rank integer NOT NULL,
    tld_type text NOT NULL,
    registry text,
    rationale text NOT NULL,
    market_share text,
    restrictions text,
    is_global_hack boolean DEFAULT false NOT NULL,
    status text DEFAULT 'not_started'::text NOT NULL,
    domain_name text,
    registrar text,
    annual_cost_eur numeric(10,2),
    notes text,
    purchased_at timestamp with time zone,
    installed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dashboard_domain_portfolio_rank_check CHECK (((rank >= 1) AND (rank <= 9))),
    CONSTRAINT dashboard_domain_portfolio_region_check CHECK ((region = ANY (ARRAY['north'::text, 'west'::text, 'south'::text, 'east'::text]))),
    CONSTRAINT dashboard_domain_portfolio_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'planning'::text, 'bought'::text, 'installed'::text, 'skipped'::text]))),
    CONSTRAINT dashboard_domain_portfolio_tld_type_check CHECK ((tld_type = ANY (ARRAY['native_cctld'::text, 'generic'::text, 'domain_hack'::text, 'subdomain_convention'::text, 'idn'::text, 'sponsored'::text])))
);


--
-- Name: TABLE dashboard_domain_portfolio; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.dashboard_domain_portfolio IS 'Per-country TLD recommendations + CEO''s decision tracking. Read from /ceo/domain-portfolio.';


--
-- Name: dashboard_feature_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_feature_usage (
    internal_user_id text NOT NULL,
    feature_key text NOT NULL,
    granularity text DEFAULT 'day'::text NOT NULL,
    period_start date NOT NULL,
    usage_count integer DEFAULT 0 NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT dashboard_feature_usage_granularity_check CHECK ((granularity = ANY (ARRAY['day'::text, 'month'::text])))
);


--
-- Name: dashboard_funnel_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_funnel_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_key text NOT NULL,
    step_key text NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    dimension_key text DEFAULT 'total'::text NOT NULL,
    dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    count numeric NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_internal_test_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_internal_test_patterns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    value text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text,
    CONSTRAINT dashboard_internal_test_patterns_kind_check CHECK ((kind = ANY (ARRAY['email'::text, 'username'::text])))
);


--
-- Name: dashboard_metric_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_metric_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_key text NOT NULL,
    metric_key text NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    dimension_key text DEFAULT 'total'::text NOT NULL,
    dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    value numeric NOT NULL,
    unit text DEFAULT 'count'::text NOT NULL,
    currency text,
    collected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_motor_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_motor_usage (
    motor_usage_id text NOT NULL,
    month date,
    database_name text,
    total_accesses integer DEFAULT 0 NOT NULL,
    unique_users integer DEFAULT 0 NOT NULL,
    unique_vehicles integer DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_promo_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_promo_grants (
    grant_id text NOT NULL,
    stripe_customer_id text,
    customer_email text,
    workshop_id text,
    internal_user_id text,
    promotion_code text,
    promotion_code_id text,
    coupon_id text NOT NULL,
    coupon_name text,
    percent_off numeric(5,2),
    amount_off_cents integer,
    duration text,
    duration_in_months integer,
    source text DEFAULT 'invoice'::text NOT NULL,
    active_on_subscription boolean DEFAULT false NOT NULL,
    stripe_subscription_id text,
    subscription_status text,
    first_applied_at timestamp with time zone,
    last_applied_at timestamp with time zone,
    invoice_count integer DEFAULT 0 NOT NULL,
    total_discount_cents bigint DEFAULT 0 NOT NULL,
    total_paid_cents bigint DEFAULT 0 NOT NULL,
    currency text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_raw_metric_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_raw_metric_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_key text NOT NULL,
    external_id text NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    payload jsonb NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_review_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_review_snapshots (
    id bigint NOT NULL,
    platform_slug text NOT NULL,
    captured_at date NOT NULL,
    rating numeric(2,1),
    review_count integer DEFAULT 0 NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    note text,
    entered_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_review_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dashboard_review_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dashboard_review_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dashboard_review_snapshots_id_seq OWNED BY public.dashboard_review_snapshots.id;


--
-- Name: dashboard_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_reviews (
    id bigint NOT NULL,
    platform_slug text NOT NULL,
    external_id text NOT NULL,
    rating numeric(2,1),
    title text,
    body text,
    author_name text,
    author_company text,
    review_url text,
    reviewed_at timestamp with time zone,
    response_text text,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.dashboard_reviews_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: dashboard_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.dashboard_reviews_id_seq OWNED BY public.dashboard_reviews.id;


--
-- Name: dashboard_source_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_source_accounts (
    source_key text NOT NULL,
    account_id text,
    display_name text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    last_success_at timestamp with time zone,
    watermark timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_subscriptions (
    stripe_subscription_id text NOT NULL,
    workshop_id text,
    stripe_customer_id text,
    status text NOT NULL,
    plan_key text,
    mrr_amount_cents integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'usd'::text NOT NULL,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    trial_end timestamp with time zone,
    cancel_at timestamp with time zone,
    canceled_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_key text NOT NULL,
    status text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    rows_read integer DEFAULT 0 NOT NULL,
    rows_written integer DEFAULT 0 NOT NULL,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: dashboard_user_attribution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_user_attribution (
    internal_user_id text NOT NULL,
    first_source text,
    first_medium text,
    first_campaign text,
    first_channel_group text,
    google_ads_campaign text,
    channel text DEFAULT 'unknown'::text NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_user_logins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_user_logins (
    internal_user_id text NOT NULL,
    logged_in_at timestamp with time zone NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_workshops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_workshops (
    workshop_id text NOT NULL,
    name text,
    owner_internal_user_id text,
    country text,
    plan_key text,
    activated_at timestamp with time zone,
    created_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    language text,
    core_subscription_status text,
    payment_status text,
    trial_end timestamp with time zone,
    created_by_agent boolean,
    core_stripe_customer_id text,
    core_stripe_subscription_id text,
    is_internal_test boolean DEFAULT false NOT NULL,
    internal_test_note text,
    internal_test_set_at timestamp with time zone,
    internal_test_set_by text,
    churned_at timestamp with time zone
);


--
-- Name: deal_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deal_contacts (
    deal_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    role text DEFAULT 'participant'::text
);


--
-- Name: deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    pipeline_id uuid NOT NULL,
    name text NOT NULL,
    amount numeric DEFAULT 0,
    stage text NOT NULL,
    probability integer DEFAULT 0,
    company_id uuid,
    owner_id uuid,
    expected_close_date date,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: diagnostic_videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diagnostic_videos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    youtube_id text NOT NULL,
    title text NOT NULL,
    channel text NOT NULL,
    url text NOT NULL,
    category text,
    description text,
    sort_order integer DEFAULT 0 NOT NULL,
    marked boolean DEFAULT false NOT NULL,
    summary text,
    veo3_prompt text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    dtc_codes text[] DEFAULT '{}'::text[] NOT NULL,
    source text DEFAULT 'seed'::text NOT NULL
);


--
-- Name: discovered_shops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discovered_shops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    google_place_id text,
    address text,
    street text,
    city text,
    postal_code text,
    state text,
    country text,
    country_code character(2),
    latitude numeric(10,8),
    longitude numeric(11,8),
    phone text,
    website text,
    domain text,
    primary_email text,
    all_emails text[],
    all_phones text[],
    instagram_url text,
    facebook_url text,
    linkedin_url text,
    category text,
    rating numeric(3,1),
    review_count integer,
    opening_hours jsonb,
    source text DEFAULT 'google_maps'::text,
    status text DEFAULT 'new'::text,
    crm_company_id uuid,
    crm_contact_id uuid,
    raw_data jsonb,
    scraped_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    email_valid boolean,
    email_check_detail text,
    all_categories text[],
    email_status text,
    email_verified_at timestamp with time zone,
    google_maps_url text,
    description text,
    permanently_closed boolean,
    temporarily_closed boolean,
    price_level integer,
    additional_info jsonb,
    twitter_url text,
    youtube_url text,
    plus_code text,
    popular_times jsonb,
    shop_type text,
    do_not_route boolean DEFAULT false NOT NULL,
    do_not_route_reason text,
    do_not_route_at timestamp with time zone
);


--
-- Name: dtc_comparisons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dtc_comparisons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid,
    code text NOT NULL,
    lemon_code_id uuid,
    wrenchlane_result_id uuid,
    agreement text,
    score integer,
    verdict jsonb DEFAULT '{}'::jsonb,
    model text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dtc_manual_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dtc_manual_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid,
    code text NOT NULL,
    chart text,
    part text,
    summary text,
    sections jsonb DEFAULT '[]'::jsonb,
    body text,
    source_url text,
    page_id integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dtc_manual_figures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dtc_manual_figures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code_id uuid,
    ord integer,
    filename text,
    caption text
);


--
-- Name: dtc_manual_vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dtc_manual_vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    make text NOT NULL,
    model text NOT NULL,
    year integer NOT NULL,
    engine text,
    source text,
    page_count integer,
    code_count integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dtc_search_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dtc_search_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    vehicle_id uuid,
    query text NOT NULL,
    code text,
    kind text DEFAULT 'lemon'::text NOT NULL,
    result_count integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dtc_wrenchlane_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dtc_wrenchlane_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid,
    code text NOT NULL,
    app_vehicle_id text,
    app_engine_code text,
    summary text,
    causes jsonb DEFAULT '[]'::jsonb,
    raw jsonb DEFAULT '{}'::jsonb,
    capture_method text DEFAULT 'browser'::text,
    source_url text,
    captured_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tracking_id uuid NOT NULL,
    email_queue_id uuid,
    event_type text NOT NULL,
    link_url text,
    user_agent text,
    ip_address inet,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT email_events_event_type_check CHECK ((event_type = ANY (ARRAY['open'::text, 'click'::text, 'reply'::text, 'bounce'::text, 'unsubscribe'::text])))
);


--
-- Name: email_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    enrollment_id uuid,
    step_id uuid,
    contact_id uuid NOT NULL,
    sender_account_id uuid,
    to_email text NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    body_text text,
    status text DEFAULT 'scheduled'::text,
    scheduled_for timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    gmail_message_id text,
    gmail_thread_id text,
    tracking_id uuid DEFAULT gen_random_uuid(),
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3,
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    variant_id uuid,
    CONSTRAINT email_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'scheduled'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])))
);


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    body_text text,
    variables text[] DEFAULT '{}'::text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: forum_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    reddit_id text NOT NULL,
    fullname text,
    subreddit text,
    title text NOT NULL,
    body text,
    author text,
    url text,
    score integer,
    num_comments integer,
    posted_at timestamp with time zone,
    status text DEFAULT 'new'::text NOT NULL,
    reply_id uuid,
    skipped_reason text,
    discovered_via text DEFAULT 'search'::text NOT NULL,
    search_query text,
    search_sort text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: forum_comment_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_comment_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    source_id uuid NOT NULL,
    account_id uuid,
    owner_label text NOT NULL,
    comment text,
    status text DEFAULT 'suggested'::text NOT NULL,
    posted_url text,
    posted_at timestamp with time zone,
    confirmed_via text,
    slack_message_ts text,
    slack_channel_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reddit_comment_url text,
    detected_author text,
    CONSTRAINT forum_comment_assignments_confirmed_via_check CHECK ((confirmed_via = ANY (ARRAY['crm'::text, 'slack_reaction'::text, 'reddit_detected'::text]))),
    CONSTRAINT forum_comment_assignments_source_check CHECK ((source = ANY (ARRAY['distribution'::text, 'post'::text]))),
    CONSTRAINT forum_comment_assignments_status_check CHECK ((status = ANY (ARRAY['suggested'::text, 'posted'::text, 'skipped'::text])))
);


--
-- Name: forum_distribution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_distribution (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    topic text DEFAULT 'ai-diagnostics-takeover'::text NOT NULL,
    subreddit text NOT NULL,
    subreddit_url text NOT NULL,
    tier text DEFAULT 'best_fit'::text NOT NULL,
    fit_reason text,
    recommended_angle text,
    suggested_title text,
    rules_note text,
    sort_order integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'recommended'::text NOT NULL,
    posted_url text,
    posted_at timestamp with time zone,
    score integer,
    num_comments integer,
    upvote_ratio numeric,
    traction_note text,
    last_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    suggested_body text,
    suggested_comment text,
    slack_notified_at timestamp with time zone,
    posted_by_account_id uuid,
    posted_by_username text,
    slack_thread_ts text,
    slack_channel_id text,
    slack_summary_ts text,
    slack_summary_channel text
);


--
-- Name: forum_gap_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_gap_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source_url text NOT NULL,
    source_subreddit text,
    source_author text,
    source_title text,
    source_body text,
    source_score integer,
    source_num_comments integer,
    confidence numeric,
    symptom text,
    ai_tool text,
    ai_claimed_cause text,
    action_taken text,
    cost_amount numeric,
    cost_currency text DEFAULT 'USD'::text,
    actual_cause text,
    outcome text DEFAULT 'failure'::text,
    status text DEFAULT 'new'::text NOT NULL,
    story_id uuid,
    model text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: forum_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    diagnostic_id text,
    scenario_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    forum_target text NOT NULL,
    post_type text DEFAULT 'help_question'::text NOT NULL,
    mention_level text DEFAULT 'none'::text NOT NULL,
    language text DEFAULT 'en'::text NOT NULL,
    generated_title text,
    generated_body text,
    status text DEFAULT 'drafted'::text NOT NULL,
    posted_url text,
    posted_at timestamp with time zone,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    score integer,
    num_comments integer,
    upvote_ratio numeric,
    traction_note text,
    last_checked_at timestamp with time zone,
    suggested_comment text,
    slack_notified_at timestamp with time zone,
    assigned_account_id uuid,
    slack_thread_ts text,
    slack_channel_id text,
    slack_summary_ts text,
    slack_summary_channel text,
    posted_by_account_id uuid,
    posted_by_username text,
    generation_options jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: forum_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source_url text,
    source_subreddit text,
    source_title text,
    source_body text,
    source_author text,
    source_score integer,
    source_num_comments integer,
    mention_level text DEFAULT 'none'::text NOT NULL,
    generated_body text,
    status text DEFAULT 'draft'::text NOT NULL,
    posted_url text,
    posted_at timestamp with time zone,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    posted_by_account_id uuid,
    posted_by_username text,
    score integer,
    num_comments integer,
    upvote_ratio numeric,
    traction_note text,
    last_checked_at timestamp with time zone,
    generation_options jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: forum_thread_replies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.forum_thread_replies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source text NOT NULL,
    source_id uuid NOT NULL,
    reddit_comment_id text NOT NULL,
    reddit_comment_url text,
    comment_author text,
    comment_excerpt text,
    comment_score integer,
    why text,
    priority integer DEFAULT 0 NOT NULL,
    assigned_owner_label text,
    account_id uuid,
    mention_level text DEFAULT 'none'::text NOT NULL,
    reply_text text,
    status text DEFAULT 'suggested'::text NOT NULL,
    posted_url text,
    posted_at timestamp with time zone,
    confirmed_via text,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    generation_options jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT forum_thread_replies_confirmed_via_check CHECK ((confirmed_via = ANY (ARRAY['crm'::text, 'reddit_detected'::text]))),
    CONSTRAINT forum_thread_replies_mention_level_check CHECK ((mention_level = ANY (ARRAY['none'::text, 'subtle'::text, 'explicit'::text]))),
    CONSTRAINT forum_thread_replies_source_check CHECK ((source = ANY (ARRAY['distribution'::text, 'post'::text]))),
    CONSTRAINT forum_thread_replies_status_check CHECK ((status = ANY (ARRAY['suggested'::text, 'posted'::text, 'skipped'::text])))
);


--
-- Name: gmail_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gmail_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    email_address text NOT NULL,
    display_name text,
    access_token text,
    refresh_token text,
    token_expires_at timestamp with time zone,
    signature_html text,
    daily_sends_count integer DEFAULT 0,
    daily_sends_reset_at timestamp with time zone DEFAULT now(),
    is_warmup boolean DEFAULT false,
    max_daily_sends integer DEFAULT 80,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    pause_reason text,
    warmup_enabled boolean DEFAULT true,
    warmup_start_date timestamp with time zone,
    warmup_stage text DEFAULT 'ramp'::text,
    warmup_day integer DEFAULT 0,
    target_daily_sends integer DEFAULT 50,
    domain_health jsonb DEFAULT '{}'::jsonb,
    health_score integer DEFAULT 50,
    signature text,
    min_send_interval_seconds integer DEFAULT 60 NOT NULL,
    CONSTRAINT gmail_accounts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disconnected'::text, 'rate_limited'::text])))
);


--
-- Name: COLUMN gmail_accounts.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gmail_accounts.status IS 'active | paused | disconnected | rate_limited | setup_pending';


--
-- Name: COLUMN gmail_accounts.warmup_stage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gmail_accounts.warmup_stage IS 'ramp | graduated | manual';


--
-- Name: gmail_sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gmail_sync_state (
    gmail_account_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    backfill_cursor text,
    backfill_done_at timestamp with time zone,
    last_synced_at timestamp with time zone,
    last_run_at timestamp with time zone,
    messages_synced integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inbox_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    gmail_account_id uuid NOT NULL,
    gmail_message_id text NOT NULL,
    gmail_thread_id text NOT NULL,
    email_queue_id uuid,
    contact_id uuid,
    from_email text NOT NULL,
    from_name text,
    subject text,
    body_html text,
    body_text text,
    received_at timestamp with time zone NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    category text DEFAULT 'uncategorized'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_auto_reply boolean DEFAULT false,
    detected_language text,
    subject_translated_en text,
    body_translated_en text,
    translation_model text,
    draft_en text,
    draft_generated_at timestamp with time zone,
    draft_model text,
    replied_at timestamp with time zone,
    reply_draft text,
    reply_draft_updated_at timestamp with time zone
);


--
-- Name: COLUMN inbox_messages.detected_language; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbox_messages.detected_language IS 'ISO 639-1 code of the source language (en, sv, lv, lt, et, fi, da, no, …). NULL = not yet processed.';


--
-- Name: COLUMN inbox_messages.subject_translated_en; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbox_messages.subject_translated_en IS 'English translation of subject. NULL when detected_language=en or translation failed.';


--
-- Name: COLUMN inbox_messages.body_translated_en; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbox_messages.body_translated_en IS 'English translation of body_html (HTML preserved). NULL when detected_language=en or translation failed.';


--
-- Name: COLUMN inbox_messages.translation_model; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbox_messages.translation_model IS 'Model used for the translation (audit trail, e.g. claude-haiku-4-5-20251001).';


--
-- Name: COLUMN inbox_messages.draft_en; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbox_messages.draft_en IS 'Suggested English reply to this incoming message, generated by Claude. User edits + approves before send. NULL = not yet generated.';


--
-- Name: COLUMN inbox_messages.draft_generated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbox_messages.draft_generated_at IS 'When the cached draft was produced. Used for cache-busting if we ever invalidate.';


--
-- Name: COLUMN inbox_messages.draft_model; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbox_messages.draft_model IS 'Model used to generate the cached draft (audit trail).';


--
-- Name: COLUMN inbox_messages.replied_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbox_messages.replied_at IS 'When a reply was sent in this thread. Set thread-wide on send + backfilled from email_sent activities. NULL = still needs a reply.';


--
-- Name: COLUMN inbox_messages.reply_draft; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbox_messages.reply_draft IS 'Human-composed reply-in-progress (English). Autosaved as the user types, cleared on send. Distinct from draft_en (the AI auto-draft cache).';


--
-- Name: COLUMN inbox_messages.reply_draft_updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.inbox_messages.reply_draft_updated_at IS 'When reply_draft was last autosaved.';


--
-- Name: journey_boards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journey_boards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text DEFAULT 'User Journey'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: journey_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journey_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    board_id uuid NOT NULL,
    type text DEFAULT 'note'::text NOT NULL,
    x double precision DEFAULT 0 NOT NULL,
    y double precision DEFAULT 0 NOT NULL,
    w double precision DEFAULT 200 NOT NULL,
    h double precision DEFAULT 200 NOT NULL,
    z integer DEFAULT 0 NOT NULL,
    content text,
    image_url text,
    color text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT journey_items_type CHECK ((type = ANY (ARRAY['note'::text, 'label'::text, 'image'::text, 'frame'::text])))
);


--
-- Name: phone_enrichment_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_enrichment_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    outcome text,
    saved_count integer DEFAULT 0 NOT NULL,
    website_added text,
    error text,
    attempts integer DEFAULT 0 NOT NULL,
    requested_by uuid,
    enqueued_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: phone_numbers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phone_numbers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    company_id uuid,
    contact_id uuid,
    number text NOT NULL,
    label text,
    is_primary boolean DEFAULT false NOT NULL,
    country_code text,
    source text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT phone_numbers_has_owner CHECK (((company_id IS NOT NULL) OR (contact_id IS NOT NULL)))
);


--
-- Name: pipelines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipelines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    stages jsonb DEFAULT '[{"name": "Lead", "color": "#6366f1", "order": 1, "probability": 10}, {"name": "Qualified", "color": "#8b5cf6", "order": 2, "probability": 25}, {"name": "Demo", "color": "#a855f7", "order": 3, "probability": 40}, {"name": "Proposal", "color": "#d946ef", "order": 4, "probability": 60}, {"name": "Negotiation", "color": "#ec4899", "order": 5, "probability": 80}, {"name": "Closed Won", "color": "#22c55e", "order": 6, "probability": 100}, {"name": "Closed Lost", "color": "#ef4444", "order": 7, "probability": 0}]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: prospector_saved_searches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospector_saved_searches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    filters jsonb NOT NULL,
    last_run_at timestamp with time zone,
    result_count integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: prospector_search_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospector_search_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    search_hash text NOT NULL,
    filters jsonb NOT NULL,
    results jsonb NOT NULL,
    pagination jsonb NOT NULL,
    searched_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: reddit_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reddit_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    username text,
    owner_label text NOT NULL,
    subreddits text[] DEFAULT '{}'::text[] NOT NULL,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    slack_user_id text,
    turns_wrenches boolean DEFAULT false NOT NULL,
    uses_ai_tools boolean DEFAULT false NOT NULL,
    can_mention_wrenchlane boolean DEFAULT false NOT NULL,
    persona_note text
);


--
-- Name: reddit_mentions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reddit_mentions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    kind text DEFAULT 'plaintext'::text NOT NULL,
    audience text DEFAULT 'third_party'::text NOT NULL,
    source_url text NOT NULL,
    subreddit text,
    author text,
    account_id uuid,
    matched_domain text,
    excerpt text,
    is_comment boolean DEFAULT false NOT NULL,
    score integer,
    num_comments integer,
    upvote_ratio numeric,
    sentiment text,
    context_tag text,
    ai_summary text,
    is_about_us boolean,
    status text DEFAULT 'new'::text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_checked_at timestamp with time zone,
    slack_notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rep_identity; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rep_identity AS
 SELECT DISTINCT user_id,
    first_value(user_id) OVER (PARTITION BY (lower(COALESCE(NULLIF(btrim(display_name), ''::text), email_address))) ORDER BY created_at, id) AS canonical_user_id
   FROM public.gmail_accounts ga
  WHERE (user_id IS NOT NULL);


--
-- Name: rep_touches; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.rep_touches AS
 SELECT raw.activity_id,
    raw.workspace_id,
    raw.contact_id,
    raw.company_id,
    raw.touched_at,
    raw.type,
    COALESCE(ri.canonical_user_id, raw.rep_user_id) AS rep_user_id
   FROM (( SELECT a.id AS activity_id,
            a.workspace_id,
            a.contact_id,
            a.company_id,
            a.created_at AS touched_at,
            a.type,
                CASE
                    WHEN (a.type = ANY (ARRAY['call'::text, 'meeting'::text, 'note'::text, 'field_visit'::text])) THEN a.user_id
                    WHEN (a.type = ANY (ARRAY['email_sent'::text, 'email_received'::text])) THEN ( SELECT ga.user_id
                       FROM public.gmail_accounts ga
                      WHERE (ga.id = COALESCE(public.safe_uuid((a.metadata ->> 'sender_account_id'::text)), ( SELECT eq.sender_account_id
                               FROM public.email_queue eq
                              WHERE (eq.id = public.safe_uuid((a.metadata ->> 'email_queue_id'::text)))))))
                    ELSE NULL::uuid
                END AS rep_user_id
           FROM public.activities a
          WHERE (a.type = ANY (ARRAY['email_sent'::text, 'email_received'::text, 'call'::text, 'meeting'::text, 'note'::text, 'field_visit'::text]))) raw
     LEFT JOIN public.rep_identity ri ON ((ri.user_id = raw.rep_user_id)));


--
-- Name: roadmap_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roadmap_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    roadmap_id uuid NOT NULL,
    name text DEFAULT 'New group'::text NOT NULL,
    color text DEFAULT 'blue'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    collapsed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roadmap_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roadmap_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    roadmap_id uuid NOT NULL,
    group_id uuid NOT NULL,
    title text DEFAULT 'New item'::text NOT NULL,
    description text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    status text,
    owner text,
    phase text,
    priority text,
    team text,
    color text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    progress_note text,
    progress_updated_at timestamp with time zone,
    CONSTRAINT roadmap_items_dates_ordered CHECK ((end_date >= start_date))
);


--
-- Name: roadmaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roadmaps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text DEFAULT 'Untitled roadmap'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: route_stops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_stops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    stop_order integer NOT NULL,
    discovered_shop_id uuid,
    company_id uuid,
    shop_name text NOT NULL,
    shop_address text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    leg_drive_seconds integer,
    leg_drive_meters integer,
    visited_at timestamp with time zone,
    visit_outcome text,
    visit_notes text,
    follow_up_required boolean,
    CONSTRAINT route_stops_one_target CHECK (((((discovered_shop_id IS NOT NULL))::integer + ((company_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT route_stops_visit_outcome_check CHECK ((visit_outcome = ANY (ARRAY['interested'::text, 'not_interested'::text, 'closed'::text, 'no_answer'::text, 'skipped'::text])))
);


--
-- Name: security_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    finding_key text NOT NULL,
    title text NOT NULL,
    category text NOT NULL,
    severity text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    affected_path text,
    description text NOT NULL,
    remediation text,
    source text DEFAULT 'manual_audit'::text NOT NULL,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL,
    fixed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT security_findings_category_check CHECK ((category = ANY (ARRAY['auth'::text, 'idor'::text, 'xss'::text, 'injection'::text, 'secrets'::text, 'headers'::text, 'deps'::text, 'cron'::text, 'rls'::text, 'config'::text, 'external'::text, 'other'::text]))),
    CONSTRAINT security_findings_severity_check CHECK ((severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text, 'info'::text]))),
    CONSTRAINT security_findings_source_check CHECK ((source = ANY (ARRAY['manual_audit'::text, 'daily_scan'::text, 'ci_scan'::text]))),
    CONSTRAINT security_findings_status_check CHECK ((status = ANY (ARRAY['open'::text, 'fixed'::text, 'accepted_risk'::text, 'wont_fix'::text])))
);


--
-- Name: security_scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.security_scans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ran_at timestamp with time zone DEFAULT now() NOT NULL,
    scan_type text NOT NULL,
    passed boolean DEFAULT true NOT NULL,
    severity_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    details jsonb DEFAULT '[]'::jsonb NOT NULL,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT security_scans_scan_type_check CHECK ((scan_type = ANY (ARRAY['live_probe'::text, 'ci_static'::text])))
);


--
-- Name: sequence_auto_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequence_auto_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    sequence_id uuid NOT NULL,
    list_id uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    allow_customers boolean DEFAULT false NOT NULL,
    unenroll_when_left_list boolean DEFAULT false NOT NULL,
    sender_account_id uuid,
    last_run_at timestamp with time zone,
    last_result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE sequence_auto_enrollments; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sequence_auto_enrollments IS 'Continuous enrollment: /api/cron/auto-enroll resolves list_id (dynamic lists roll forward on their own) and enrolls new members into sequence_id via enrollContacts(). Dedup is inherent — enrollContacts skips contacts ever enrolled in the sequence.';


--
-- Name: sequence_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequence_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    sender_account_id uuid,
    status text DEFAULT 'active'::text,
    current_step integer DEFAULT 0,
    enrolled_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    language text,
    CONSTRAINT sequence_enrollments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'replied'::text, 'unsubscribed'::text, 'bounced'::text, 'paused'::text])))
);


--
-- Name: COLUMN sequence_enrollments.language; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_enrollments.language IS 'Language pinned at enrollment (contacts.language, else country default, else the sequence default). Drives variant selection for every step and is the grouping key for per-language analytics.';


--
-- Name: sequence_step_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequence_step_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence_step_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    subject text DEFAULT ''::text NOT NULL,
    body_html text DEFAULT ''::text NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    ai_generated boolean DEFAULT false NOT NULL,
    ai_generation_model text,
    ai_parent_variant_id uuid,
    sends_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    language text,
    CONSTRAINT sequence_step_variants_weight_check CHECK ((weight >= 0))
);


--
-- Name: COLUMN sequence_step_variants.language; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_step_variants.language IS 'ISO 639-1 code this variant is written in. NULL = language-neutral. Variants compete for A/B round-robin only within the same language.';


--
-- Name: sequence_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequence_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence_id uuid NOT NULL,
    step_order integer NOT NULL,
    type text DEFAULT 'email'::text,
    delay_days integer DEFAULT 0,
    delay_hours integer DEFAULT 0,
    template_id uuid,
    subject_override text,
    body_override text,
    condition_type text,
    condition_branch_yes integer,
    condition_branch_no integer,
    created_at timestamp with time zone DEFAULT now(),
    include_signature boolean DEFAULT true NOT NULL,
    cta_lock text,
    task_title text,
    task_description text,
    task_priority text DEFAULT 'medium'::text,
    task_due_days integer DEFAULT 0,
    CONSTRAINT sequence_steps_condition_type_check CHECK ((condition_type = ANY (ARRAY['opened'::text, 'clicked'::text, 'replied'::text]))),
    CONSTRAINT sequence_steps_task_priority_check CHECK (((task_priority IS NULL) OR (task_priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])))),
    CONSTRAINT sequence_steps_type_check CHECK ((type = ANY (ARRAY['email'::text, 'delay'::text, 'condition'::text, 'call'::text, 'task'::text])))
);


--
-- Name: COLUMN sequence_steps.include_signature; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_steps.include_signature IS 'When false, the sender signature is not appended to this step''s outgoing email. Defaults to true.';


--
-- Name: COLUMN sequence_steps.task_title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_steps.task_title IS 'Title for the task created by a call/task step. Falls back to a generated title when null.';


--
-- Name: COLUMN sequence_steps.task_description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_steps.task_description IS 'Optional notes copied into the created task''s description.';


--
-- Name: COLUMN sequence_steps.task_due_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sequence_steps.task_due_days IS 'Days after the step fires that the created task is due. 0 = due immediately.';


--
-- Name: sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'draft'::text,
    settings jsonb DEFAULT '{"timezone": "Europe/Stockholm", "send_days": ["mon", "tue", "wed", "thu", "fri"], "send_end_hour": 17, "stop_on_reply": true, "send_start_hour": 9, "sender_rotation": true, "daily_limit_per_sender": 80, "stop_on_meeting_booked": true}'::jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sequences_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'archived'::text])))
);


--
-- Name: snippets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snippets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subreddit_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subreddit_access (
    subreddit text NOT NULL,
    access text DEFAULT 'unknown'::text NOT NULL,
    title text,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subreddit_access_access_check CHECK ((access = ANY (ARRAY['open'::text, 'members_only'::text, 'unknown'::text])))
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    company_id uuid NOT NULL,
    stripe_customer_id text,
    stripe_subscription_id text,
    plan text,
    status text,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    trial_start timestamp with time zone,
    trial_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    canceled_at timestamp with time zone,
    mrr_cents integer,
    currency text DEFAULT 'EUR'::text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: switchboard_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.switchboard_calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    elks_call_id text NOT NULL,
    call_session_id uuid,
    caller_number text,
    dialed_number text,
    contact_id uuid,
    company_id uuid,
    status text DEFAULT 'ringing'::text NOT NULL,
    outcome text,
    requested_label text,
    target_id uuid,
    target_user_id uuid,
    target_phone text,
    provider_conversation_id text,
    transcript jsonb,
    summary text,
    message_body text,
    caller_name text,
    answered_at timestamp with time zone,
    forwarded_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_seconds integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    unanswered text[],
    collected_at timestamp with time zone,
    CONSTRAINT switchboard_calls_outcome_check CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['handled_by_agent'::text, 'forwarded'::text, 'no_answer'::text, 'voicemail'::text, 'message_taken'::text, 'callback_booked'::text, 'abandoned'::text, 'rejected'::text])))),
    CONSTRAINT switchboard_calls_status_check CHECK ((status = ANY (ARRAY['ringing'::text, 'with_agent'::text, 'forwarding'::text, 'connected'::text, 'voicemail'::text, 'ended'::text, 'failed'::text])))
);


--
-- Name: COLUMN switchboard_calls.unanswered; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.switchboard_calls.unanswered IS 'Questions the receptionist could not answer on this call. Aggregated on the Phone System page as the knowledge backlog.';


--
-- Name: switchboard_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.switchboard_settings (
    workspace_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    number text,
    provider text DEFAULT 'elevenlabs'::text NOT NULL,
    provider_api_key_encrypted text,
    provider_agent_id text,
    provider_phone_number_id text,
    provider_kb_doc_id text,
    provider_tool_ids jsonb DEFAULT '{}'::jsonb NOT NULL,
    webhook_secret text,
    persona_name text DEFAULT 'Mark'::text NOT NULL,
    voice_id text,
    greeting_note text,
    languages_enabled text[] DEFAULT '{sv,en}'::text[] NOT NULL,
    answer_questions boolean DEFAULT true NOT NULL,
    take_messages boolean DEFAULT true NOT NULL,
    book_callbacks boolean DEFAULT true NOT NULL,
    open_hour integer DEFAULT 9 NOT NULL,
    close_hour integer DEFAULT 17 NOT NULL,
    open_days integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
    ring_seconds integer DEFAULT 25 NOT NULL,
    voicemail_enabled boolean DEFAULT true NOT NULL,
    max_call_seconds integer DEFAULT 600 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    bridge_number text,
    knowledge_md text
);


--
-- Name: COLUMN switchboard_settings.bridge_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.switchboard_settings.bridge_number IS '46elks websocket number the AI leg is connected to. NULL = use the ElevenLabs SIP endpoint instead (which currently has no audio).';


--
-- Name: COLUMN switchboard_settings.knowledge_md; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.switchboard_settings.knowledge_md IS 'Phone-specific product knowledge for the receptionist, injected whole on every turn. NULL = fall back to the shared workspace_ai_knowledge (written for email).';


--
-- Name: switchboard_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.switchboard_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid,
    label text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    phone text,
    failover_target_id uuid,
    enabled boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    contact_id uuid,
    company_id uuid,
    deal_id uuid,
    enrollment_id uuid,
    type text DEFAULT 'generic'::text NOT NULL,
    title text NOT NULL,
    description text,
    due_date timestamp with time zone,
    completed_at timestamp with time zone,
    snoozed_until timestamp with time zone,
    priority text DEFAULT 'medium'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sequence_step_id uuid,
    CONSTRAINT tasks_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT tasks_type_check CHECK ((type = ANY (ARRAY['email'::text, 'call'::text, 'linkedin'::text, 'generic'::text])))
);


--
-- Name: template_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    version integer NOT NULL,
    name text NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: unsubscribes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unsubscribes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    email text NOT NULL,
    reason text,
    source text DEFAULT 'link_click'::text,
    unsubscribed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT unsubscribes_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'link_click'::text, 'reply'::text, 'import'::text])))
);


--
-- Name: usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    company_id uuid,
    contact_id uuid,
    event_type text NOT NULL,
    event_at timestamp with time zone NOT NULL,
    source text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    external_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    user_id uuid NOT NULL,
    full_name text,
    title text,
    signature_html text,
    signature_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    origin_address text,
    origin_latitude double precision,
    origin_longitude double precision,
    origin_geocoded_at timestamp with time zone,
    working_days jsonb DEFAULT '{"fri": true, "mon": true, "sat": false, "sun": false, "thu": true, "tue": true, "wed": true}'::jsonb NOT NULL,
    call_agent_phone text,
    call_caller_id text,
    call_enabled boolean DEFAULT true NOT NULL,
    call_failover_user_id uuid,
    call_ring_seconds integer DEFAULT 25 NOT NULL,
    call_voicemail_enabled boolean DEFAULT true NOT NULL,
    avatar_url text,
    call_webrtc_number text,
    call_webrtc_secret_encrypted text,
    call_fallback_number text
);


--
-- Name: TABLE user_profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_profiles IS 'Per-user profile data (name, title, signature). One row per auth user; signature applies across all of their connected gmail_accounts.';


--
-- Name: COLUMN user_profiles.signature_html; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_profiles.signature_html IS 'Rendered HTML appended to outgoing sequence emails. Auto-suppressed on thread replies and when sequence_steps.include_signature = false.';


--
-- Name: COLUMN user_profiles.call_agent_phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_profiles.call_agent_phone IS 'E.164 phone 46elks rings first for this user before bridging to the contact. Per-user; replaces the old shared workspaces.settings.calls.agent_phone.';


--
-- Name: COLUMN user_profiles.call_caller_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_profiles.call_caller_id IS 'E.164 caller ID shown to the contact when this user places a call. Must be rented/verified on the 46elks account or it is rejected. Blank falls back to CRM_CALL_FROM_NUMBER.';


--
-- Name: COLUMN user_profiles.call_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_profiles.call_enabled IS 'Per-user master switch for in-CRM click-to-call. When false, this user''s Call buttons are disabled.';


--
-- Name: COLUMN user_profiles.call_failover_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_profiles.call_failover_user_id IS 'If this agent does not answer an inbound call to their dedicated number within call_ring_seconds, ring this user next. NULL = no failover.';


--
-- Name: COLUMN user_profiles.call_ring_seconds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_profiles.call_ring_seconds IS 'Seconds to ring this agent before failover / voicemail (~5s per ring). Default 25.';


--
-- Name: COLUMN user_profiles.call_voicemail_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_profiles.call_voicemail_enabled IS 'When true, an unanswered inbound call (after failover) records a voicemail that is transcribed + logged.';


--
-- Name: COLUMN user_profiles.call_webrtc_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_profiles.call_webrtc_number IS 'Per-user 46elks WebRTC number for browser calling. NULL = fall back to the shared ELKS_WEBRTC_* endpoint if this user is its configured owner.';


--
-- Name: COLUMN user_profiles.call_fallback_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_profiles.call_fallback_number IS 'E.164 number rung last on inbound callbacks (after owner + failover agent, before voicemail). Typically the switchboard AI receptionist.';


--
-- Name: user_unavailable_dates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_unavailable_dates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    date date NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: workspace_ai_knowledge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_ai_knowledge (
    workspace_id uuid NOT NULL,
    content_md text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: TABLE workspace_ai_knowledge; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.workspace_ai_knowledge IS 'Per-workspace markdown the AI is grounded in when drafting inbox replies + cold emails. Falls back to the seed in src/lib/inbox/wrenchlane-knowledge.ts when empty.';


--
-- Name: COLUMN workspace_ai_knowledge.content_md; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workspace_ai_knowledge.content_md IS 'Full prompt-shape markdown — product description, pricing, objections, video library, etc.';


--
-- Name: workspace_ai_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_ai_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    icp_prompt text,
    filter_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    daily_email_gen_count integer DEFAULT 0 NOT NULL,
    daily_email_gen_date date
);


--
-- Name: workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspace_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))
);


--
-- Name: workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    domain text,
    google_workspace_domain text,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    sending_settings jsonb DEFAULT '{}'::jsonb,
    domain_aliases text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: COLUMN workspaces.domain_aliases; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.workspaces.domain_aliases IS 'Extra email domains that auto-onboard into this workspace at Google OAuth sign-up';


--
-- Name: dashboard_cta_clicks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_cta_clicks ALTER COLUMN id SET DEFAULT nextval('public.dashboard_cta_clicks_id_seq'::regclass);


--
-- Name: dashboard_review_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_review_snapshots ALTER COLUMN id SET DEFAULT nextval('public.dashboard_review_snapshots_id_seq'::regclass);


--
-- Name: dashboard_reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_reviews ALTER COLUMN id SET DEFAULT nextval('public.dashboard_reviews_id_seq'::regclass);


--
-- Name: _ops_queue_pause_2026_04_28 _ops_queue_pause_2026_04_28_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._ops_queue_pause_2026_04_28
    ADD CONSTRAINT _ops_queue_pause_2026_04_28_pkey PRIMARY KEY (queue_id);


--
-- Name: activation_plan_groups activation_plan_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plan_groups
    ADD CONSTRAINT activation_plan_groups_pkey PRIMARY KEY (id);


--
-- Name: activation_plan_items activation_plan_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plan_items
    ADD CONSTRAINT activation_plan_items_pkey PRIMARY KEY (id);


--
-- Name: activation_plan_scenarios activation_plan_scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plan_scenarios
    ADD CONSTRAINT activation_plan_scenarios_pkey PRIMARY KEY (id);


--
-- Name: activation_plans activation_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plans
    ADD CONSTRAINT activation_plans_pkey PRIMARY KEY (id);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: ai_failure_stories ai_failure_stories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_failure_stories
    ADD CONSTRAINT ai_failure_stories_pkey PRIMARY KEY (id);


--
-- Name: articles articles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_pkey PRIMARY KEY (id);


--
-- Name: call_agent_jobs call_agent_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_agent_jobs
    ADD CONSTRAINT call_agent_jobs_pkey PRIMARY KEY (id);


--
-- Name: call_agent_settings call_agent_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_agent_settings
    ADD CONSTRAINT call_agent_settings_pkey PRIMARY KEY (workspace_id);


--
-- Name: call_exclusions call_exclusions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_exclusions
    ADD CONSTRAINT call_exclusions_pkey PRIMARY KEY (id);


--
-- Name: call_exclusions call_exclusions_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_exclusions
    ADD CONSTRAINT call_exclusions_uniq UNIQUE (workspace_id, kind, value);


--
-- Name: call_feedback call_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_feedback
    ADD CONSTRAINT call_feedback_pkey PRIMARY KEY (id);


--
-- Name: call_sessions call_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_merge_candidates company_merge_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_merge_candidates
    ADD CONSTRAINT company_merge_candidates_pkey PRIMARY KEY (id);


--
-- Name: contact_list_members contact_list_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_list_members
    ADD CONSTRAINT contact_list_members_pkey PRIMARY KEY (list_id, contact_id);


--
-- Name: contact_lists contact_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_lists
    ADD CONSTRAINT contact_lists_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: daily_routes daily_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_routes
    ADD CONSTRAINT daily_routes_pkey PRIMARY KEY (id);


--
-- Name: dashboard_cost_entries dashboard_cost_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_cost_entries
    ADD CONSTRAINT dashboard_cost_entries_pkey PRIMARY KEY (cost_entry_id);


--
-- Name: dashboard_cta_clicks dashboard_cta_clicks_date_host_name_page_path_button_text_c_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_cta_clicks
    ADD CONSTRAINT dashboard_cta_clicks_date_host_name_page_path_button_text_c_key UNIQUE (date, host_name, page_path, button_text, cta_location);


--
-- Name: dashboard_cta_clicks dashboard_cta_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_cta_clicks
    ADD CONSTRAINT dashboard_cta_clicks_pkey PRIMARY KEY (id);


--
-- Name: dashboard_diagnostic_chats dashboard_diagnostic_chats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_diagnostic_chats
    ADD CONSTRAINT dashboard_diagnostic_chats_pkey PRIMARY KEY (chat_id);


--
-- Name: dashboard_diagnostics dashboard_diagnostics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_diagnostics
    ADD CONSTRAINT dashboard_diagnostics_pkey PRIMARY KEY (diagnostic_id);


--
-- Name: dashboard_domain_health_checks dashboard_domain_health_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_domain_health_checks
    ADD CONSTRAINT dashboard_domain_health_checks_pkey PRIMARY KEY (id);


--
-- Name: dashboard_domain_portfolio dashboard_domain_portfolio_country_code_tld_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_domain_portfolio
    ADD CONSTRAINT dashboard_domain_portfolio_country_code_tld_key UNIQUE (country_code, tld);


--
-- Name: dashboard_domain_portfolio dashboard_domain_portfolio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_domain_portfolio
    ADD CONSTRAINT dashboard_domain_portfolio_pkey PRIMARY KEY (id);


--
-- Name: dashboard_feature_usage dashboard_feature_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_feature_usage
    ADD CONSTRAINT dashboard_feature_usage_pkey PRIMARY KEY (internal_user_id, feature_key, granularity, period_start);


--
-- Name: dashboard_funnel_snapshots dashboard_funnel_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_funnel_snapshots
    ADD CONSTRAINT dashboard_funnel_snapshots_pkey PRIMARY KEY (id);


--
-- Name: dashboard_funnel_snapshots dashboard_funnel_snapshots_source_key_step_key_period_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_funnel_snapshots
    ADD CONSTRAINT dashboard_funnel_snapshots_source_key_step_key_period_start_key UNIQUE (source_key, step_key, period_start, period_end, dimension_key);


--
-- Name: dashboard_internal_test_patterns dashboard_internal_test_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_internal_test_patterns
    ADD CONSTRAINT dashboard_internal_test_patterns_pkey PRIMARY KEY (id);


--
-- Name: dashboard_metric_snapshots dashboard_metric_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_metric_snapshots
    ADD CONSTRAINT dashboard_metric_snapshots_pkey PRIMARY KEY (id);


--
-- Name: dashboard_metric_snapshots dashboard_metric_snapshots_source_key_metric_key_period_sta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_metric_snapshots
    ADD CONSTRAINT dashboard_metric_snapshots_source_key_metric_key_period_sta_key UNIQUE (source_key, metric_key, period_start, period_end, dimension_key);


--
-- Name: dashboard_motor_usage dashboard_motor_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_motor_usage
    ADD CONSTRAINT dashboard_motor_usage_pkey PRIMARY KEY (motor_usage_id);


--
-- Name: dashboard_promo_grants dashboard_promo_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_promo_grants
    ADD CONSTRAINT dashboard_promo_grants_pkey PRIMARY KEY (grant_id);


--
-- Name: dashboard_raw_metric_rows dashboard_raw_metric_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_raw_metric_rows
    ADD CONSTRAINT dashboard_raw_metric_rows_pkey PRIMARY KEY (id);


--
-- Name: dashboard_raw_metric_rows dashboard_raw_metric_rows_source_key_external_id_period_sta_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_raw_metric_rows
    ADD CONSTRAINT dashboard_raw_metric_rows_source_key_external_id_period_sta_key UNIQUE (source_key, external_id, period_start);


--
-- Name: dashboard_review_snapshots dashboard_review_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_review_snapshots
    ADD CONSTRAINT dashboard_review_snapshots_pkey PRIMARY KEY (id);


--
-- Name: dashboard_review_snapshots dashboard_review_snapshots_platform_slug_captured_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_review_snapshots
    ADD CONSTRAINT dashboard_review_snapshots_platform_slug_captured_at_key UNIQUE (platform_slug, captured_at);


--
-- Name: dashboard_reviews dashboard_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_reviews
    ADD CONSTRAINT dashboard_reviews_pkey PRIMARY KEY (id);


--
-- Name: dashboard_reviews dashboard_reviews_platform_slug_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_reviews
    ADD CONSTRAINT dashboard_reviews_platform_slug_external_id_key UNIQUE (platform_slug, external_id);


--
-- Name: dashboard_source_accounts dashboard_source_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_source_accounts
    ADD CONSTRAINT dashboard_source_accounts_pkey PRIMARY KEY (source_key);


--
-- Name: dashboard_subscriptions dashboard_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_subscriptions
    ADD CONSTRAINT dashboard_subscriptions_pkey PRIMARY KEY (stripe_subscription_id);


--
-- Name: dashboard_sync_runs dashboard_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_sync_runs
    ADD CONSTRAINT dashboard_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: dashboard_user_attribution dashboard_user_attribution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_user_attribution
    ADD CONSTRAINT dashboard_user_attribution_pkey PRIMARY KEY (internal_user_id);


--
-- Name: dashboard_user_logins dashboard_user_logins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_user_logins
    ADD CONSTRAINT dashboard_user_logins_pkey PRIMARY KEY (internal_user_id, logged_in_at);


--
-- Name: dashboard_users dashboard_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_users
    ADD CONSTRAINT dashboard_users_pkey PRIMARY KEY (internal_user_id);


--
-- Name: dashboard_workshops dashboard_workshops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_workshops
    ADD CONSTRAINT dashboard_workshops_pkey PRIMARY KEY (workshop_id);


--
-- Name: deal_contacts deal_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_contacts
    ADD CONSTRAINT deal_contacts_pkey PRIMARY KEY (deal_id, contact_id);


--
-- Name: deals deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pkey PRIMARY KEY (id);


--
-- Name: diagnostic_videos diagnostic_videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnostic_videos
    ADD CONSTRAINT diagnostic_videos_pkey PRIMARY KEY (id);


--
-- Name: diagnostic_videos diagnostic_videos_workspace_id_youtube_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnostic_videos
    ADD CONSTRAINT diagnostic_videos_workspace_id_youtube_id_key UNIQUE (workspace_id, youtube_id);


--
-- Name: discovered_shops discovered_shops_google_place_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_shops
    ADD CONSTRAINT discovered_shops_google_place_id_key UNIQUE (google_place_id);


--
-- Name: discovered_shops discovered_shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovered_shops
    ADD CONSTRAINT discovered_shops_pkey PRIMARY KEY (id);


--
-- Name: dtc_comparisons dtc_comparisons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_comparisons
    ADD CONSTRAINT dtc_comparisons_pkey PRIMARY KEY (id);


--
-- Name: dtc_manual_codes dtc_manual_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_manual_codes
    ADD CONSTRAINT dtc_manual_codes_pkey PRIMARY KEY (id);


--
-- Name: dtc_manual_figures dtc_manual_figures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_manual_figures
    ADD CONSTRAINT dtc_manual_figures_pkey PRIMARY KEY (id);


--
-- Name: dtc_manual_vehicles dtc_manual_vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_manual_vehicles
    ADD CONSTRAINT dtc_manual_vehicles_pkey PRIMARY KEY (id);


--
-- Name: dtc_manual_vehicles dtc_manual_vehicles_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_manual_vehicles
    ADD CONSTRAINT dtc_manual_vehicles_slug_key UNIQUE (slug);


--
-- Name: dtc_search_history dtc_search_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_search_history
    ADD CONSTRAINT dtc_search_history_pkey PRIMARY KEY (id);


--
-- Name: dtc_wrenchlane_results dtc_wrenchlane_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_wrenchlane_results
    ADD CONSTRAINT dtc_wrenchlane_results_pkey PRIMARY KEY (id);


--
-- Name: email_events email_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_pkey PRIMARY KEY (id);


--
-- Name: email_queue email_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_pkey PRIMARY KEY (id);


--
-- Name: email_queue email_queue_tracking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_tracking_id_key UNIQUE (tracking_id);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: forum_candidates forum_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_candidates
    ADD CONSTRAINT forum_candidates_pkey PRIMARY KEY (id);


--
-- Name: forum_comment_assignments forum_comment_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_comment_assignments
    ADD CONSTRAINT forum_comment_assignments_pkey PRIMARY KEY (id);


--
-- Name: forum_distribution forum_distribution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_distribution
    ADD CONSTRAINT forum_distribution_pkey PRIMARY KEY (id);


--
-- Name: forum_gap_candidates forum_gap_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_gap_candidates
    ADD CONSTRAINT forum_gap_candidates_pkey PRIMARY KEY (id);


--
-- Name: forum_posts forum_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_posts
    ADD CONSTRAINT forum_posts_pkey PRIMARY KEY (id);


--
-- Name: forum_replies forum_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_replies
    ADD CONSTRAINT forum_replies_pkey PRIMARY KEY (id);


--
-- Name: forum_thread_replies forum_thread_replies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_thread_replies
    ADD CONSTRAINT forum_thread_replies_pkey PRIMARY KEY (id);


--
-- Name: gmail_accounts gmail_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_accounts
    ADD CONSTRAINT gmail_accounts_pkey PRIMARY KEY (id);


--
-- Name: gmail_sync_state gmail_sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_sync_state
    ADD CONSTRAINT gmail_sync_state_pkey PRIMARY KEY (gmail_account_id);


--
-- Name: inbox_messages inbox_messages_gmail_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_gmail_message_id_key UNIQUE (gmail_message_id);


--
-- Name: inbox_messages inbox_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_pkey PRIMARY KEY (id);


--
-- Name: journey_boards journey_boards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_boards
    ADD CONSTRAINT journey_boards_pkey PRIMARY KEY (id);


--
-- Name: journey_items journey_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_items
    ADD CONSTRAINT journey_items_pkey PRIMARY KEY (id);


--
-- Name: phone_enrichment_jobs phone_enrichment_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_enrichment_jobs
    ADD CONSTRAINT phone_enrichment_jobs_pkey PRIMARY KEY (id);


--
-- Name: phone_numbers phone_numbers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_numbers
    ADD CONSTRAINT phone_numbers_pkey PRIMARY KEY (id);


--
-- Name: pipelines pipelines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_pkey PRIMARY KEY (id);


--
-- Name: prospector_saved_searches prospector_saved_searches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospector_saved_searches
    ADD CONSTRAINT prospector_saved_searches_pkey PRIMARY KEY (id);


--
-- Name: prospector_search_cache prospector_search_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospector_search_cache
    ADD CONSTRAINT prospector_search_cache_pkey PRIMARY KEY (id);


--
-- Name: reddit_accounts reddit_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reddit_accounts
    ADD CONSTRAINT reddit_accounts_pkey PRIMARY KEY (id);


--
-- Name: reddit_mentions reddit_mentions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reddit_mentions
    ADD CONSTRAINT reddit_mentions_pkey PRIMARY KEY (id);


--
-- Name: roadmap_groups roadmap_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roadmap_groups
    ADD CONSTRAINT roadmap_groups_pkey PRIMARY KEY (id);


--
-- Name: roadmap_items roadmap_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roadmap_items
    ADD CONSTRAINT roadmap_items_pkey PRIMARY KEY (id);


--
-- Name: roadmaps roadmaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roadmaps
    ADD CONSTRAINT roadmaps_pkey PRIMARY KEY (id);


--
-- Name: route_stops route_stops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_pkey PRIMARY KEY (id);


--
-- Name: route_stops route_stops_route_id_stop_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_route_id_stop_order_key UNIQUE (route_id, stop_order);


--
-- Name: security_findings security_findings_finding_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_findings
    ADD CONSTRAINT security_findings_finding_key_key UNIQUE (finding_key);


--
-- Name: security_findings security_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_findings
    ADD CONSTRAINT security_findings_pkey PRIMARY KEY (id);


--
-- Name: security_scans security_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_scans
    ADD CONSTRAINT security_scans_pkey PRIMARY KEY (id);


--
-- Name: sequence_auto_enrollments sequence_auto_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_auto_enrollments
    ADD CONSTRAINT sequence_auto_enrollments_pkey PRIMARY KEY (id);


--
-- Name: sequence_auto_enrollments sequence_auto_enrollments_sequence_id_list_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_auto_enrollments
    ADD CONSTRAINT sequence_auto_enrollments_sequence_id_list_id_key UNIQUE (sequence_id, list_id);


--
-- Name: sequence_enrollments sequence_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_pkey PRIMARY KEY (id);


--
-- Name: sequence_enrollments sequence_enrollments_sequence_id_contact_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_sequence_id_contact_id_key UNIQUE (sequence_id, contact_id);


--
-- Name: sequence_step_variants sequence_step_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_step_variants
    ADD CONSTRAINT sequence_step_variants_pkey PRIMARY KEY (id);


--
-- Name: sequence_steps sequence_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_steps
    ADD CONSTRAINT sequence_steps_pkey PRIMARY KEY (id);


--
-- Name: sequence_steps sequence_steps_sequence_id_step_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_steps
    ADD CONSTRAINT sequence_steps_sequence_id_step_order_key UNIQUE (sequence_id, step_order);


--
-- Name: sequences sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequences
    ADD CONSTRAINT sequences_pkey PRIMARY KEY (id);


--
-- Name: snippets snippets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snippets
    ADD CONSTRAINT snippets_pkey PRIMARY KEY (id);


--
-- Name: subreddit_access subreddit_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subreddit_access
    ADD CONSTRAINT subreddit_access_pkey PRIMARY KEY (subreddit);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_stripe_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);


--
-- Name: suppressions suppressions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressions
    ADD CONSTRAINT suppressions_pkey PRIMARY KEY (id);


--
-- Name: switchboard_calls switchboard_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_calls
    ADD CONSTRAINT switchboard_calls_pkey PRIMARY KEY (id);


--
-- Name: switchboard_settings switchboard_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_settings
    ADD CONSTRAINT switchboard_settings_pkey PRIMARY KEY (workspace_id);


--
-- Name: switchboard_targets switchboard_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_targets
    ADD CONSTRAINT switchboard_targets_pkey PRIMARY KEY (id);


--
-- Name: switchboard_targets switchboard_targets_workspace_id_label_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_targets
    ADD CONSTRAINT switchboard_targets_workspace_id_label_key UNIQUE (workspace_id, label);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: template_versions template_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_versions
    ADD CONSTRAINT template_versions_pkey PRIMARY KEY (id);


--
-- Name: unsubscribes unsubscribes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unsubscribes
    ADD CONSTRAINT unsubscribes_pkey PRIMARY KEY (id);


--
-- Name: unsubscribes unsubscribes_workspace_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unsubscribes
    ADD CONSTRAINT unsubscribes_workspace_id_email_key UNIQUE (workspace_id, email);


--
-- Name: usage_events usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: user_unavailable_dates user_unavailable_dates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_unavailable_dates
    ADD CONSTRAINT user_unavailable_dates_pkey PRIMARY KEY (id);


--
-- Name: user_unavailable_dates user_unavailable_dates_user_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_unavailable_dates
    ADD CONSTRAINT user_unavailable_dates_user_id_date_key UNIQUE (user_id, date);


--
-- Name: workspace_ai_knowledge workspace_ai_knowledge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_ai_knowledge
    ADD CONSTRAINT workspace_ai_knowledge_pkey PRIMARY KEY (workspace_id);


--
-- Name: workspace_ai_settings workspace_ai_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_ai_settings
    ADD CONSTRAINT workspace_ai_settings_pkey PRIMARY KEY (id);


--
-- Name: workspace_ai_settings workspace_ai_settings_workspace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_ai_settings
    ADD CONSTRAINT workspace_ai_settings_workspace_id_key UNIQUE (workspace_id);


--
-- Name: workspace_members workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);


--
-- Name: workspace_members workspace_members_workspace_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id);


--
-- Name: workspaces workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);


--
-- Name: activities_mailbox_sync_gmail_msg_contact_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX activities_mailbox_sync_gmail_msg_contact_uniq ON public.activities USING btree (((metadata ->> 'gmail_message_id'::text)), COALESCE((contact_id)::text, ''::text)) WHERE ((metadata ->> 'synced_from'::text) = 'mailbox_sync'::text);


--
-- Name: activities_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX activities_outcome_idx ON public.activities USING btree (outcome) WHERE (outcome IS NOT NULL);


--
-- Name: call_exclusions_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_exclusions_workspace_idx ON public.call_exclusions USING btree (workspace_id);


--
-- Name: call_feedback_activity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_feedback_activity_idx ON public.call_feedback USING btree (activity_id);


--
-- Name: call_feedback_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_feedback_company_idx ON public.call_feedback USING btree (company_id);


--
-- Name: call_feedback_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_feedback_contact_idx ON public.call_feedback USING btree (contact_id);


--
-- Name: call_feedback_workspace_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_feedback_workspace_status_idx ON public.call_feedback USING btree (workspace_id, status);


--
-- Name: call_sessions_activity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_sessions_activity_idx ON public.call_sessions USING btree (activity_id);


--
-- Name: call_sessions_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_sessions_company_idx ON public.call_sessions USING btree (company_id);


--
-- Name: call_sessions_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_sessions_contact_idx ON public.call_sessions USING btree (contact_id);


--
-- Name: call_sessions_provider_call_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX call_sessions_provider_call_id_idx ON public.call_sessions USING btree (provider_call_id) WHERE (provider_call_id IS NOT NULL);


--
-- Name: call_sessions_workspace_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_sessions_workspace_status_idx ON public.call_sessions USING btree (workspace_id, status);


--
-- Name: companies_cfar_workspace_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX companies_cfar_workspace_unique ON public.companies USING btree (workspace_id, cfar_number) WHERE (cfar_number IS NOT NULL);


--
-- Name: companies_county_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_county_idx ON public.companies USING btree (workspace_id, county) WHERE (county IS NOT NULL);


--
-- Name: companies_customer_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_customer_status_idx ON public.companies USING btree (customer_status) WHERE (customer_status IS NOT NULL);


--
-- Name: companies_do_not_route_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_do_not_route_idx ON public.companies USING btree (workspace_id, do_not_route) WHERE (do_not_route = true);


--
-- Name: companies_domain_workspace_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX companies_domain_workspace_unique ON public.companies USING btree (workspace_id, domain) WHERE (domain IS NOT NULL);


--
-- Name: companies_is_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_is_partner_idx ON public.companies USING btree (workspace_id) WHERE is_partner;


--
-- Name: companies_last_visited_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_last_visited_at_idx ON public.companies USING btree (workspace_id, last_visited_at DESC NULLS LAST);


--
-- Name: companies_latlng_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_latlng_idx ON public.companies USING btree (latitude, longitude) WHERE (latitude IS NOT NULL);


--
-- Name: companies_lifecycle_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_lifecycle_stage_idx ON public.companies USING btree (lifecycle_stage) WHERE (lifecycle_stage IS NOT NULL);


--
-- Name: companies_org_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_org_number_idx ON public.companies USING btree (workspace_id, org_number) WHERE (org_number IS NOT NULL);


--
-- Name: companies_skip_auto_followup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_skip_auto_followup_idx ON public.companies USING btree (workspace_id, skip_auto_followup) WHERE (skip_auto_followup = true);


--
-- Name: companies_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_source_idx ON public.companies USING btree (source) WHERE (source IS NOT NULL);


--
-- Name: companies_stripe_subscription_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX companies_stripe_subscription_id_idx ON public.companies USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);


--
-- Name: companies_wl_workshop_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX companies_wl_workshop_id_idx ON public.companies USING btree (wl_workshop_id);


--
-- Name: contact_lists_purpose_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_lists_purpose_idx ON public.contact_lists USING btree (workspace_id, purpose);


--
-- Name: contacts_app_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_app_role_idx ON public.contacts USING btree (app_role) WHERE (app_role IS NOT NULL);


--
-- Name: contacts_last_active_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_last_active_at_idx ON public.contacts USING btree (last_active_at DESC NULLS LAST);


--
-- Name: contacts_payment_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_payment_status_idx ON public.contacts USING btree (workspace_id, payment_status) WHERE (payment_status IS NOT NULL);


--
-- Name: contacts_signed_up_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_signed_up_at_idx ON public.contacts USING btree (workspace_id, signed_up_at) WHERE (signed_up_at IS NOT NULL);


--
-- Name: contacts_wl_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX contacts_wl_user_id_idx ON public.contacts USING btree (wl_user_id);


--
-- Name: contacts_workspace_last_emailed_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_workspace_last_emailed_at_idx ON public.contacts USING btree (workspace_id, last_emailed_at) WHERE (last_emailed_at IS NOT NULL);


--
-- Name: contacts_workspace_never_emailed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contacts_workspace_never_emailed_idx ON public.contacts USING btree (workspace_id) WHERE (last_emailed_at IS NULL);


--
-- Name: daily_routes_assigned_to_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_routes_assigned_to_idx ON public.daily_routes USING btree (workspace_id, assigned_to, status, generated_at DESC);


--
-- Name: daily_routes_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_routes_batch_idx ON public.daily_routes USING btree (workspace_id, generation_batch_id);


--
-- Name: daily_routes_scheduled_for_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_routes_scheduled_for_idx ON public.daily_routes USING btree (workspace_id, scheduled_for) WHERE (scheduled_for IS NOT NULL);


--
-- Name: daily_routes_workspace_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_routes_workspace_status_idx ON public.daily_routes USING btree (workspace_id, status, generated_at DESC);


--
-- Name: dashboard_cost_entries_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_cost_entries_snapshot_idx ON public.dashboard_cost_entries USING btree (snapshot_at DESC, section);


--
-- Name: dashboard_diagnostic_chats_diagnostic_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_diagnostic_chats_diagnostic_idx ON public.dashboard_diagnostic_chats USING btree (diagnostic_id);


--
-- Name: dashboard_diagnostic_chats_workshop_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_diagnostic_chats_workshop_created_idx ON public.dashboard_diagnostic_chats USING btree (workshop_id, created_at DESC);


--
-- Name: dashboard_diagnostics_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_diagnostics_user_created_idx ON public.dashboard_diagnostics USING btree (internal_user_id, created_at DESC);


--
-- Name: dashboard_diagnostics_workshop_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_diagnostics_workshop_created_idx ON public.dashboard_diagnostics USING btree (workshop_id, created_at DESC);


--
-- Name: dashboard_domain_health_checks_domain_checked_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_domain_health_checks_domain_checked_at_idx ON public.dashboard_domain_health_checks USING btree (domain, checked_at DESC);


--
-- Name: dashboard_domain_portfolio_region_country_rank_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_domain_portfolio_region_country_rank_idx ON public.dashboard_domain_portfolio USING btree (region, country_code, rank);


--
-- Name: dashboard_domain_portfolio_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_domain_portfolio_status_idx ON public.dashboard_domain_portfolio USING btree (status);


--
-- Name: dashboard_funnel_snapshots_step_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_funnel_snapshots_step_period_idx ON public.dashboard_funnel_snapshots USING btree (step_key, period_start DESC);


--
-- Name: dashboard_internal_test_patterns_kind_value_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX dashboard_internal_test_patterns_kind_value_idx ON public.dashboard_internal_test_patterns USING btree (kind, lower(value));


--
-- Name: dashboard_metric_snapshots_metric_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_metric_snapshots_metric_period_idx ON public.dashboard_metric_snapshots USING btree (metric_key, period_start DESC);


--
-- Name: dashboard_metric_snapshots_source_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_metric_snapshots_source_period_idx ON public.dashboard_metric_snapshots USING btree (source_key, period_start DESC);


--
-- Name: dashboard_motor_usage_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_motor_usage_month_idx ON public.dashboard_motor_usage USING btree (month DESC);


--
-- Name: dashboard_sync_runs_source_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_sync_runs_source_started_idx ON public.dashboard_sync_runs USING btree (source_key, started_at DESC);


--
-- Name: dashboard_users_core_stripe_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_users_core_stripe_customer_idx ON public.dashboard_users USING btree (core_stripe_customer_id) WHERE (core_stripe_customer_id IS NOT NULL);


--
-- Name: dashboard_users_is_internal_test_exempt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_users_is_internal_test_exempt_idx ON public.dashboard_users USING btree (is_internal_test_exempt) WHERE (is_internal_test_exempt = true);


--
-- Name: dashboard_users_is_internal_test_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_users_is_internal_test_idx ON public.dashboard_users USING btree (is_internal_test) WHERE (is_internal_test = true);


--
-- Name: dashboard_users_signed_up_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_users_signed_up_at_idx ON public.dashboard_users USING btree (signed_up_at);


--
-- Name: dashboard_workshops_core_stripe_customer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_workshops_core_stripe_customer_idx ON public.dashboard_workshops USING btree (core_stripe_customer_id) WHERE (core_stripe_customer_id IS NOT NULL);


--
-- Name: dashboard_workshops_core_stripe_subscription_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_workshops_core_stripe_subscription_idx ON public.dashboard_workshops USING btree (core_stripe_subscription_id) WHERE (core_stripe_subscription_id IS NOT NULL);


--
-- Name: dashboard_workshops_is_internal_test_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dashboard_workshops_is_internal_test_idx ON public.dashboard_workshops USING btree (is_internal_test) WHERE (is_internal_test = true);


--
-- Name: discovered_shops_all_categories_gin_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discovered_shops_all_categories_gin_idx ON public.discovered_shops USING gin (all_categories);


--
-- Name: discovered_shops_do_not_route_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discovered_shops_do_not_route_idx ON public.discovered_shops USING btree (do_not_route) WHERE (do_not_route = true);


--
-- Name: discovered_shops_email_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discovered_shops_email_status_idx ON public.discovered_shops USING btree (email_status);


--
-- Name: discovered_shops_permanently_closed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discovered_shops_permanently_closed_idx ON public.discovered_shops USING btree (permanently_closed) WHERE (permanently_closed = true);


--
-- Name: discovered_shops_shop_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discovered_shops_shop_type_idx ON public.discovered_shops USING btree (shop_type) WHERE (shop_type IS NOT NULL);


--
-- Name: email_queue_gmail_message_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_queue_gmail_message_id_idx ON public.email_queue USING btree (gmail_message_id) WHERE (gmail_message_id IS NOT NULL);


--
-- Name: gmail_sync_state_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX gmail_sync_state_workspace_id_idx ON public.gmail_sync_state USING btree (workspace_id);


--
-- Name: idx_activation_plan_groups_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activation_plan_groups_plan ON public.activation_plan_groups USING btree (plan_id, sort_order);


--
-- Name: idx_activation_plan_groups_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activation_plan_groups_workspace ON public.activation_plan_groups USING btree (workspace_id);


--
-- Name: idx_activation_plan_items_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activation_plan_items_group ON public.activation_plan_items USING btree (group_id, sort_order);


--
-- Name: idx_activation_plan_items_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activation_plan_items_plan ON public.activation_plan_items USING btree (plan_id);


--
-- Name: idx_activation_plan_items_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activation_plan_items_workspace ON public.activation_plan_items USING btree (workspace_id);


--
-- Name: idx_activation_plan_scenarios_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activation_plan_scenarios_plan ON public.activation_plan_scenarios USING btree (plan_id, sort_order);


--
-- Name: idx_activation_plan_scenarios_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activation_plan_scenarios_workspace ON public.activation_plan_scenarios USING btree (workspace_id);


--
-- Name: idx_activation_plans_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activation_plans_workspace ON public.activation_plans USING btree (workspace_id, sort_order);


--
-- Name: idx_activities_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_company ON public.activities USING btree (company_id, created_at DESC) WHERE (company_id IS NOT NULL);


--
-- Name: idx_activities_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_contact ON public.activities USING btree (contact_id, created_at DESC);


--
-- Name: idx_activities_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_deal ON public.activities USING btree (deal_id, created_at DESC) WHERE (deal_id IS NOT NULL);


--
-- Name: idx_activities_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_workspace ON public.activities USING btree (workspace_id, created_at DESC);


--
-- Name: idx_ai_failure_stories_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_failure_stories_workspace ON public.ai_failure_stories USING btree (workspace_id, created_at DESC);


--
-- Name: idx_articles_format; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_articles_format ON public.articles USING btree (workspace_id, format, created_at DESC);


--
-- Name: idx_articles_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_articles_status ON public.articles USING btree (workspace_id, status, created_at DESC);


--
-- Name: idx_articles_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_articles_workspace ON public.articles USING btree (workspace_id, created_at DESC);


--
-- Name: idx_call_agent_jobs_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_agent_jobs_claim ON public.call_agent_jobs USING btree (status, scheduled_for) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));


--
-- Name: idx_call_agent_jobs_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_agent_jobs_contact ON public.call_agent_jobs USING btree (contact_id, created_at DESC);


--
-- Name: idx_call_agent_jobs_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_agent_jobs_workspace ON public.call_agent_jobs USING btree (workspace_id, created_at DESC);


--
-- Name: idx_call_sessions_provider_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_sessions_provider_conversation ON public.call_sessions USING btree (provider_conversation_id) WHERE (provider_conversation_id IS NOT NULL);


--
-- Name: idx_companies_country_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_country_code ON public.companies USING btree (country_code);


--
-- Name: idx_companies_country_org_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_country_org_number ON public.companies USING btree (country_code, org_number) WHERE (org_number IS NOT NULL);


--
-- Name: idx_companies_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_domain ON public.companies USING btree (workspace_id, domain) WHERE (domain IS NOT NULL);


--
-- Name: idx_companies_google_place; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_google_place ON public.companies USING btree (google_place_id);


--
-- Name: idx_companies_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_name_trgm ON public.companies USING gin (lower(public.immutable_unaccent(name)) public.gin_trgm_ops);


--
-- Name: idx_companies_parent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_parent_id ON public.companies USING btree (parent_company_id);


--
-- Name: idx_companies_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_tags ON public.companies USING gin (tags);


--
-- Name: idx_companies_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_workspace ON public.companies USING btree (workspace_id);


--
-- Name: idx_company_merge_candidates_pending_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_company_merge_candidates_pending_pair ON public.company_merge_candidates USING btree (workspace_id, LEAST(primary_company_id, candidate_company_id), GREATEST(primary_company_id, candidate_company_id)) WHERE (status = 'pending'::text);


--
-- Name: idx_company_merge_candidates_workspace_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_company_merge_candidates_workspace_status ON public.company_merge_candidates USING btree (workspace_id, status, created_at DESC);


--
-- Name: idx_contact_list_members_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contact_list_members_contact ON public.contact_list_members USING btree (contact_id);


--
-- Name: idx_contacts_attributed_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_attributed_sequence ON public.contacts USING btree (attributed_to_sequence_id, attributed_at DESC) WHERE (attributed_to_sequence_id IS NOT NULL);


--
-- Name: idx_contacts_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_company ON public.contacts USING btree (company_id) WHERE (company_id IS NOT NULL);


--
-- Name: idx_contacts_country_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_country_code ON public.contacts USING btree (country_code);


--
-- Name: idx_contacts_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_language ON public.contacts USING btree (language);


--
-- Name: idx_contacts_last_contacted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_last_contacted ON public.contacts USING btree (workspace_id, last_contacted_at DESC NULLS LAST);


--
-- Name: idx_contacts_lead_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_lead_status ON public.contacts USING btree (workspace_id, lead_status);


--
-- Name: idx_contacts_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_tags ON public.contacts USING gin (tags);


--
-- Name: idx_contacts_workspace_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_workspace_email ON public.contacts USING btree (workspace_id, email);


--
-- Name: idx_contacts_workspace_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_workspace_status ON public.contacts USING btree (workspace_id, status);


--
-- Name: idx_dashboard_cta_clicks_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_cta_clicks_date ON public.dashboard_cta_clicks USING btree (date DESC);


--
-- Name: idx_dashboard_cta_clicks_host_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_cta_clicks_host_date ON public.dashboard_cta_clicks USING btree (host_name, date DESC);


--
-- Name: idx_dashboard_cta_clicks_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_cta_clicks_location ON public.dashboard_cta_clicks USING btree (cta_location);


--
-- Name: idx_dashboard_feature_usage_feature_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_feature_usage_feature_period ON public.dashboard_feature_usage USING btree (feature_key, granularity, period_start DESC);


--
-- Name: idx_dashboard_promo_grants_applied; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_promo_grants_applied ON public.dashboard_promo_grants USING btree (last_applied_at DESC);


--
-- Name: idx_dashboard_promo_grants_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_promo_grants_code ON public.dashboard_promo_grants USING btree (promotion_code);


--
-- Name: idx_dashboard_promo_grants_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_promo_grants_customer ON public.dashboard_promo_grants USING btree (stripe_customer_id);


--
-- Name: idx_dashboard_promo_grants_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_promo_grants_email ON public.dashboard_promo_grants USING btree (customer_email);


--
-- Name: idx_dashboard_review_snapshots_platform_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_review_snapshots_platform_date ON public.dashboard_review_snapshots USING btree (platform_slug, captured_at DESC);


--
-- Name: idx_dashboard_reviews_platform_reviewed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_reviews_platform_reviewed ON public.dashboard_reviews USING btree (platform_slug, reviewed_at DESC);


--
-- Name: idx_dashboard_user_attribution_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_user_attribution_channel ON public.dashboard_user_attribution USING btree (channel);


--
-- Name: idx_dashboard_user_logins_logged_in_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dashboard_user_logins_logged_in_at ON public.dashboard_user_logins USING btree (logged_in_at DESC);


--
-- Name: idx_deals_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_company ON public.deals USING btree (company_id) WHERE (company_id IS NOT NULL);


--
-- Name: idx_deals_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_owner ON public.deals USING btree (owner_id) WHERE (owner_id IS NOT NULL);


--
-- Name: idx_deals_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_pipeline ON public.deals USING btree (pipeline_id);


--
-- Name: idx_deals_workspace_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deals_workspace_stage ON public.deals USING btree (workspace_id, stage);


--
-- Name: idx_diagnostic_videos_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diagnostic_videos_workspace ON public.diagnostic_videos USING btree (workspace_id, sort_order);


--
-- Name: idx_discovered_shops_city; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovered_shops_city ON public.discovered_shops USING btree (city);


--
-- Name: idx_discovered_shops_country_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovered_shops_country_code ON public.discovered_shops USING btree (country_code);


--
-- Name: idx_discovered_shops_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovered_shops_domain ON public.discovered_shops USING btree (domain);


--
-- Name: idx_discovered_shops_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovered_shops_source ON public.discovered_shops USING btree (source);


--
-- Name: idx_discovered_shops_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_discovered_shops_status ON public.discovered_shops USING btree (status);


--
-- Name: idx_dtc_cmp_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dtc_cmp_code ON public.dtc_comparisons USING btree (vehicle_id, code);


--
-- Name: idx_dtc_hist_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dtc_hist_code ON public.dtc_search_history USING btree (code);


--
-- Name: idx_dtc_hist_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dtc_hist_user ON public.dtc_search_history USING btree (user_id, created_at DESC);


--
-- Name: idx_dtc_manual_codes_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dtc_manual_codes_code ON public.dtc_manual_codes USING btree (vehicle_id, code);


--
-- Name: idx_dtc_manual_codes_code_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dtc_manual_codes_code_lower ON public.dtc_manual_codes USING btree (lower(code));


--
-- Name: idx_dtc_manual_codes_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dtc_manual_codes_fts ON public.dtc_manual_codes USING gin (to_tsvector('english'::regconfig, ((((COALESCE(code, ''::text) || ' '::text) || COALESCE(summary, ''::text)) || ' '::text) || COALESCE(body, ''::text))));


--
-- Name: idx_dtc_manual_figures_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dtc_manual_figures_code ON public.dtc_manual_figures USING btree (code_id);


--
-- Name: idx_dtc_wl_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_dtc_wl_code ON public.dtc_wrenchlane_results USING btree (vehicle_id, code);


--
-- Name: idx_email_events_queue_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_queue_type ON public.email_events USING btree (email_queue_id, event_type);


--
-- Name: idx_email_events_tracking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_tracking ON public.email_events USING btree (tracking_id);


--
-- Name: idx_email_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_events_type ON public.email_events USING btree (event_type, created_at DESC);


--
-- Name: idx_email_queue_enrollment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_queue_enrollment ON public.email_queue USING btree (enrollment_id);


--
-- Name: idx_email_queue_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_queue_scheduled ON public.email_queue USING btree (status, scheduled_for) WHERE (status = 'scheduled'::text);


--
-- Name: idx_email_queue_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_queue_sender ON public.email_queue USING btree (sender_account_id, status, scheduled_for) WHERE (status = 'scheduled'::text);


--
-- Name: idx_email_queue_tracking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_queue_tracking ON public.email_queue USING btree (tracking_id);


--
-- Name: idx_email_queue_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_queue_variant ON public.email_queue USING btree (variant_id) WHERE (variant_id IS NOT NULL);


--
-- Name: idx_enrollments_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_contact ON public.sequence_enrollments USING btree (contact_id, status);


--
-- Name: idx_enrollments_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_sequence ON public.sequence_enrollments USING btree (sequence_id, status);


--
-- Name: idx_forum_candidates_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forum_candidates_queue ON public.forum_candidates USING btree (workspace_id, status, posted_at DESC);


--
-- Name: idx_forum_comment_assignments_slack_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forum_comment_assignments_slack_ts ON public.forum_comment_assignments USING btree (slack_message_ts) WHERE (slack_message_ts IS NOT NULL);


--
-- Name: idx_forum_comment_assignments_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forum_comment_assignments_source ON public.forum_comment_assignments USING btree (workspace_id, source, source_id);


--
-- Name: idx_forum_distribution_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forum_distribution_workspace ON public.forum_distribution USING btree (workspace_id, topic, sort_order);


--
-- Name: idx_forum_gap_candidates_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forum_gap_candidates_workspace ON public.forum_gap_candidates USING btree (workspace_id, status, first_seen_at DESC);


--
-- Name: idx_forum_posts_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forum_posts_workspace ON public.forum_posts USING btree (workspace_id, created_at DESC);


--
-- Name: idx_forum_replies_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forum_replies_workspace ON public.forum_replies USING btree (workspace_id, created_at DESC);


--
-- Name: idx_forum_thread_replies_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forum_thread_replies_source ON public.forum_thread_replies USING btree (workspace_id, source, source_id);


--
-- Name: idx_gmail_accounts_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gmail_accounts_workspace ON public.gmail_accounts USING btree (workspace_id, status);


--
-- Name: idx_journey_boards_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journey_boards_workspace ON public.journey_boards USING btree (workspace_id, sort_order);


--
-- Name: idx_journey_items_board; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journey_items_board ON public.journey_items USING btree (board_id);


--
-- Name: idx_journey_items_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journey_items_workspace ON public.journey_items USING btree (workspace_id);


--
-- Name: idx_prospector_saved_searches_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospector_saved_searches_workspace ON public.prospector_saved_searches USING btree (workspace_id);


--
-- Name: idx_prospector_search_cache_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospector_search_cache_expires ON public.prospector_search_cache USING btree (expires_at);


--
-- Name: idx_prospector_search_cache_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_prospector_search_cache_hash ON public.prospector_search_cache USING btree (workspace_id, search_hash);


--
-- Name: idx_reddit_accounts_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reddit_accounts_workspace ON public.reddit_accounts USING btree (workspace_id, owner_label);


--
-- Name: idx_reddit_mentions_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reddit_mentions_workspace ON public.reddit_mentions USING btree (workspace_id, audience, first_seen_at DESC);


--
-- Name: idx_roadmap_groups_roadmap; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roadmap_groups_roadmap ON public.roadmap_groups USING btree (roadmap_id, sort_order);


--
-- Name: idx_roadmap_groups_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roadmap_groups_workspace ON public.roadmap_groups USING btree (workspace_id);


--
-- Name: idx_roadmap_items_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roadmap_items_group ON public.roadmap_items USING btree (group_id, sort_order);


--
-- Name: idx_roadmap_items_roadmap; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roadmap_items_roadmap ON public.roadmap_items USING btree (roadmap_id);


--
-- Name: idx_roadmap_items_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roadmap_items_workspace ON public.roadmap_items USING btree (workspace_id);


--
-- Name: idx_roadmaps_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roadmaps_workspace ON public.roadmaps USING btree (workspace_id, sort_order);


--
-- Name: idx_sequence_step_variants_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_step_variants_active ON public.sequence_step_variants USING btree (sequence_step_id) WHERE ((is_active = true) AND (weight > 0));


--
-- Name: idx_sequence_step_variants_step; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_step_variants_step ON public.sequence_step_variants USING btree (sequence_step_id);


--
-- Name: idx_sequence_step_variants_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_step_variants_workspace ON public.sequence_step_variants USING btree (workspace_id);


--
-- Name: idx_sequence_steps_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequence_steps_sequence ON public.sequence_steps USING btree (sequence_id, step_order);


--
-- Name: idx_sequences_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sequences_workspace ON public.sequences USING btree (workspace_id, status);


--
-- Name: idx_snippets_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_snippets_workspace ON public.snippets USING btree (workspace_id);


--
-- Name: idx_switchboard_calls_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_switchboard_calls_contact ON public.switchboard_calls USING btree (contact_id, created_at DESC);


--
-- Name: idx_switchboard_calls_elks_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_switchboard_calls_elks_id ON public.switchboard_calls USING btree (elks_call_id);


--
-- Name: idx_switchboard_calls_live; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_switchboard_calls_live ON public.switchboard_calls USING btree (workspace_id, created_at DESC) WHERE (status = ANY (ARRAY['ringing'::text, 'with_agent'::text]));


--
-- Name: idx_switchboard_calls_uncollected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_switchboard_calls_uncollected ON public.switchboard_calls USING btree (created_at) WHERE ((collected_at IS NULL) AND (provider_conversation_id IS NOT NULL));


--
-- Name: idx_switchboard_calls_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_switchboard_calls_workspace ON public.switchboard_calls USING btree (workspace_id, created_at DESC);


--
-- Name: idx_switchboard_targets_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_switchboard_targets_workspace ON public.switchboard_targets USING btree (workspace_id, sort_order);


--
-- Name: idx_template_versions_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_template_versions_template ON public.template_versions USING btree (template_id, version DESC);


--
-- Name: idx_unsubscribes_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unsubscribes_email ON public.unsubscribes USING btree (workspace_id, email);


--
-- Name: inbox_messages_answered_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_answered_idx ON public.inbox_messages USING btree (workspace_id, replied_at DESC) WHERE (replied_at IS NOT NULL);


--
-- Name: inbox_messages_contact_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_contact_id_idx ON public.inbox_messages USING btree (contact_id);


--
-- Name: inbox_messages_draft_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_draft_idx ON public.inbox_messages USING btree (workspace_id, reply_draft_updated_at DESC) WHERE (reply_draft IS NOT NULL);


--
-- Name: inbox_messages_gmail_thread_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_gmail_thread_id_idx ON public.inbox_messages USING btree (gmail_thread_id);


--
-- Name: inbox_messages_needs_reply_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_needs_reply_idx ON public.inbox_messages USING btree (workspace_id, received_at DESC) WHERE (replied_at IS NULL);


--
-- Name: inbox_messages_needs_translation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_needs_translation_idx ON public.inbox_messages USING btree (received_at DESC) WHERE (detected_language IS NULL);


--
-- Name: inbox_messages_received_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_received_at_idx ON public.inbox_messages USING btree (received_at DESC);


--
-- Name: inbox_messages_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_workspace_id_idx ON public.inbox_messages USING btree (workspace_id);


--
-- Name: phone_enrichment_jobs_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX phone_enrichment_jobs_claim_idx ON public.phone_enrichment_jobs USING btree (status, enqueued_at);


--
-- Name: phone_enrichment_jobs_open_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX phone_enrichment_jobs_open_uniq ON public.phone_enrichment_jobs USING btree (workspace_id, contact_id) WHERE (status = ANY (ARRAY['queued'::text, 'processing'::text]));


--
-- Name: phone_enrichment_jobs_ws_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX phone_enrichment_jobs_ws_idx ON public.phone_enrichment_jobs USING btree (workspace_id, status);


--
-- Name: phone_numbers_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX phone_numbers_company_idx ON public.phone_numbers USING btree (company_id);


--
-- Name: phone_numbers_company_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX phone_numbers_company_number_idx ON public.phone_numbers USING btree (company_id, number) WHERE (company_id IS NOT NULL);


--
-- Name: phone_numbers_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX phone_numbers_contact_idx ON public.phone_numbers USING btree (contact_id);


--
-- Name: phone_numbers_contact_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX phone_numbers_contact_number_idx ON public.phone_numbers USING btree (contact_id, number) WHERE ((company_id IS NULL) AND (contact_id IS NOT NULL));


--
-- Name: phone_numbers_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX phone_numbers_workspace_idx ON public.phone_numbers USING btree (workspace_id);


--
-- Name: route_stops_route_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX route_stops_route_idx ON public.route_stops USING btree (route_id, stop_order);


--
-- Name: route_stops_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX route_stops_workspace_idx ON public.route_stops USING btree (workspace_id);


--
-- Name: security_findings_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_findings_category_idx ON public.security_findings USING btree (category);


--
-- Name: security_findings_severity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_findings_severity_idx ON public.security_findings USING btree (severity);


--
-- Name: security_findings_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_findings_status_idx ON public.security_findings USING btree (status);


--
-- Name: security_scans_ran_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX security_scans_ran_at_idx ON public.security_scans USING btree (ran_at DESC);


--
-- Name: sequence_enrollments_sequence_language_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sequence_enrollments_sequence_language_idx ON public.sequence_enrollments USING btree (sequence_id, language) WHERE (language IS NOT NULL);


--
-- Name: sequence_step_variants_step_language_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sequence_step_variants_step_language_idx ON public.sequence_step_variants USING btree (sequence_step_id, language);


--
-- Name: subscriptions_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_company_idx ON public.subscriptions USING btree (company_id);


--
-- Name: subscriptions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_status_idx ON public.subscriptions USING btree (status);


--
-- Name: subscriptions_workspace_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_workspace_idx ON public.subscriptions USING btree (workspace_id);


--
-- Name: suppressions_domain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX suppressions_domain_idx ON public.suppressions USING btree (domain) WHERE (active = true);


--
-- Name: suppressions_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX suppressions_email_idx ON public.suppressions USING btree (email) WHERE (active = true);


--
-- Name: suppressions_workspace_domain_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX suppressions_workspace_domain_active_idx ON public.suppressions USING btree (workspace_id, domain) WHERE ((active = true) AND (domain IS NOT NULL));


--
-- Name: suppressions_workspace_email_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX suppressions_workspace_email_active_idx ON public.suppressions USING btree (workspace_id, email) WHERE ((active = true) AND (email IS NOT NULL));


--
-- Name: suppressions_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX suppressions_workspace_id_idx ON public.suppressions USING btree (workspace_id);


--
-- Name: tasks_enrollment_step_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tasks_enrollment_step_uniq ON public.tasks USING btree (enrollment_id, sequence_step_id);


--
-- Name: tasks_workspace_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_workspace_contact ON public.tasks USING btree (workspace_id, contact_id);


--
-- Name: tasks_workspace_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tasks_workspace_due ON public.tasks USING btree (workspace_id, due_date);


--
-- Name: uq_ai_failure_stories_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ai_failure_stories_source ON public.ai_failure_stories USING btree (workspace_id, source_url) WHERE (source_url IS NOT NULL);


--
-- Name: uq_forum_candidates_reddit; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_forum_candidates_reddit ON public.forum_candidates USING btree (workspace_id, reddit_id);


--
-- Name: uq_forum_comment_assignment_member; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_forum_comment_assignment_member ON public.forum_comment_assignments USING btree (workspace_id, source, source_id, owner_label);


--
-- Name: uq_forum_gap_candidates_source; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_forum_gap_candidates_source ON public.forum_gap_candidates USING btree (workspace_id, source_url);


--
-- Name: uq_forum_thread_reply_comment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_forum_thread_reply_comment ON public.forum_thread_replies USING btree (workspace_id, source, source_id, reddit_comment_id);


--
-- Name: uq_reddit_mentions_source_author; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_reddit_mentions_source_author ON public.reddit_mentions USING btree (workspace_id, source_url, author);


--
-- Name: usage_events_company_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_company_at_idx ON public.usage_events USING btree (company_id, event_at DESC) WHERE (company_id IS NOT NULL);


--
-- Name: usage_events_contact_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_contact_at_idx ON public.usage_events USING btree (contact_id, event_at DESC) WHERE (contact_id IS NOT NULL);


--
-- Name: usage_events_source_external_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX usage_events_source_external_id_idx ON public.usage_events USING btree (source, external_id) WHERE (external_id IS NOT NULL);


--
-- Name: usage_events_type_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_type_at_idx ON public.usage_events USING btree (event_type, event_at DESC);


--
-- Name: user_unavailable_dates_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_unavailable_dates_idx ON public.user_unavailable_dates USING btree (user_id, date);


--
-- Name: activities activities_recompute_owner; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER activities_recompute_owner AFTER INSERT ON public.activities FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_owner_from_activity();


--
-- Name: dashboard_domain_portfolio dashboard_domain_portfolio_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER dashboard_domain_portfolio_touch BEFORE UPDATE ON public.dashboard_domain_portfolio FOR EACH ROW EXECUTE FUNCTION public.dashboard_domain_portfolio_touch();


--
-- Name: companies set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: contact_lists set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contact_lists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: contacts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: deals set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: email_templates set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: gmail_accounts set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.gmail_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: security_findings set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.security_findings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: sequences set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sequences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: workspaces set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: company_merge_candidates trg_company_merge_candidates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_company_merge_candidates_updated_at BEFORE UPDATE ON public.company_merge_candidates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: workspace_ai_knowledge trg_workspace_ai_knowledge_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_workspace_ai_knowledge_updated_at BEFORE UPDATE ON public.workspace_ai_knowledge FOR EACH ROW EXECUTE FUNCTION public.workspace_ai_knowledge_set_updated_at();


--
-- Name: activation_plan_groups update_activation_plan_groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_activation_plan_groups_updated_at BEFORE UPDATE ON public.activation_plan_groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: activation_plan_items update_activation_plan_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_activation_plan_items_updated_at BEFORE UPDATE ON public.activation_plan_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: activation_plan_scenarios update_activation_plan_scenarios_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_activation_plan_scenarios_updated_at BEFORE UPDATE ON public.activation_plan_scenarios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: activation_plans update_activation_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_activation_plans_updated_at BEFORE UPDATE ON public.activation_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: ai_failure_stories update_ai_failure_stories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_ai_failure_stories_updated_at BEFORE UPDATE ON public.ai_failure_stories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: articles update_articles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_articles_updated_at BEFORE UPDATE ON public.articles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: call_agent_jobs update_call_agent_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_call_agent_jobs_updated_at BEFORE UPDATE ON public.call_agent_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: call_agent_settings update_call_agent_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_call_agent_settings_updated_at BEFORE UPDATE ON public.call_agent_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: call_sessions update_call_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_call_sessions_updated_at BEFORE UPDATE ON public.call_sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: daily_routes update_daily_routes_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_daily_routes_updated_at BEFORE UPDATE ON public.daily_routes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: diagnostic_videos update_diagnostic_videos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_diagnostic_videos_updated_at BEFORE UPDATE ON public.diagnostic_videos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: discovered_shops update_discovered_shops_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_discovered_shops_updated_at BEFORE UPDATE ON public.discovered_shops FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: forum_candidates update_forum_candidates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_forum_candidates_updated_at BEFORE UPDATE ON public.forum_candidates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: forum_comment_assignments update_forum_comment_assignments_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_forum_comment_assignments_updated_at BEFORE UPDATE ON public.forum_comment_assignments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: forum_distribution update_forum_distribution_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_forum_distribution_updated_at BEFORE UPDATE ON public.forum_distribution FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: forum_gap_candidates update_forum_gap_candidates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_forum_gap_candidates_updated_at BEFORE UPDATE ON public.forum_gap_candidates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: forum_posts update_forum_posts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_forum_posts_updated_at BEFORE UPDATE ON public.forum_posts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: forum_replies update_forum_replies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_forum_replies_updated_at BEFORE UPDATE ON public.forum_replies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: forum_thread_replies update_forum_thread_replies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_forum_thread_replies_updated_at BEFORE UPDATE ON public.forum_thread_replies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: gmail_sync_state update_gmail_sync_state_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_gmail_sync_state_updated_at BEFORE UPDATE ON public.gmail_sync_state FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: inbox_messages update_inbox_messages_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_inbox_messages_updated_at BEFORE UPDATE ON public.inbox_messages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: journey_boards update_journey_boards_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_journey_boards_updated_at BEFORE UPDATE ON public.journey_boards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: journey_items update_journey_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_journey_items_updated_at BEFORE UPDATE ON public.journey_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: phone_enrichment_jobs update_phone_enrichment_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_phone_enrichment_jobs_updated_at BEFORE UPDATE ON public.phone_enrichment_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: phone_numbers update_phone_numbers_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_phone_numbers_updated_at BEFORE UPDATE ON public.phone_numbers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: reddit_accounts update_reddit_accounts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_reddit_accounts_updated_at BEFORE UPDATE ON public.reddit_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: reddit_mentions update_reddit_mentions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_reddit_mentions_updated_at BEFORE UPDATE ON public.reddit_mentions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: roadmap_groups update_roadmap_groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_roadmap_groups_updated_at BEFORE UPDATE ON public.roadmap_groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: roadmap_items update_roadmap_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_roadmap_items_updated_at BEFORE UPDATE ON public.roadmap_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: roadmaps update_roadmaps_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_roadmaps_updated_at BEFORE UPDATE ON public.roadmaps FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: sequence_step_variants update_sequence_step_variants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_sequence_step_variants_updated_at BEFORE UPDATE ON public.sequence_step_variants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: snippets update_snippets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_snippets_updated_at BEFORE UPDATE ON public.snippets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: subscriptions update_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: suppressions update_suppressions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_suppressions_updated_at BEFORE UPDATE ON public.suppressions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: switchboard_calls update_switchboard_calls_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_switchboard_calls_updated_at BEFORE UPDATE ON public.switchboard_calls FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: switchboard_settings update_switchboard_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_switchboard_settings_updated_at BEFORE UPDATE ON public.switchboard_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: switchboard_targets update_switchboard_targets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_switchboard_targets_updated_at BEFORE UPDATE ON public.switchboard_targets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: tasks update_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: user_profiles update_user_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: workspace_ai_settings update_workspace_ai_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_workspace_ai_settings_updated_at BEFORE UPDATE ON public.workspace_ai_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: activation_plan_groups activation_plan_groups_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plan_groups
    ADD CONSTRAINT activation_plan_groups_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.activation_plans(id) ON DELETE CASCADE;


--
-- Name: activation_plan_groups activation_plan_groups_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plan_groups
    ADD CONSTRAINT activation_plan_groups_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: activation_plan_items activation_plan_items_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plan_items
    ADD CONSTRAINT activation_plan_items_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.activation_plan_groups(id) ON DELETE CASCADE;


--
-- Name: activation_plan_items activation_plan_items_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plan_items
    ADD CONSTRAINT activation_plan_items_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.activation_plans(id) ON DELETE CASCADE;


--
-- Name: activation_plan_items activation_plan_items_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plan_items
    ADD CONSTRAINT activation_plan_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: activation_plan_scenarios activation_plan_scenarios_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plan_scenarios
    ADD CONSTRAINT activation_plan_scenarios_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.activation_plans(id) ON DELETE CASCADE;


--
-- Name: activation_plan_scenarios activation_plan_scenarios_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plan_scenarios
    ADD CONSTRAINT activation_plan_scenarios_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: activation_plans activation_plans_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activation_plans
    ADD CONSTRAINT activation_plans_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: activities activities_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: activities activities_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: activities activities_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;


--
-- Name: activities activities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: activities activities_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: ai_failure_stories ai_failure_stories_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_failure_stories
    ADD CONSTRAINT ai_failure_stories_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: articles articles_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: articles articles_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.articles
    ADD CONSTRAINT articles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: call_agent_jobs call_agent_jobs_call_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_agent_jobs
    ADD CONSTRAINT call_agent_jobs_call_session_id_fkey FOREIGN KEY (call_session_id) REFERENCES public.call_sessions(id) ON DELETE SET NULL;


--
-- Name: call_agent_jobs call_agent_jobs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_agent_jobs
    ADD CONSTRAINT call_agent_jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: call_agent_jobs call_agent_jobs_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_agent_jobs
    ADD CONSTRAINT call_agent_jobs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: call_agent_jobs call_agent_jobs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_agent_jobs
    ADD CONSTRAINT call_agent_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: call_agent_settings call_agent_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_agent_settings
    ADD CONSTRAINT call_agent_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: call_exclusions call_exclusions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_exclusions
    ADD CONSTRAINT call_exclusions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: call_feedback call_feedback_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_feedback
    ADD CONSTRAINT call_feedback_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE SET NULL;


--
-- Name: call_feedback call_feedback_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_feedback
    ADD CONSTRAINT call_feedback_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: call_feedback call_feedback_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_feedback
    ADD CONSTRAINT call_feedback_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: call_feedback call_feedback_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_feedback
    ADD CONSTRAINT call_feedback_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: call_sessions call_sessions_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE SET NULL;


--
-- Name: call_sessions call_sessions_agent_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_agent_job_id_fkey FOREIGN KEY (agent_job_id) REFERENCES public.call_agent_jobs(id) ON DELETE SET NULL;


--
-- Name: call_sessions call_sessions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: call_sessions call_sessions_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: call_sessions call_sessions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: companies companies_parent_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_parent_company_id_fkey FOREIGN KEY (parent_company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: companies companies_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: company_merge_candidates company_merge_candidates_candidate_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_merge_candidates
    ADD CONSTRAINT company_merge_candidates_candidate_company_id_fkey FOREIGN KEY (candidate_company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_merge_candidates company_merge_candidates_primary_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_merge_candidates
    ADD CONSTRAINT company_merge_candidates_primary_company_id_fkey FOREIGN KEY (primary_company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: company_merge_candidates company_merge_candidates_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_merge_candidates
    ADD CONSTRAINT company_merge_candidates_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: company_merge_candidates company_merge_candidates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_merge_candidates
    ADD CONSTRAINT company_merge_candidates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: contact_list_members contact_list_members_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_list_members
    ADD CONSTRAINT contact_list_members_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_list_members contact_list_members_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_list_members
    ADD CONSTRAINT contact_list_members_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.contact_lists(id) ON DELETE CASCADE;


--
-- Name: contact_lists contact_lists_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_lists
    ADD CONSTRAINT contact_lists_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_attributed_to_send_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_attributed_to_send_id_fkey FOREIGN KEY (attributed_to_send_id) REFERENCES public.email_queue(id) ON DELETE SET NULL;


--
-- Name: contacts contacts_attributed_to_sequence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_attributed_to_sequence_id_fkey FOREIGN KEY (attributed_to_sequence_id) REFERENCES public.sequences(id) ON DELETE SET NULL;


--
-- Name: contacts contacts_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: contacts contacts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: daily_routes daily_routes_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_routes
    ADD CONSTRAINT daily_routes_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: daily_routes daily_routes_generated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_routes
    ADD CONSTRAINT daily_routes_generated_by_fkey FOREIGN KEY (generated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: daily_routes daily_routes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_routes
    ADD CONSTRAINT daily_routes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: dashboard_subscriptions dashboard_subscriptions_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_subscriptions
    ADD CONSTRAINT dashboard_subscriptions_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.dashboard_workshops(workshop_id);


--
-- Name: dashboard_workshops dashboard_workshops_owner_internal_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_workshops
    ADD CONSTRAINT dashboard_workshops_owner_internal_user_id_fkey FOREIGN KEY (owner_internal_user_id) REFERENCES public.dashboard_users(internal_user_id);


--
-- Name: deal_contacts deal_contacts_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_contacts
    ADD CONSTRAINT deal_contacts_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: deal_contacts deal_contacts_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deal_contacts
    ADD CONSTRAINT deal_contacts_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;


--
-- Name: deals deals_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: deals deals_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: deals deals_pipeline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES public.pipelines(id) ON DELETE CASCADE;


--
-- Name: deals deals_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals
    ADD CONSTRAINT deals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: diagnostic_videos diagnostic_videos_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diagnostic_videos
    ADD CONSTRAINT diagnostic_videos_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: dtc_comparisons dtc_comparisons_lemon_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_comparisons
    ADD CONSTRAINT dtc_comparisons_lemon_code_id_fkey FOREIGN KEY (lemon_code_id) REFERENCES public.dtc_manual_codes(id) ON DELETE SET NULL;


--
-- Name: dtc_comparisons dtc_comparisons_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_comparisons
    ADD CONSTRAINT dtc_comparisons_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.dtc_manual_vehicles(id) ON DELETE CASCADE;


--
-- Name: dtc_comparisons dtc_comparisons_wrenchlane_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_comparisons
    ADD CONSTRAINT dtc_comparisons_wrenchlane_result_id_fkey FOREIGN KEY (wrenchlane_result_id) REFERENCES public.dtc_wrenchlane_results(id) ON DELETE SET NULL;


--
-- Name: dtc_manual_codes dtc_manual_codes_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_manual_codes
    ADD CONSTRAINT dtc_manual_codes_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.dtc_manual_vehicles(id) ON DELETE CASCADE;


--
-- Name: dtc_manual_figures dtc_manual_figures_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_manual_figures
    ADD CONSTRAINT dtc_manual_figures_code_id_fkey FOREIGN KEY (code_id) REFERENCES public.dtc_manual_codes(id) ON DELETE CASCADE;


--
-- Name: dtc_search_history dtc_search_history_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_search_history
    ADD CONSTRAINT dtc_search_history_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.dtc_manual_vehicles(id) ON DELETE SET NULL;


--
-- Name: dtc_wrenchlane_results dtc_wrenchlane_results_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dtc_wrenchlane_results
    ADD CONSTRAINT dtc_wrenchlane_results_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.dtc_manual_vehicles(id) ON DELETE CASCADE;


--
-- Name: email_events email_events_email_queue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_email_queue_id_fkey FOREIGN KEY (email_queue_id) REFERENCES public.email_queue(id) ON DELETE CASCADE;


--
-- Name: email_queue email_queue_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: email_queue email_queue_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.sequence_enrollments(id) ON DELETE CASCADE;


--
-- Name: email_queue email_queue_sender_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_sender_account_id_fkey FOREIGN KEY (sender_account_id) REFERENCES public.gmail_accounts(id) ON DELETE SET NULL;


--
-- Name: email_queue email_queue_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.sequence_steps(id) ON DELETE SET NULL;


--
-- Name: email_queue email_queue_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.sequence_step_variants(id) ON DELETE SET NULL;


--
-- Name: email_queue email_queue_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_queue
    ADD CONSTRAINT email_queue_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: email_templates email_templates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: forum_candidates forum_candidates_reply_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_candidates
    ADD CONSTRAINT forum_candidates_reply_id_fkey FOREIGN KEY (reply_id) REFERENCES public.forum_replies(id) ON DELETE SET NULL;


--
-- Name: forum_candidates forum_candidates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_candidates
    ADD CONSTRAINT forum_candidates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: forum_comment_assignments forum_comment_assignments_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_comment_assignments
    ADD CONSTRAINT forum_comment_assignments_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.reddit_accounts(id) ON DELETE SET NULL;


--
-- Name: forum_comment_assignments forum_comment_assignments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_comment_assignments
    ADD CONSTRAINT forum_comment_assignments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: forum_distribution forum_distribution_posted_by_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_distribution
    ADD CONSTRAINT forum_distribution_posted_by_account_id_fkey FOREIGN KEY (posted_by_account_id) REFERENCES public.reddit_accounts(id) ON DELETE SET NULL;


--
-- Name: forum_distribution forum_distribution_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_distribution
    ADD CONSTRAINT forum_distribution_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: forum_gap_candidates forum_gap_candidates_story_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_gap_candidates
    ADD CONSTRAINT forum_gap_candidates_story_id_fkey FOREIGN KEY (story_id) REFERENCES public.ai_failure_stories(id) ON DELETE SET NULL;


--
-- Name: forum_gap_candidates forum_gap_candidates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_gap_candidates
    ADD CONSTRAINT forum_gap_candidates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: forum_posts forum_posts_assigned_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_posts
    ADD CONSTRAINT forum_posts_assigned_account_id_fkey FOREIGN KEY (assigned_account_id) REFERENCES public.reddit_accounts(id) ON DELETE SET NULL;


--
-- Name: forum_posts forum_posts_posted_by_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_posts
    ADD CONSTRAINT forum_posts_posted_by_account_id_fkey FOREIGN KEY (posted_by_account_id) REFERENCES public.reddit_accounts(id) ON DELETE SET NULL;


--
-- Name: forum_posts forum_posts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_posts
    ADD CONSTRAINT forum_posts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: forum_replies forum_replies_posted_by_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_replies
    ADD CONSTRAINT forum_replies_posted_by_account_id_fkey FOREIGN KEY (posted_by_account_id) REFERENCES public.reddit_accounts(id) ON DELETE SET NULL;


--
-- Name: forum_replies forum_replies_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_replies
    ADD CONSTRAINT forum_replies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: forum_thread_replies forum_thread_replies_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_thread_replies
    ADD CONSTRAINT forum_thread_replies_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.reddit_accounts(id) ON DELETE SET NULL;


--
-- Name: forum_thread_replies forum_thread_replies_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.forum_thread_replies
    ADD CONSTRAINT forum_thread_replies_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: gmail_accounts gmail_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_accounts
    ADD CONSTRAINT gmail_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: gmail_accounts gmail_accounts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_accounts
    ADD CONSTRAINT gmail_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: gmail_sync_state gmail_sync_state_gmail_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_sync_state
    ADD CONSTRAINT gmail_sync_state_gmail_account_id_fkey FOREIGN KEY (gmail_account_id) REFERENCES public.gmail_accounts(id) ON DELETE CASCADE;


--
-- Name: gmail_sync_state gmail_sync_state_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gmail_sync_state
    ADD CONSTRAINT gmail_sync_state_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: inbox_messages inbox_messages_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: inbox_messages inbox_messages_email_queue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_email_queue_id_fkey FOREIGN KEY (email_queue_id) REFERENCES public.email_queue(id) ON DELETE SET NULL;


--
-- Name: inbox_messages inbox_messages_gmail_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_gmail_account_id_fkey FOREIGN KEY (gmail_account_id) REFERENCES public.gmail_accounts(id) ON DELETE CASCADE;


--
-- Name: inbox_messages inbox_messages_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: journey_boards journey_boards_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_boards
    ADD CONSTRAINT journey_boards_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: journey_items journey_items_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_items
    ADD CONSTRAINT journey_items_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.journey_boards(id) ON DELETE CASCADE;


--
-- Name: journey_items journey_items_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journey_items
    ADD CONSTRAINT journey_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: phone_enrichment_jobs phone_enrichment_jobs_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_enrichment_jobs
    ADD CONSTRAINT phone_enrichment_jobs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: phone_enrichment_jobs phone_enrichment_jobs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_enrichment_jobs
    ADD CONSTRAINT phone_enrichment_jobs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: phone_numbers phone_numbers_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_numbers
    ADD CONSTRAINT phone_numbers_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: phone_numbers phone_numbers_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_numbers
    ADD CONSTRAINT phone_numbers_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: phone_numbers phone_numbers_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phone_numbers
    ADD CONSTRAINT phone_numbers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: pipelines pipelines_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipelines
    ADD CONSTRAINT pipelines_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: prospector_saved_searches prospector_saved_searches_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospector_saved_searches
    ADD CONSTRAINT prospector_saved_searches_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: prospector_search_cache prospector_search_cache_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospector_search_cache
    ADD CONSTRAINT prospector_search_cache_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: reddit_accounts reddit_accounts_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reddit_accounts
    ADD CONSTRAINT reddit_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: reddit_mentions reddit_mentions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reddit_mentions
    ADD CONSTRAINT reddit_mentions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.reddit_accounts(id) ON DELETE SET NULL;


--
-- Name: reddit_mentions reddit_mentions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reddit_mentions
    ADD CONSTRAINT reddit_mentions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: roadmap_groups roadmap_groups_roadmap_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roadmap_groups
    ADD CONSTRAINT roadmap_groups_roadmap_id_fkey FOREIGN KEY (roadmap_id) REFERENCES public.roadmaps(id) ON DELETE CASCADE;


--
-- Name: roadmap_groups roadmap_groups_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roadmap_groups
    ADD CONSTRAINT roadmap_groups_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: roadmap_items roadmap_items_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roadmap_items
    ADD CONSTRAINT roadmap_items_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.roadmap_groups(id) ON DELETE CASCADE;


--
-- Name: roadmap_items roadmap_items_roadmap_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roadmap_items
    ADD CONSTRAINT roadmap_items_roadmap_id_fkey FOREIGN KEY (roadmap_id) REFERENCES public.roadmaps(id) ON DELETE CASCADE;


--
-- Name: roadmap_items roadmap_items_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roadmap_items
    ADD CONSTRAINT roadmap_items_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: roadmaps roadmaps_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roadmaps
    ADD CONSTRAINT roadmaps_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: route_stops route_stops_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: route_stops route_stops_discovered_shop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_discovered_shop_id_fkey FOREIGN KEY (discovered_shop_id) REFERENCES public.discovered_shops(id) ON DELETE CASCADE;


--
-- Name: route_stops route_stops_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.daily_routes(id) ON DELETE CASCADE;


--
-- Name: route_stops route_stops_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: sequence_auto_enrollments sequence_auto_enrollments_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_auto_enrollments
    ADD CONSTRAINT sequence_auto_enrollments_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.contact_lists(id) ON DELETE CASCADE;


--
-- Name: sequence_auto_enrollments sequence_auto_enrollments_sender_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_auto_enrollments
    ADD CONSTRAINT sequence_auto_enrollments_sender_account_id_fkey FOREIGN KEY (sender_account_id) REFERENCES public.gmail_accounts(id) ON DELETE SET NULL;


--
-- Name: sequence_auto_enrollments sequence_auto_enrollments_sequence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_auto_enrollments
    ADD CONSTRAINT sequence_auto_enrollments_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.sequences(id) ON DELETE CASCADE;


--
-- Name: sequence_auto_enrollments sequence_auto_enrollments_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_auto_enrollments
    ADD CONSTRAINT sequence_auto_enrollments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: sequence_enrollments sequence_enrollments_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: sequence_enrollments sequence_enrollments_sender_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_sender_account_id_fkey FOREIGN KEY (sender_account_id) REFERENCES public.gmail_accounts(id) ON DELETE SET NULL;


--
-- Name: sequence_enrollments sequence_enrollments_sequence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_enrollments
    ADD CONSTRAINT sequence_enrollments_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.sequences(id) ON DELETE CASCADE;


--
-- Name: sequence_step_variants sequence_step_variants_ai_parent_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_step_variants
    ADD CONSTRAINT sequence_step_variants_ai_parent_variant_id_fkey FOREIGN KEY (ai_parent_variant_id) REFERENCES public.sequence_step_variants(id) ON DELETE SET NULL;


--
-- Name: sequence_step_variants sequence_step_variants_sequence_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_step_variants
    ADD CONSTRAINT sequence_step_variants_sequence_step_id_fkey FOREIGN KEY (sequence_step_id) REFERENCES public.sequence_steps(id) ON DELETE CASCADE;


--
-- Name: sequence_step_variants sequence_step_variants_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_step_variants
    ADD CONSTRAINT sequence_step_variants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: sequence_steps sequence_steps_sequence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_steps
    ADD CONSTRAINT sequence_steps_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.sequences(id) ON DELETE CASCADE;


--
-- Name: sequence_steps sequence_steps_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequence_steps
    ADD CONSTRAINT sequence_steps_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.email_templates(id) ON DELETE SET NULL;


--
-- Name: sequences sequences_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequences
    ADD CONSTRAINT sequences_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: sequences sequences_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sequences
    ADD CONSTRAINT sequences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: snippets snippets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snippets
    ADD CONSTRAINT snippets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: suppressions suppressions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressions
    ADD CONSTRAINT suppressions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: switchboard_calls switchboard_calls_call_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_calls
    ADD CONSTRAINT switchboard_calls_call_session_id_fkey FOREIGN KEY (call_session_id) REFERENCES public.call_sessions(id) ON DELETE SET NULL;


--
-- Name: switchboard_calls switchboard_calls_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_calls
    ADD CONSTRAINT switchboard_calls_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: switchboard_calls switchboard_calls_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_calls
    ADD CONSTRAINT switchboard_calls_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: switchboard_calls switchboard_calls_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_calls
    ADD CONSTRAINT switchboard_calls_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.switchboard_targets(id) ON DELETE SET NULL;


--
-- Name: switchboard_calls switchboard_calls_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_calls
    ADD CONSTRAINT switchboard_calls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: switchboard_settings switchboard_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_settings
    ADD CONSTRAINT switchboard_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: switchboard_targets switchboard_targets_failover_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_targets
    ADD CONSTRAINT switchboard_targets_failover_target_id_fkey FOREIGN KEY (failover_target_id) REFERENCES public.switchboard_targets(id) ON DELETE SET NULL;


--
-- Name: switchboard_targets switchboard_targets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.switchboard_targets
    ADD CONSTRAINT switchboard_targets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: tasks tasks_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_deal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_enrollment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES public.sequence_enrollments(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_sequence_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_sequence_step_id_fkey FOREIGN KEY (sequence_step_id) REFERENCES public.sequence_steps(id) ON DELETE SET NULL;


--
-- Name: tasks tasks_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: template_versions template_versions_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_versions
    ADD CONSTRAINT template_versions_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.email_templates(id) ON DELETE CASCADE;


--
-- Name: unsubscribes unsubscribes_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unsubscribes
    ADD CONSTRAINT unsubscribes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: usage_events usage_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: usage_events usage_events_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: usage_events usage_events_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_call_failover_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_call_failover_user_id_fkey FOREIGN KEY (call_failover_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: user_profiles user_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_unavailable_dates user_unavailable_dates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_unavailable_dates
    ADD CONSTRAINT user_unavailable_dates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_unavailable_dates user_unavailable_dates_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_unavailable_dates
    ADD CONSTRAINT user_unavailable_dates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_ai_knowledge workspace_ai_knowledge_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_ai_knowledge
    ADD CONSTRAINT workspace_ai_knowledge_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);


--
-- Name: workspace_ai_knowledge workspace_ai_knowledge_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_ai_knowledge
    ADD CONSTRAINT workspace_ai_knowledge_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_ai_settings workspace_ai_settings_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_ai_settings
    ADD CONSTRAINT workspace_ai_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: workspace_members workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;


--
-- Name: workspace_members Admins can delete members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete members" ON public.workspace_members FOR DELETE USING (public.is_workspace_admin(workspace_id));


--
-- Name: workspace_members Admins can update members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update members" ON public.workspace_members FOR UPDATE USING (public.is_workspace_admin(workspace_id));


--
-- Name: workspaces Authenticated users can create workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can create workspaces" ON public.workspaces FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: workspace_members Users can insert own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own membership" ON public.workspace_members FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: workspaces Users can update their workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their workspaces" ON public.workspaces FOR UPDATE USING ((id IN ( SELECT workspace_members.workspace_id
   FROM public.workspace_members
  WHERE ((workspace_members.user_id = auth.uid()) AND (workspace_members.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));


--
-- Name: workspace_members Users can view own memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own memberships" ON public.workspace_members FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: workspaces Users can view their workspaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their workspaces" ON public.workspaces FOR SELECT USING ((id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: workspace_members Users can view workspace co-members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view workspace co-members" ON public.workspace_members FOR SELECT USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: sequence_step_variants Users delete variants in their workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete variants in their workspace" ON public.sequence_step_variants FOR DELETE USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: company_merge_candidates Users delete workspace merge candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete workspace merge candidates" ON public.company_merge_candidates FOR DELETE USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: sequence_step_variants Users insert variants in their workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert variants in their workspace" ON public.sequence_step_variants FOR INSERT WITH CHECK ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: company_merge_candidates Users insert workspace merge candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert workspace merge candidates" ON public.company_merge_candidates FOR INSERT WITH CHECK ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: sequence_step_variants Users update variants in their workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update variants in their workspace" ON public.sequence_step_variants FOR UPDATE USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: company_merge_candidates Users update workspace merge candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update workspace merge candidates" ON public.company_merge_candidates FOR UPDATE USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: sequence_step_variants Users view variants in their workspace; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users view variants in their workspace" ON public.sequence_step_variants FOR SELECT USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: company_merge_candidates Users view workspace merge candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users view workspace merge candidates" ON public.company_merge_candidates FOR SELECT USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: activities Workspace access for activities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for activities" ON public.activities USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: companies Workspace access for companies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for companies" ON public.companies USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: contact_list_members Workspace access for contact_list_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for contact_list_members" ON public.contact_list_members USING ((list_id IN ( SELECT contact_lists.id
   FROM public.contact_lists
  WHERE (contact_lists.workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)))));


--
-- Name: contact_lists Workspace access for contact_lists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for contact_lists" ON public.contact_lists USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: contacts Workspace access for contacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for contacts" ON public.contacts USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: deal_contacts Workspace access for deal_contacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for deal_contacts" ON public.deal_contacts USING ((deal_id IN ( SELECT deals.id
   FROM public.deals
  WHERE (deals.workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)))));


--
-- Name: deals Workspace access for deals; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for deals" ON public.deals USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: email_events Workspace access for email_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for email_events" ON public.email_events USING ((email_queue_id IN ( SELECT email_queue.id
   FROM public.email_queue
  WHERE (email_queue.workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)))));


--
-- Name: email_queue Workspace access for email_queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for email_queue" ON public.email_queue USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: email_templates Workspace access for email_templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for email_templates" ON public.email_templates USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: gmail_accounts Workspace access for gmail_accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for gmail_accounts" ON public.gmail_accounts USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: pipelines Workspace access for pipelines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for pipelines" ON public.pipelines USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: sequence_enrollments Workspace access for sequence_enrollments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for sequence_enrollments" ON public.sequence_enrollments USING ((sequence_id IN ( SELECT sequences.id
   FROM public.sequences
  WHERE (sequences.workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)))));


--
-- Name: sequence_steps Workspace access for sequence_steps; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for sequence_steps" ON public.sequence_steps USING ((sequence_id IN ( SELECT sequences.id
   FROM public.sequences
  WHERE (sequences.workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)))));


--
-- Name: sequences Workspace access for sequences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for sequences" ON public.sequences USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: unsubscribes Workspace access for unsubscribes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Workspace access for unsubscribes" ON public.unsubscribes USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: activation_plan_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activation_plan_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: activation_plan_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activation_plan_items ENABLE ROW LEVEL SECURITY;

--
-- Name: activation_plan_scenarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activation_plan_scenarios ENABLE ROW LEVEL SECURITY;

--
-- Name: activation_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activation_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_failure_stories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_failure_stories ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_failure_stories any authenticated user can access ai_failure_stories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "any authenticated user can access ai_failure_stories" ON public.ai_failure_stories TO authenticated USING (true) WITH CHECK (true);


--
-- Name: articles any authenticated user can access articles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "any authenticated user can access articles" ON public.articles TO authenticated USING (true) WITH CHECK (true);


--
-- Name: forum_candidates any authenticated user can access forum_candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "any authenticated user can access forum_candidates" ON public.forum_candidates TO authenticated USING (true) WITH CHECK (true);


--
-- Name: forum_comment_assignments any authenticated user can access forum_comment_assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "any authenticated user can access forum_comment_assignments" ON public.forum_comment_assignments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: forum_distribution any authenticated user can access forum_distribution; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "any authenticated user can access forum_distribution" ON public.forum_distribution TO authenticated USING (true) WITH CHECK (true);


--
-- Name: forum_gap_candidates any authenticated user can access forum_gap_candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "any authenticated user can access forum_gap_candidates" ON public.forum_gap_candidates TO authenticated USING (true) WITH CHECK (true);


--
-- Name: forum_posts any authenticated user can access forum_posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "any authenticated user can access forum_posts" ON public.forum_posts TO authenticated USING (true) WITH CHECK (true);


--
-- Name: forum_replies any authenticated user can access forum_replies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "any authenticated user can access forum_replies" ON public.forum_replies TO authenticated USING (true) WITH CHECK (true);


--
-- Name: forum_thread_replies any authenticated user can access forum_thread_replies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "any authenticated user can access forum_thread_replies" ON public.forum_thread_replies TO authenticated USING (true) WITH CHECK (true);


--
-- Name: reddit_accounts any authenticated user can access reddit_accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "any authenticated user can access reddit_accounts" ON public.reddit_accounts TO authenticated USING (true) WITH CHECK (true);


--
-- Name: reddit_mentions any authenticated user can access reddit_mentions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "any authenticated user can access reddit_mentions" ON public.reddit_mentions TO authenticated USING (true) WITH CHECK (true);


--
-- Name: articles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_cost_entries authenticated can read cost entries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read cost entries" ON public.dashboard_cost_entries FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_diagnostic_chats authenticated can read diagnostic chats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read diagnostic chats" ON public.dashboard_diagnostic_chats FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_diagnostics authenticated can read diagnostics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read diagnostics" ON public.dashboard_diagnostics FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_feature_usage authenticated can read feature usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read feature usage" ON public.dashboard_feature_usage FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_funnel_snapshots authenticated can read funnel snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read funnel snapshots" ON public.dashboard_funnel_snapshots FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_internal_test_patterns authenticated can read internal test patterns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read internal test patterns" ON public.dashboard_internal_test_patterns FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_metric_snapshots authenticated can read metric snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read metric snapshots" ON public.dashboard_metric_snapshots FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_motor_usage authenticated can read motor usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read motor usage" ON public.dashboard_motor_usage FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_promo_grants authenticated can read promo grants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read promo grants" ON public.dashboard_promo_grants FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_raw_metric_rows authenticated can read raw metric rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read raw metric rows" ON public.dashboard_raw_metric_rows FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_review_snapshots authenticated can read review snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read review snapshots" ON public.dashboard_review_snapshots FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_reviews authenticated can read reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read reviews" ON public.dashboard_reviews FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_source_accounts authenticated can read source accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read source accounts" ON public.dashboard_source_accounts FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_subscriptions authenticated can read subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read subscriptions" ON public.dashboard_subscriptions FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_sync_runs authenticated can read sync runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read sync runs" ON public.dashboard_sync_runs FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_user_attribution authenticated can read user attribution; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read user attribution" ON public.dashboard_user_attribution FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_user_logins authenticated can read user logins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read user logins" ON public.dashboard_user_logins FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_users authenticated can read users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read users" ON public.dashboard_users FOR SELECT TO authenticated USING (true);


--
-- Name: dashboard_workshops authenticated can read workshops; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated can read workshops" ON public.dashboard_workshops FOR SELECT TO authenticated USING (true);


--
-- Name: call_agent_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.call_agent_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: call_agent_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.call_agent_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: call_exclusions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.call_exclusions ENABLE ROW LEVEL SECURITY;

--
-- Name: call_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.call_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: call_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: company_merge_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_merge_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_list_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_list_members ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_lists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: daily_routes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_routes ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_cost_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_cost_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_diagnostic_chats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_diagnostic_chats ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_diagnostics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_diagnostics ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_domain_portfolio; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_domain_portfolio ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_feature_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_feature_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_funnel_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_funnel_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_internal_test_patterns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_internal_test_patterns ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_metric_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_metric_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_motor_usage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_motor_usage ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_promo_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_promo_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_raw_metric_rows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_raw_metric_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_review_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_review_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_source_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_source_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_sync_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_sync_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_user_attribution; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_user_attribution ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_user_logins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_user_logins ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_users ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_workshops; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_workshops ENABLE ROW LEVEL SECURITY;

--
-- Name: deal_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deal_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

--
-- Name: diagnostic_videos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.diagnostic_videos ENABLE ROW LEVEL SECURITY;

--
-- Name: dtc_comparisons dtc_cmp_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dtc_cmp_insert ON public.dtc_comparisons FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: dtc_comparisons dtc_cmp_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dtc_cmp_read ON public.dtc_comparisons FOR SELECT TO authenticated USING (true);


--
-- Name: dtc_comparisons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dtc_comparisons ENABLE ROW LEVEL SECURITY;

--
-- Name: dtc_search_history dtc_hist_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dtc_hist_delete ON public.dtc_search_history FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dtc_search_history dtc_hist_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dtc_hist_insert ON public.dtc_search_history FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: dtc_search_history dtc_hist_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dtc_hist_own ON public.dtc_search_history FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: dtc_manual_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dtc_manual_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: dtc_manual_codes dtc_manual_codes_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dtc_manual_codes_read ON public.dtc_manual_codes FOR SELECT TO authenticated USING (true);


--
-- Name: dtc_manual_figures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dtc_manual_figures ENABLE ROW LEVEL SECURITY;

--
-- Name: dtc_manual_figures dtc_manual_figures_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dtc_manual_figures_read ON public.dtc_manual_figures FOR SELECT TO authenticated USING (true);


--
-- Name: dtc_manual_vehicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dtc_manual_vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: dtc_manual_vehicles dtc_manual_vehicles_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dtc_manual_vehicles_read ON public.dtc_manual_vehicles FOR SELECT TO authenticated USING (true);


--
-- Name: dtc_search_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dtc_search_history ENABLE ROW LEVEL SECURITY;

--
-- Name: dtc_wrenchlane_results dtc_wl_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dtc_wl_read ON public.dtc_wrenchlane_results FOR SELECT TO authenticated USING (true);


--
-- Name: dtc_wrenchlane_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dtc_wrenchlane_results ENABLE ROW LEVEL SECURITY;

--
-- Name: email_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

--
-- Name: email_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: email_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forum_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_comment_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forum_comment_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_distribution; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forum_distribution ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_gap_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forum_gap_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_replies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forum_replies ENABLE ROW LEVEL SECURITY;

--
-- Name: forum_thread_replies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.forum_thread_replies ENABLE ROW LEVEL SECURITY;

--
-- Name: gmail_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gmail_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: gmail_sync_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gmail_sync_state ENABLE ROW LEVEL SECURITY;

--
-- Name: inbox_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inbox_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: journey_boards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journey_boards ENABLE ROW LEVEL SECURITY;

--
-- Name: journey_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.journey_items ENABLE ROW LEVEL SECURITY;

--
-- Name: phone_enrichment_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.phone_enrichment_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: phone_numbers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;

--
-- Name: pipelines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;

--
-- Name: prospector_saved_searches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospector_saved_searches ENABLE ROW LEVEL SECURITY;

--
-- Name: prospector_search_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospector_search_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: reddit_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reddit_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: reddit_mentions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reddit_mentions ENABLE ROW LEVEL SECURITY;

--
-- Name: roadmap_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roadmap_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: roadmap_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roadmap_items ENABLE ROW LEVEL SECURITY;

--
-- Name: roadmaps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roadmaps ENABLE ROW LEVEL SECURITY;

--
-- Name: route_stops; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;

--
-- Name: security_findings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.security_findings ENABLE ROW LEVEL SECURITY;

--
-- Name: security_findings security_findings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY security_findings_insert ON public.security_findings FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: security_findings security_findings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY security_findings_select ON public.security_findings FOR SELECT TO authenticated USING (true);


--
-- Name: security_findings security_findings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY security_findings_update ON public.security_findings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: security_scans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.security_scans ENABLE ROW LEVEL SECURITY;

--
-- Name: security_scans security_scans_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY security_scans_select ON public.security_scans FOR SELECT TO authenticated USING (true);


--
-- Name: sequence_auto_enrollments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sequence_auto_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: sequence_enrollments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sequence_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: sequence_step_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sequence_step_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: sequence_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sequence_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: sequences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: snippets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snippets ENABLE ROW LEVEL SECURITY;

--
-- Name: subreddit_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subreddit_access ENABLE ROW LEVEL SECURITY;

--
-- Name: subreddit_access subreddit_access insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "subreddit_access insert" ON public.subreddit_access FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: subreddit_access subreddit_access select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "subreddit_access select" ON public.subreddit_access FOR SELECT TO authenticated USING (true);


--
-- Name: subreddit_access subreddit_access update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "subreddit_access update" ON public.subreddit_access FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: suppressions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppressions ENABLE ROW LEVEL SECURITY;

--
-- Name: switchboard_calls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.switchboard_calls ENABLE ROW LEVEL SECURITY;

--
-- Name: switchboard_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.switchboard_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: switchboard_targets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.switchboard_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: template_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.template_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: unsubscribes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unsubscribes ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_unavailable_dates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_unavailable_dates ENABLE ROW LEVEL SECURITY;

--
-- Name: user_unavailable_dates user_unavailable_dates_self_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_unavailable_dates_self_delete ON public.user_unavailable_dates FOR DELETE USING ((user_id = auth.uid()));


--
-- Name: user_unavailable_dates user_unavailable_dates_self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_unavailable_dates_self_update ON public.user_unavailable_dates FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_unavailable_dates user_unavailable_dates_self_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_unavailable_dates_self_write ON public.user_unavailable_dates FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids))));


--
-- Name: user_unavailable_dates user_unavailable_dates_workspace_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_unavailable_dates_workspace_read ON public.user_unavailable_dates FOR SELECT USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: user_profiles users_insert_own_profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own_profile ON public.user_profiles FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_profiles users_select_own_profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_own_profile ON public.user_profiles FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: user_profiles users_update_own_profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_own_profile ON public.user_profiles FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: activation_plan_groups workspace members can access activation_plan_groups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access activation_plan_groups" ON public.activation_plan_groups USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: activation_plan_items workspace members can access activation_plan_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access activation_plan_items" ON public.activation_plan_items USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: activation_plan_scenarios workspace members can access activation_plan_scenarios; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access activation_plan_scenarios" ON public.activation_plan_scenarios USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: activation_plans workspace members can access activation_plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access activation_plans" ON public.activation_plans USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: call_agent_jobs workspace members can access call_agent_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access call_agent_jobs" ON public.call_agent_jobs USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: call_agent_settings workspace members can access call_agent_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access call_agent_settings" ON public.call_agent_settings USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: call_feedback workspace members can access call_feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access call_feedback" ON public.call_feedback USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: call_sessions workspace members can access call_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access call_sessions" ON public.call_sessions USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: daily_routes workspace members can access daily_routes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access daily_routes" ON public.daily_routes USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: diagnostic_videos workspace members can access diagnostic_videos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access diagnostic_videos" ON public.diagnostic_videos USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: journey_boards workspace members can access journey_boards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access journey_boards" ON public.journey_boards USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: journey_items workspace members can access journey_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access journey_items" ON public.journey_items USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: phone_enrichment_jobs workspace members can access phone_enrichment_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access phone_enrichment_jobs" ON public.phone_enrichment_jobs USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids))) WITH CHECK ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: phone_numbers workspace members can access phone_numbers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access phone_numbers" ON public.phone_numbers USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: roadmap_groups workspace members can access roadmap_groups; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access roadmap_groups" ON public.roadmap_groups USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: roadmap_items workspace members can access roadmap_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access roadmap_items" ON public.roadmap_items USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: roadmaps workspace members can access roadmaps; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access roadmaps" ON public.roadmaps USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: route_stops workspace members can access route_stops; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access route_stops" ON public.route_stops USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: sequence_auto_enrollments workspace members can access sequence_auto_enrollments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access sequence_auto_enrollments" ON public.sequence_auto_enrollments USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: switchboard_calls workspace members can access switchboard_calls; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access switchboard_calls" ON public.switchboard_calls USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: switchboard_settings workspace members can access switchboard_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access switchboard_settings" ON public.switchboard_settings USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: switchboard_targets workspace members can access switchboard_targets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access switchboard_targets" ON public.switchboard_targets USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: tasks workspace members can access tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can access tasks" ON public.tasks USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: prospector_saved_searches workspace members can manage saved searches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can manage saved searches" ON public.prospector_saved_searches USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: snippets workspace members can manage snippets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can manage snippets" ON public.snippets USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: prospector_search_cache workspace members can use search cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can use search cache" ON public.prospector_search_cache USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: template_versions workspace members can view template versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members can view template versions" ON public.template_versions USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: call_exclusions workspace members manage call exclusions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "workspace members manage call exclusions" ON public.call_exclusions USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids))) WITH CHECK ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: workspace_ai_knowledge; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_ai_knowledge ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_ai_knowledge workspace_ai_knowledge_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_ai_knowledge_read ON public.workspace_ai_knowledge FOR SELECT USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: workspace_ai_knowledge workspace_ai_knowledge_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_ai_knowledge_write ON public.workspace_ai_knowledge USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids))) WITH CHECK ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: workspace_ai_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_ai_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: workspace_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

--
-- Name: gmail_sync_state workspace_members_can_access_gmail_sync_state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_can_access_gmail_sync_state ON public.gmail_sync_state USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: inbox_messages workspace_members_can_access_inbox_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_can_access_inbox_messages ON public.inbox_messages USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: subscriptions workspace_members_can_access_subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_can_access_subscriptions ON public.subscriptions USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: suppressions workspace_members_can_access_suppressions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_can_access_suppressions ON public.suppressions USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: usage_events workspace_members_can_access_usage_events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_can_access_usage_events ON public.usage_events USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: workspace_ai_settings workspace_members_can_insert_ai_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_can_insert_ai_settings ON public.workspace_ai_settings FOR INSERT WITH CHECK ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: workspace_ai_settings workspace_members_can_select_ai_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_can_select_ai_settings ON public.workspace_ai_settings FOR SELECT USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: workspace_ai_settings workspace_members_can_update_ai_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workspace_members_can_update_ai_settings ON public.workspace_ai_settings FOR UPDATE USING ((workspace_id IN ( SELECT public.get_user_workspace_ids() AS get_user_workspace_ids)));


--
-- Name: workspaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--




--
-- Storage buckets and policies.
--
-- The storage schema itself is created and owned by Supabase, so it is not
-- dumped here; only the rows and the policy this application adds to it.
--

INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES
  ('avatars',        'avatars',        true, false,  5242880, ARRAY['image/jpeg','image/png','image/gif','image/webp']),
  ('email-images',   'email-images',   true, false,  5242880, ARRAY['image/jpeg','image/png','image/gif','image/webp']),
  ('journey-images', 'journey-images', true, false, 10485760, NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public can read email images" ON storage.objects;
CREATE POLICY "public can read email images" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'email-images'::text);


--
-- PostgreSQL database dump complete
--

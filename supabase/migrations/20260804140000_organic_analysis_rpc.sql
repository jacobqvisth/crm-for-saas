-- /dashboard/organic-analysis data source.
--
-- Search Console is by far the biggest writer into dashboard_metric_snapshots
-- (~140k of ~161k rows). Paging those rows out over PostgREST is what makes
-- the all_time dashboard read time out, so this page never reads rows: every
-- aggregate is computed server-side and returned as a single JSONB document.
--
-- The snapshot table stores one ROW PER METRIC (clicks / impressions / ctr /
-- position) per period per dimension, so everything starts from a pivot on
-- (period_start, dimension_key) before any analysis can happen.
--
-- Analysis returned:
--   daily            - dimension-less daily totals (the headline trend)
--   daily_by_host    - daily split by hostname, derived from the page dimension.
--                      This is what separates a subdomain collapse from a
--                      site-wide decline; the two look identical in totals.
--   monthly_by_host  - monthly clicks/impressions + DISTINCT PAGES earning
--                      impressions. Page count is the content-velocity signal:
--                      a shrinking count means rankings are being lost even
--                      when impressions look flat.
--   branded_monthly  - branded vs non-branded split. Branded clicks are demand
--                      you already earned; growth has to come from non-branded.
--   position_buckets - impressions by SERP position band. Page-2 impressions
--                      are effectively unmonetizable, so a high 11-20 share
--                      explains a low sitewide CTR on its own.
--   zero_click       - queries with impressions but literally zero clicks.
--   page_two         - queries ranking 11-20 with real volume (upside list).
--   countries        - impressions vs CTR per country (ICP fit check).
--   top_pages        - per-page performance including host.

CREATE OR REPLACE FUNCTION public.get_organic_analysis(
  p_start TIMESTAMPTZ DEFAULT NULL,
  p_end TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH bounds AS (
    SELECT
      COALESCE(p_start, '2000-01-01'::timestamptz) AS lo,
      COALESCE(p_end, now() + interval '1 day') AS hi
  ),
  -- One row per (period, dimension) with the four metrics pivoted onto it.
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
      -- https://host/path -> host
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
  -- Aggregate a query across the window. Position is impression-weighted:
  -- a plain avg would let a single 2-impression day at rank 3 outvote a
  -- 4,000-impression month at rank 14.
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

    -- Impressions but no clicks at all. Usually a definition-style query where
    -- Google answers in the SERP, or a rank too low to be seen.
    'zero_click', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.impressions DESC)
      FROM (
        SELECT query, impressions, clicks, position
        FROM query_agg
        WHERE clicks = 0 AND impressions >= 50
        ORDER BY impressions DESC LIMIT 25
      ) x
    ), '[]'::jsonb),

    -- Ranking 11-20 with real volume: one or two positions of movement puts
    -- these on page 1, so this is the highest-leverage work list.
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

GRANT EXECUTE ON FUNCTION public.get_organic_analysis TO authenticated, service_role;

-- The pivot CTE scans every search_console row in the window. The existing
-- unique index leads with source_key but the planner was choosing a seq scan;
-- this makes the range predicate directly indexable as the table grows.
CREATE INDEX IF NOT EXISTS dashboard_metric_snapshots_source_period_idx
  ON public.dashboard_metric_snapshots (source_key, period_start DESC);

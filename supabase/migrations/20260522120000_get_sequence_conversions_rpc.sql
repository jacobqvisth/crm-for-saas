-- /ceo/conversions data source.
--
-- For each sequence in the workspace, returns total sent emails + unique
-- recipients + attributed signups + send→signup conversion rate +
-- median lag (days between attribution and signup-contact created_at).
-- Excludes sequences with neither sends nor signups in the window.

CREATE OR REPLACE FUNCTION public.get_sequence_conversions(
  p_workspace_id UUID,
  p_since TIMESTAMPTZ DEFAULT (now() - interval '90 days')
)
RETURNS TABLE (
  sequence_id UUID,
  sequence_name TEXT,
  sequence_status TEXT,
  total_sends BIGINT,
  unique_recipients BIGINT,
  attributed_signups BIGINT,
  conversion_rate NUMERIC,
  median_lag_days NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
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
  sends AS (
    SELECT
      se.sequence_id,
      count(*) AS sent_count,
      count(DISTINCT eq.contact_id) AS unique_recipients
    FROM email_queue eq
    JOIN sequence_enrollments se ON eq.enrollment_id = se.id
    WHERE eq.workspace_id = p_workspace_id
      AND eq.status = 'sent'
      AND eq.sent_at >= p_since
    GROUP BY 1
  )
  SELECT
    s.id,
    s.name,
    s.status,
    COALESCE(sends.sent_count, 0)::bigint,
    COALESCE(sends.unique_recipients, 0)::bigint,
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

GRANT EXECUTE ON FUNCTION public.get_sequence_conversions TO authenticated, service_role;

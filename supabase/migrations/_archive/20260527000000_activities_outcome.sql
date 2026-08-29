-- Add activity-level outcome (extends the field-visit outcome enum) so
-- calls + emails + visits can share a single sales taxonomy. The original
-- 5 values come from route_stops.visit_outcome; the last 3 are call-only
-- dispositions that don't apply to in-person visits.
--
-- Nullable on purpose: most activity rows (system events, opens, clicks,
-- contact_created, etc.) never need one.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS outcome TEXT;

ALTER TABLE activities
  DROP CONSTRAINT IF EXISTS activities_outcome_check;

ALTER TABLE activities
  ADD CONSTRAINT activities_outcome_check CHECK (
    outcome IS NULL OR outcome IN (
      'interested',
      'not_interested',
      'closed',
      'no_answer',
      'skipped',
      -- call-only dispositions
      'left_voicemail',
      'callback_scheduled',
      'wrong_number'
    )
  );

CREATE INDEX IF NOT EXISTS activities_outcome_idx
  ON activities (outcome)
  WHERE outcome IS NOT NULL;

-- Backfill: field_visit activities already carry their outcome on the
-- linked route_stops row. Copy it onto the activity so the new column is
-- the single source of truth going forward.
UPDATE activities a
SET outcome = rs.visit_outcome
FROM route_stops rs
WHERE a.type = 'field_visit'
  AND a.outcome IS NULL
  AND rs.visit_outcome IS NOT NULL
  AND a.metadata ? 'stopId'
  AND (a.metadata->>'stopId')::uuid = rs.id;

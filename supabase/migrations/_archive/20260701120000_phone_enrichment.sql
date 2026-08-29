-- Phone enrichment: record search attempts + a background queue so bulk
-- "Find numbers" runs server-side and we never re-search the same contact
-- endlessly.

-- 1. Record the last search attempt + its outcome on the record itself, so
--    every surface can show "searched — none found" and skip re-work.
--    outcome: 'found' | 'none' | 'blocked' | 'error'
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_searched_at    TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_search_outcome TEXT;

-- 2. Background queue for bulk enrichment. The Call Planner enqueues rows and a
--    cron worker drains them, so the user can leave the page and numbers appear
--    as they're found.
CREATE TABLE IF NOT EXISTS phone_enrichment_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES contacts(id)   ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'queued',  -- queued | processing | done | error
  outcome       TEXT,                            -- found | none | blocked | error
  saved_count   INT  NOT NULL DEFAULT 0,
  website_added TEXT,
  error         TEXT,
  attempts      INT  NOT NULL DEFAULT 0,
  requested_by  UUID,
  enqueued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Claim order: oldest queued first.
CREATE INDEX IF NOT EXISTS phone_enrichment_jobs_claim_idx
  ON phone_enrichment_jobs (status, enqueued_at);
CREATE INDEX IF NOT EXISTS phone_enrichment_jobs_ws_idx
  ON phone_enrichment_jobs (workspace_id, status);
-- At most one OPEN job per contact — re-enqueues while one is pending are no-ops.
CREATE UNIQUE INDEX IF NOT EXISTS phone_enrichment_jobs_open_uniq
  ON phone_enrichment_jobs (workspace_id, contact_id)
  WHERE status IN ('queued', 'processing');

CREATE TRIGGER update_phone_enrichment_jobs_updated_at
  BEFORE UPDATE ON phone_enrichment_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE phone_enrichment_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members can access phone_enrichment_jobs"
  ON phone_enrichment_jobs
  USING (workspace_id IN (SELECT get_user_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT get_user_workspace_ids()));

-- Saved searches: store named filter sets per workspace
CREATE TABLE IF NOT EXISTS prospector_saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL,
  last_run_at TIMESTAMPTZ,
  result_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE prospector_saved_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage saved searches"
  ON prospector_saved_searches
  FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE INDEX IF NOT EXISTS idx_prospector_saved_searches_workspace
  ON prospector_saved_searches(workspace_id);

-- Search cache: store Prospeo results keyed by filter hash + workspace
CREATE TABLE IF NOT EXISTS prospector_search_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  search_hash TEXT NOT NULL,
  filters JSONB NOT NULL,
  results JSONB NOT NULL,
  pagination JSONB NOT NULL,
  searched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE prospector_search_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can use search cache"
  ON prospector_search_cache
  FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE UNIQUE INDEX IF NOT EXISTS idx_prospector_search_cache_hash
  ON prospector_search_cache(workspace_id, search_hash);

CREATE INDEX IF NOT EXISTS idx_prospector_search_cache_expires
  ON prospector_search_cache(expires_at);

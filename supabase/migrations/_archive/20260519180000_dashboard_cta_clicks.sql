-- Per-day rollup of GA4 cta_click events, broken down by host_name,
-- page_path, button_text, and cta_location. Populated by the
-- /api/cron/sync-cta-clicks daily cron from the GA4 Data API.
--
-- One row per (date, host_name, page_path, button_text, cta_location)
-- — upsert on that compound key so re-running the cron is idempotent.
-- button_text and cta_location can be empty when GA4 hasn't propagated
-- the custom dims yet; the unique key treats '' as a distinct value so
-- "warming up" rows don't collide with later, dimensionally-attributed
-- rows.

CREATE TABLE IF NOT EXISTS dashboard_cta_clicks (
  id BIGSERIAL PRIMARY KEY,
  date DATE NOT NULL,
  host_name TEXT NOT NULL,
  page_path TEXT NOT NULL,
  button_text TEXT NOT NULL DEFAULT '',
  cta_location TEXT NOT NULL DEFAULT '',
  events INTEGER NOT NULL DEFAULT 0,
  users INTEGER NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (date, host_name, page_path, button_text, cta_location)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_cta_clicks_date
  ON dashboard_cta_clicks (date DESC);

CREATE INDEX IF NOT EXISTS idx_dashboard_cta_clicks_host_date
  ON dashboard_cta_clicks (host_name, date DESC);

CREATE INDEX IF NOT EXISTS idx_dashboard_cta_clicks_location
  ON dashboard_cta_clicks (cta_location);

-- Feature usage + login history (/dashboard/feature-usage).
--
-- 2026-06-11: the codeoc S3 export (latest/user_stats.json.gz) gained
-- per-user data the CRM never had before:
--   * login_history — array of the user's last 30 login timestamps
--   * per-feature activity counters: {diagnostics,chat,ai_search,
--     vrm_lookups}_today_count + *_count_date, infopro_vehicles_{today,month},
--     motor_vehicles_month
--   * churned_at / has_used_trial
--
-- Two new tables accumulate those snapshots into real time series:
--
--   dashboard_user_logins — one row per (user, login timestamp). The export
--     only carries each user's last 30 logins, so the hourly core_app sync
--     insert-ignores them here and history grows past the cap over time.
--     ~14 months of backfill arrives with the first sync.
--
--   dashboard_feature_usage — one row per (user, feature, period). The
--     export counters are "count on *_count_date" snapshots (NOT lifetime
--     totals): the counter grows during a user's active day and the date
--     field marks that day. Within one period the hourly sync upserts
--     last-write-wins, which is correct because the counter is cumulative
--     within its period. granularity records whether period_start is a day
--     or a calendar month (infopro/motor month counters).
--
-- dashboard_workshops.churned_at / dashboard_users.churned_at: user-level
-- churn timestamps from the same export, rolled up owner-first per workshop.
-- propagate-to-crm copies the workshop value onto companies.churned_at,
-- which finally feeds the Field Routes lapsed pool (it filters on
-- activated_at OR churned_at, both all-NULL until now).

CREATE TABLE IF NOT EXISTS dashboard_user_logins (
  internal_user_id TEXT NOT NULL,
  logged_in_at TIMESTAMPTZ NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (internal_user_id, logged_in_at)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_user_logins_logged_in_at
  ON dashboard_user_logins (logged_in_at DESC);

CREATE TABLE IF NOT EXISTS dashboard_feature_usage (
  internal_user_id TEXT NOT NULL,
  -- App-level enum (src/lib/ceo/feature-usage/features.ts):
  -- 'diagnostics' | 'chat' | 'ai_search' | 'vrm_lookups' |
  -- 'infopro_vehicles' | 'motor_vehicles'. Intentionally not a DB enum —
  -- the CTO adds counters to the export faster than we migrate.
  feature_key TEXT NOT NULL,
  granularity TEXT NOT NULL DEFAULT 'day' CHECK (granularity IN ('day', 'month')),
  period_start DATE NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (internal_user_id, feature_key, granularity, period_start)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_feature_usage_feature_period
  ON dashboard_feature_usage (feature_key, granularity, period_start DESC);

ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS churned_at TIMESTAMPTZ;
ALTER TABLE dashboard_workshops ADD COLUMN IF NOT EXISTS churned_at TIMESTAMPTZ;

-- RLS: mirror the other dashboard_* tables — authenticated read, writes go
-- through the service-role sync client (bypasses RLS).
ALTER TABLE dashboard_user_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_feature_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read user logins" ON dashboard_user_logins;
CREATE POLICY "authenticated can read user logins"
  ON dashboard_user_logins FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated can read feature usage" ON dashboard_feature_usage;
CREATE POLICY "authenticated can read feature usage"
  ON dashboard_feature_usage FOR SELECT TO authenticated USING (true);

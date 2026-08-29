-- Per-user first-touch attribution from GA4 (/dashboard/google-ads-users).
--
-- Both wrenchlane.com and app.wrenchlane.com run the same GA4 property
-- (GTM-5JRQVHHS -> 479182799), so the _ga cookie survives the marketing ->
-- app hop and GA4 stamps every identified user (customUser:crm_user_id,
-- wired 2026-05-25) with their first-touch source/medium/campaign. The
-- hourly ga4-attribution sync pulls that report and upserts here; the
-- crm_user_id value equals dashboard_users.internal_user_id (Cognito sub)
-- and contacts.wl_user_id.
--
-- Reliability caveat baked into the data: users who signed up BEFORE the
-- 2026-05-25 user-ID wiring got their firstUser* stamped at their first
-- identified session, which can postdate signup. Consumers should treat
-- attribution for pre-June-2026 signups as approximate.

CREATE TABLE IF NOT EXISTS dashboard_user_attribution (
  internal_user_id TEXT PRIMARY KEY,
  first_source TEXT,
  first_medium TEXT,
  first_campaign TEXT,
  first_channel_group TEXT,
  google_ads_campaign TEXT,
  -- Server-side classification (src/lib/ceo/attribution/classify.ts):
  -- 'google_ads' | 'app_store' | 'organic_search' | 'email' | 'referral' |
  -- 'direct' | 'other' | 'unknown'. Text, not an enum, on purpose.
  channel TEXT NOT NULL DEFAULT 'unknown',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_user_attribution_channel
  ON dashboard_user_attribution (channel);

-- RLS: mirror the other dashboard_* tables — authenticated read, writes go
-- through the service-role sync client (bypasses RLS).
ALTER TABLE dashboard_user_attribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read user attribution" ON dashboard_user_attribution;
CREATE POLICY "authenticated can read user attribution"
  ON dashboard_user_attribution FOR SELECT TO authenticated USING (true);

-- pg_cron jobs for the CEO dashboard sync routes (absorbed from wl-dashboard).
-- Run this against the crm-for-saas Supabase project (ref wdgiwuhehqpkhpvdzzzl)
-- ONLY after CEO env vars are set in the crm-for-saas Vercel project AND a
-- manual smoke test (curl with Bearer SYNC_SECRET) confirms the routes work.
--
-- Replace the two placeholders before running:
--   __SYNC_SECRET__ should match the SYNC_SECRET set in crm-for-saas Vercel
--   The base URL is hardcoded to crm-for-saas.vercel.app — change if you use a
--   custom domain.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- core_app pulls dashboard_users + dashboard_diagnostics from S3. Bumped to
-- hourly 2026-05-26 because the dashboard was lagging by up to 8 hours behind
-- reality. AWS-side S3 export is also being moved to hourly; this cron picks
-- up the fresh file each hour.
select cron.schedule(
  'ceo-sync-core-app-hourly',
  '25 * * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/core_app',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

-- If re-applying this file against a prod where the old twice-daily job exists,
-- run this once to retire it:
-- select cron.unschedule('ceo-sync-core-app-twice-daily');

select cron.schedule(
  'ceo-sync-ga4-hourly',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/ga4',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

select cron.schedule(
  'ceo-sync-google-ads-hourly',
  '17 * * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/google_ads',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

select cron.schedule(
  'ceo-sync-search-console-hourly',
  '23 * * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/search_console',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

select cron.schedule(
  'ceo-sync-customer-io-hourly',
  '29 * * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/customer_io',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

select cron.schedule(
  'ceo-sync-stripe-hourly',
  '41 * * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/stripe',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

select cron.schedule(
  'ceo-sync-app-store-hourly',
  '53 * * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/app_store_connect',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

-- posthog pulls daily product-analytics aggregates (active users, pageviews,
-- sessions, custom events) via the HogQL Query API. Added 2026-06-15. Only
-- runs once POSTHOG_API_KEY + POSTHOG_PROJECT_ID are set in Vercel; otherwise
-- the route returns status=skipped and writes nothing.
select cron.schedule(
  'ceo-sync-posthog-hourly',
  '47 * * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/posthog',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

-- AFTER the new jobs run successfully against crm-for-saas at least once
-- (check `select * from cron.job_run_details order by start_time desc limit 20;`),
-- run this against the OLD wl-dashboard Supabase (ref ivjlbknopdvadawjqpxl)
-- to retire the duplicate jobs (otherwise you'll have BOTH writing to the
-- absorbed dashboard_* tables — same DB now, but old jobs hit the dead
-- wl-dashboard-three.vercel.app endpoints, which won't exist after retirement).
--
-- select cron.unschedule('wl-sync-core-app-twice-daily');
-- select cron.unschedule('wl-sync-ga4-hourly');
-- select cron.unschedule('wl-sync-google-ads-hourly');
-- select cron.unschedule('wl-sync-search-console-hourly');
-- select cron.unschedule('wl-sync-customer-io-hourly');
-- select cron.unschedule('wl-sync-stripe-hourly');
-- select cron.unschedule('wl-sync-app-store-hourly');

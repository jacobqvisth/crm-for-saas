-- Schedule the Google Ads API sync.
--
-- Run this AFTER GOOGLE_ADS_DEVELOPER_TOKEN is set in Vercel production.
-- Until then the route returns "skipped" every run, which is harmless but noisy
-- in dashboard_sync_runs.
--
-- Replace __SYNC_SECRET__ with the real SYNC_SECRET before running, and do not
-- commit the substituted file: the token ends up inside the cron command string
-- in cron.job, visible to anyone who can read that table.
--
-- Daily rather than hourly, deliberately:
--   - Keyword Planner volumes are monthly figures, so hourly polling buys nothing
--     and burns quota. An Explorer token allows only 2,880 operations/day, and one
--     full keyword pass is ~15 operations (one per EU geo target).
--   - The search-terms report only gains a day's rows per day.
--
-- Slot 47 past the hour at 05:00 UTC keeps it clear of the other CEO syncs
-- (ga4=H:05, google_ads=H:17, search_console=H:23, core_app=H:25,
--  customer_io=H:29, stripe=H:41, posthog=H:47, app_store=H:53).

select cron.schedule(
  'ceo-sync-google-ads-api-daily',
  '47 5 * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/google_ads_api',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

-- To remove:
-- select cron.unschedule('ceo-sync-google-ads-api-daily');

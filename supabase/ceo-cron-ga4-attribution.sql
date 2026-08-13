-- Schedule the GA4 per-user attribution sync.
--
-- Replace __SYNC_SECRET__ with the real SYNC_SECRET before running, and do not
-- commit the substituted file: the token ends up inside the cron command string
-- in cron.job, visible to anyone who can read that table.
--
-- Hourly like the other GA4-backed sources: the report is one Data API call
-- (all identified users in one page), and new signups should show up on
-- /dashboard/google-ads-users within the hour. Slot H:11 keeps it clear of
-- the other CEO syncs (ga4=H:05, google_ads=H:17, search_console=H:23,
-- core_app=H:25, customer_io=H:29, stripe=H:41, posthog=H:47,
-- app_store=H:53).

select cron.schedule(
  'ceo-sync-ga4-attribution-hourly',
  '11 * * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/ga4_attribution',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

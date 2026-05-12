-- Throttle daily-resolution CEO sync sources from hourly → once-daily.
--
-- GA4, Google Ads, Search Console, and App Store Connect all surface data
-- that updates at most once per day on the provider side. Hourly polling
-- was getting the same answer 23x in a row. Drop those to a single 06:00 UTC
-- pull (staggered 5 min apart). Stripe and Customer.io stay hourly — Stripe
-- carries trial / billing state we want close-to-realtime, and Customer.io
-- is the live feed the new discoverer fallback relies on. The `core_app`
-- twice-daily job is left untouched; that schedule mirrors the 02:00 + 10:00
-- UTC S3 export cadence on the WL-app side.
--
-- The `__SYNC_SECRET__` placeholder must be substituted with the prod
-- SYNC_SECRET value before applying. Mirrors the pattern used in
-- supabase/ceo-cron.sql when the original jobs were installed (PR #120).

select cron.unschedule('ceo-sync-ga4-hourly');
select cron.unschedule('ceo-sync-google-ads-hourly');
select cron.unschedule('ceo-sync-search-console-hourly');
select cron.unschedule('ceo-sync-app-store-hourly');

select cron.schedule(
  'ceo-sync-ga4-daily',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/ga4',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

select cron.schedule(
  'ceo-sync-google-ads-daily',
  '5 6 * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/google_ads',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

select cron.schedule(
  'ceo-sync-search-console-daily',
  '10 6 * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/search_console',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

select cron.schedule(
  'ceo-sync-app-store-daily',
  '15 6 * * *',
  $$
  select net.http_post(
    url := 'https://crm-for-saas.vercel.app/api/ceo-sync/app_store_connect',
    headers := jsonb_build_object('authorization', 'Bearer __SYNC_SECRET__')
  );
  $$
);

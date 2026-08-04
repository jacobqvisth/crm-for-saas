-- Register the Google Ads API as its own dashboard source.
--
-- Deliberately separate from the existing `google_ads` source: that one reads
-- GA4's advertiserAdCost/Clicks/Impressions dimensions, so it knows spend but
-- carries no search terms and no market keyword volume. This source talks to the
-- Google Ads API directly.
--
-- `source_key` is plain text with no CHECK constraint, so no DDL is needed for
-- the new key. This only seeds the account row the dashboard reads for status.
--
-- Status starts as 'pending' because the connector needs
-- GOOGLE_ADS_DEVELOPER_TOKEN, which requires Basic access on a manager account
-- for the Keyword Planner half.

insert into public.dashboard_source_accounts (source_key, display_name, status)
values ('google_ads_api', 'Google Ads API', 'pending')
on conflict (source_key) do nothing;

-- Rename the GA4-derived source so the two are not mistaken for each other on
-- the sources page.
update public.dashboard_source_accounts
set display_name = 'Google Ads (via GA4)'
where source_key = 'google_ads'
  and display_name = 'Google Ads';

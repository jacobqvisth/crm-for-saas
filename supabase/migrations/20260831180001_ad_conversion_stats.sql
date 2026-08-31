-- What Google Ads BELIEVES happened, stored next to what actually happened, for
-- /dashboard/paying-customers.
--
-- The page exists because those two are not the same thing, and the difference
-- is currently invisible. Measured on this account 2026-08-31:
--
--   month     Google "purchase"   our checkouts   our real first payments
--   2026-05           1                 1                   0
--   2026-06          26                26                   2
--   2026-07          32                32                  10
--   2026-08          32                37                   4
--
-- The conversion action named `WrenchLane (web) purchase` tracks the moment a
-- card is entered and a trial begins, not the moment money moves. Its counts
-- track our checkout table almost row for row and bear no relation to our
-- first-payment table. Everything it reports as revenue is the list price of a
-- plan somebody selected, and most of those people never pay.
--
-- Storing Google's own numbers is therefore not duplication of the Ads UI. It
-- is the only way to put the claim and the reality in one row and see the gap.
--
-- ADDITIVE ONLY: two new tables, nothing existing touched.

-- ------------------------------------------------------- conversion actions
-- Configuration, not performance. Which actions exist, and — the part that
-- matters — which ones actually reach the bidding algorithm. An action only
-- influences bidding when it is BOTH `primary_for_goal` and
-- `include_in_conversions_metric`. On this account exactly two are: the web and
-- Android `sign_up`. Revenue reaches bidding through nothing at all.
create table if not exists public.dashboard_ad_conversion_actions (
  conversion_action_id          text primary key,
  name                          text not null,
  category                      text,
  type                          text,
  status                        text,
  primary_for_goal              boolean,
  include_in_conversions_metric boolean,
  counting_type                 text,
  click_lookback_days           integer,
  synced_at                     timestamptz not null default now()
);

comment on table public.dashboard_ad_conversion_actions is
  'Google Ads conversion action config. An action drives bidding only when primary_for_goal AND include_in_conversions_metric are both true.';

-- -------------------------------------------------------------- daily stats
-- `campaign_id = ''` is the account-level roll-up, which is deliberately stored
-- alongside the per-campaign rows rather than derived from them: Google's
-- account total is not always the sum of its campaigns (cross-network and
-- unattributed conversions land only in the total), and silently presenting a
-- sum as the total is how a dashboard starts under-reporting without anyone
-- noticing.
create table if not exists public.dashboard_ad_conversion_stats (
  conversion_action_id  text not null,
  campaign_id           text not null,
  campaign_name         text,
  stat_date             date not null,
  all_conversions       numeric not null default 0,
  all_conversions_value numeric not null default 0,
  primary key (conversion_action_id, campaign_id, stat_date)
);

comment on table public.dashboard_ad_conversion_stats is
  'Daily Google Ads conversions per action. campaign_id = '''' is the account-level total, stored rather than summed because Google''s total includes conversions no campaign row carries.';

create index if not exists dashboard_ad_conversion_stats_date_idx
  on public.dashboard_ad_conversion_stats (stat_date);

-- Service role only; RLS on with no policy is the strict correct setting.
alter table public.dashboard_ad_conversion_actions enable row level security;
alter table public.dashboard_ad_conversion_stats   enable row level security;

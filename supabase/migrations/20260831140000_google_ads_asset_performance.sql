-- Asset-level Google Ads performance, for /dashboard/best-ads.
--
-- The existing campaigns page reads GA4's linked-Ads dimensions, which stop at
-- the campaign. GA4 has no concept of an asset, so it cannot answer "which
-- headline earns the click" or "which image is worth making more of". Only the
-- Google Ads API can, and only through `ad_group_ad_asset_view`, which is why
-- this is its own store rather than more rows in dashboard_metric_snapshots:
-- an asset is a wide record (text, image URL, pixel dimensions, video id) and
-- the snapshot table carries a single scalar per row.
--
-- THE ONE THING TO KNOW BEFORE READING THIS DATA. Asset metrics are NOT
-- additive. Google credits every asset that served in an impression with that
-- impression and its click, so three headlines in one responsive search ad each
-- book the same click. Summing clicks across assets in a campaign overshoots
-- the campaign's real click count by roughly the number of assets per ad —
-- measured at 3.8x on us-codes+make. So an asset's rate (CTR, conversion rate)
-- is meaningful and its totals are not a budget. Every rollup out of these
-- tables must compare rates within a field type, never add volumes up.
--
-- ADDITIVE ONLY: three new tables and one new function. Nothing existing is
-- touched, so this is safe to apply while the previous release is still live.

-- ---------------------------------------------------------------- dimensions
-- One row per asset, account-wide. Assets are account-level objects in Google
-- Ads and are deliberately reused across campaigns (54 of ours are, one across
-- six), so the creative itself is keyed on nothing but its own id.
create table if not exists public.dashboard_ad_assets (
  asset_id            text primary key,
  asset_type          text not null,
  name                text,
  text_content        text,
  image_url           text,
  image_width         integer,
  image_height        integer,
  youtube_video_id    text,
  youtube_video_title text,
  synced_at           timestamptz not null default now()
);

comment on table public.dashboard_ad_assets is
  'Google Ads creative assets (headline/description text, image URLs, YouTube ids), account-wide. Written by /api/cron/sync-google-ads-assets.';

-- ------------------------------------------------------------------- metrics
-- Daily grain. Roughly 19k rows for the account's whole history, so storing the
-- day rather than a pre-baked window costs almost nothing and leaves every
-- future date range answerable without a re-sync.
--
-- `surface` separates the two report families, which count differently and must
-- never be pooled: `ad_group_ad` rows carry the serving ad's impressions and
-- clicks (the non-additive case above), while `campaign_asset` rows for
-- sitelinks and callouts carry clicks genuinely attributed to that asset.
create table if not exists public.dashboard_ad_asset_metrics (
  asset_id          text not null,
  field_type        text not null,
  surface           text not null,
  campaign_id       text not null,
  campaign_name     text not null,
  channel_type      text,
  stat_date         date not null,
  impressions       bigint  not null default 0,
  clicks            bigint  not null default 0,
  cost_micros       bigint  not null default 0,
  conversions       numeric not null default 0,
  conversions_value numeric not null default 0,
  primary key (asset_id, field_type, surface, campaign_id, stat_date)
);

comment on table public.dashboard_ad_asset_metrics is
  'Daily per-asset Google Ads metrics. NOT additive across assets: every asset that served in an impression is credited with it. Compare rates within a field_type; never sum clicks across assets.';

create index if not exists dashboard_ad_asset_metrics_date_idx
  on public.dashboard_ad_asset_metrics (stat_date);

create index if not exists dashboard_ad_asset_metrics_asset_idx
  on public.dashboard_ad_asset_metrics (asset_id);

-- ---------------------------------------------------------------- placements
-- Where an asset is currently attached, including the places that report no
-- metrics at all. Performance Max asset groups are the reason this table
-- exists: `asset_group_asset` exposes no metrics and no performance label on
-- API v25, so 151 of our live creatives — every PMax image and video — would
-- otherwise be invisible to this page. Showing them as inventory with an honest
-- "no data" is better than implying they do not exist.
create table if not exists public.dashboard_ad_asset_placements (
  asset_id       text not null,
  container      text not null,
  container_id   text not null,
  container_name text,
  campaign_id    text,
  campaign_name  text,
  field_type     text not null,
  status         text,
  synced_at      timestamptz not null default now(),
  primary key (asset_id, container, container_id, field_type)
);

comment on table public.dashboard_ad_asset_placements is
  'Which asset groups / campaigns an asset is attached to. Performance Max asset groups report no per-asset metrics on API v25, so these rows are the only record that those creatives exist.';

-- Service role only. RLS on with no policy is the strict correct setting: a
-- leaked publishable key reads nothing.
alter table public.dashboard_ad_assets           enable row level security;
alter table public.dashboard_ad_asset_metrics    enable row level security;
alter table public.dashboard_ad_asset_placements enable row level security;

-- ------------------------------------------------------------------- rollup
-- Aggregate in SQL, one row per (asset, field type, surface), because PostgREST
-- caps ANY response at 1000 rows — RPCs included — and silently truncates past
-- it. 19k daily rows would be cut to 5% of the data with no error. Collapsed
-- this way the account yields ~300 rows, comfortably inside the cap, and the
-- caller runs it once per window rather than asking for every window at once.
create or replace function public.dashboard_ad_asset_rollup(
  p_start date,
  p_end   date
)
returns table (
  asset_id          text,
  field_type        text,
  surface           text,
  impressions       bigint,
  clicks            bigint,
  cost_micros       bigint,
  conversions       numeric,
  conversions_value numeric,
  campaign_names    text[],
  channel_types     text[],
  first_day         date,
  last_day          date
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.asset_id,
    m.field_type,
    m.surface,
    sum(m.impressions)::bigint        as impressions,
    sum(m.clicks)::bigint             as clicks,
    sum(m.cost_micros)::bigint        as cost_micros,
    sum(m.conversions)::numeric       as conversions,
    sum(m.conversions_value)::numeric as conversions_value,
    array_agg(distinct m.campaign_name order by m.campaign_name) as campaign_names,
    array_remove(array_agg(distinct m.channel_type), null)       as channel_types,
    min(m.stat_date)                  as first_day,
    max(m.stat_date)                  as last_day
  from public.dashboard_ad_asset_metrics m
  where m.stat_date >= p_start
    and m.stat_date <= p_end
  group by m.asset_id, m.field_type, m.surface
  having sum(m.impressions) > 0;
$$;

comment on function public.dashboard_ad_asset_rollup(date, date) is
  'Per-asset rollup for a date window. Aggregates in SQL so the result stays under PostgREST''s 1000-row ceiling. Call once per window.';

revoke all on function public.dashboard_ad_asset_rollup(date, date) from public;
grant execute on function public.dashboard_ad_asset_rollup(date, date) to service_role;

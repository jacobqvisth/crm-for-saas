-- Close issue #747: the four tables in `public` that still have row level
-- security switched off.
--
-- WHAT WAS ACTUALLY WRONG, which is not what the issue said
-- ---------------------------------------------------------
-- The issue describes a cross-workspace leak: "it is workspace-scoped
-- everywhere else in the code. Every read path filters on `workspace_id` in
-- application code, and nothing in the database enforces that."
--
-- That is not the shape of this table. `discovered_shops` has 52 columns and
-- NONE of them is `workspace_id`, `user_id` or any other tenancy column. It is
-- a global scrape staging table. There is nothing to scope a policy BY, so the
-- policy the issue asks for cannot be written as described.
--
-- The real exposure is larger and simpler. With RLS disabled, access is
-- governed by table GRANTs, and Supabase grants the `anon` role SELECT on
-- public tables. `anon` is the publishable key, which ships inside the browser
-- bundle of the live app and is therefore public. Verified against production
-- on 2026-08-31 with nothing but that key and no session at all:
--
--   GET /rest/v1/discovered_shops?select=name,primary_email,phone
--     -> HTTP 200, 43,272 rows, real names, real emails, real phone numbers
--
-- The same probe returned `[]` for `contacts` and `companies`, which is how we
-- know the probe was honest and that RLS genuinely works on the rest of the
-- schema. So this was not a tidiness problem waiting on a second tenant: it
-- was ~43k scraped prospect contact records readable by anyone on the internet
-- holding a key that is published in a JavaScript bundle.
--
-- WHY `using (true)` IS THE CORRECT POLICY HERE AND NOT A CLIMBDOWN
-- ----------------------------------------------------------------
-- This product is one database per customer (see docs/plans/productisation/).
-- The database IS the tenant boundary. Animech holds zero rows in this table
-- and cannot reach this one at all. Within a tenant's own database every
-- authenticated user is that customer's own staff, and this staging table is
-- deliberately shared across the whole deployment rather than owned by a
-- workspace. Inventing a `workspace_id` here to make the policy look stricter
-- would be inventing a dimension the data does not have, and would silently
-- hide rows from the discovery UI the moment it was backfilled imperfectly.
--
-- What changes is the thing that was actually broken: `anon` loses access.
--
-- PRIVILEGES ARE THE MINIMUM THE APP ACTUALLY USES, checked call site by call
-- site rather than assumed. Six paths reach this table on the RLS-subject
-- user-session client:
--
--   src/app/api/discovery/shops/route.ts                 select
--   src/app/api/discovery/stats/route.ts                 select
--   src/app/api/routes/[routeId]/stop-search/route.ts    select
--   src/app/api/routes/[routeId]/stops/route.ts          select
--   src/app/api/routes/[routeId]/stops/[stopId]/route.ts select, update
--   src/lib/discovery/promote.ts                         select, update
--     (reached from the visit route, which uses the user-session client)
--   src/components/companies/company-detail-client.tsx   select (in-browser)
--
-- No user-session path inserts or deletes, so `authenticated` is granted
-- neither. Every import, promote-bulk, skip and verify-email path uses the
-- service role, which bypasses RLS entirely and is unaffected.
--
-- R3, ADDITIVE AND BACKWARD COMPATIBLE: a deployment one release behind reads
-- this table either as `authenticated` (allowed by the policy below) or as the
-- service role (bypasses RLS). Neither breaks. Nothing is dropped, renamed,
-- retyped or narrowed. The only caller that loses access is `anon`, and no
-- release of this app has ever legitimately read this table as `anon`.

alter table public.discovered_shops enable row level security;

drop policy if exists "discovered_shops_authenticated_select" on public.discovered_shops;
create policy "discovered_shops_authenticated_select"
  on public.discovered_shops
  for select
  to authenticated
  using (true);

drop policy if exists "discovered_shops_authenticated_update" on public.discovered_shops;
create policy "discovered_shops_authenticated_update"
  on public.discovered_shops
  for update
  to authenticated
  using (true)
  with check (true);

comment on table public.discovered_shops is
  'Scrape staging for prospect discovery. Deployment-wide, not workspace-scoped: this product is one database per customer, so the database is the tenant boundary. RLS restricts it to signed-in users; the anon/publishable key must never read it (issue #747).';


-- THE OTHER THREE, which the issue asks to review at the same time.
--
-- All three were anon-readable by the same mechanism, confirmed by the same
-- probe: HTTP 200 with a publishable key and no session. None of them is
-- touched by any user-session path — every read and write goes through the
-- service role:
--
--   dashboard_domain_health_checks  src/lib/ceo/data/domain-health.ts:26
--                                   src/app/api/cron/domain-health/route.ts:56
--   dashboard_cta_clicks            src/lib/ceo/data/cta-clicks.ts:253
--   _ops_queue_pause_2026_04_28     scripts only, a one-off ops snapshot
--
-- So they get RLS with NO policy, which is the strictest correct setting and
-- the one this schema already uses for `tenant_config_cache`: the service role
-- bypasses RLS and keeps working, and a leaked publishable key reads nothing.
--
-- `_ops_queue_pause_2026_04_28` carries contact_id and queue_id for real
-- contacts, so it is not merely an ops table in the harmless sense.

alter table public._ops_queue_pause_2026_04_28 enable row level security;
alter table public.dashboard_cta_clicks enable row level security;
alter table public.dashboard_domain_health_checks enable row level security;

comment on table public.dashboard_cta_clicks is
  'GA4 CTA click rollups. Service role only; RLS on with no policy is deliberate (issue #747).';
comment on table public.dashboard_domain_health_checks is
  'Daily domain-health snapshots. Service role only; RLS on with no policy is deliberate (issue #747).';
comment on table public._ops_queue_pause_2026_04_28 is
  'One-off 2026-04-28 queue-pause snapshot. Service role only; RLS on with no policy is deliberate (issue #747).';

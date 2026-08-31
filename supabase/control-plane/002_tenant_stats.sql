-- Aggregate numbers each tenant reports about itself.
--
-- REPORTED BY THE TENANT, NEVER PULLED FROM IT. The control plane holds no
-- tenant database credentials and must not gain any: one service-role key per
-- tenant would be a single credential that reads every customer's entire CRM,
-- which is exactly the design this system exists to avoid. So the direction of
-- travel is inward only, the tenant authenticates with the same config token it
-- already has, and the control plane keeps no way in.
--
-- COUNTS ONLY. `src/lib/control-plane/stats.ts` holds a closed list of metric
-- keys and rejects anything that is not a non-negative integer, so this column
-- cannot quietly grow a list of contacts. Keep it that way.
--
-- One row per tenant per day, so a trend is available later without storing a
-- row per report. The day is the report's own UTC date; a tenant reporting
-- twice in a day overwrites its earlier row, which is what you want from a
-- gauge rather than a counter.

create table if not exists public.tenant_stats (
  id           bigserial primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  day          date not null,
  reported_at  timestamptz not null default now(),
  metrics      jsonb not null default '{}'::jsonb,
  unique (tenant_id, day)
);

create index if not exists tenant_stats_tenant_day_idx
  on public.tenant_stats (tenant_id, day desc);

alter table public.tenant_stats enable row level security;
-- No policies, deliberately: service role only, like every other table here.

comment on table public.tenant_stats is
  'Aggregate counts reported BY each tenant. Counts only, never rows. See lib/control-plane/stats.ts.';

-- When the control plane last heard from a tenant at all.
--
-- Worth having separately from the stats row: "reported nothing today" and
-- "has not been heard from since Tuesday" are different problems, and only the
-- second one means something is broken.
alter table public.tenants
  add column if not exists last_seen_at timestamptz;

comment on column public.tenants.last_seen_at is
  'Last successful heartbeat. Null means this tenant has never reported, which is normal while provisioning.';

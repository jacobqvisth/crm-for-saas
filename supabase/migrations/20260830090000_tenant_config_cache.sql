-- Layer 2 of the config resolution ladder: the last good config pulled from the
-- control plane, cached in this tenant's own database.
--
-- Why the database and not memory: the failure being guarded against is a cold
-- start during a control-plane outage. A fresh serverless instance has no
-- memory to fall back on and would drop straight to compiled defaults, silently
-- ignoring every override an administrator had set. A row survives that.
--
-- One row, id = 1. There is exactly one tenant per database, so a tenant column
-- here would invent a dimension that does not exist.
--
-- ADDITIVE ONLY (R3): this creates a new table and touches nothing existing, so
-- it is safe to apply to a database whose app is one release behind.

create table if not exists public.tenant_config_cache (
  id         smallint primary key default 1 check (id = 1),
  features   jsonb not null default '{}'::jsonb,
  settings   jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),

  constraint tenant_config_cache_singleton check (id = 1)
);

comment on table public.tenant_config_cache is
  'Last good config pulled from the control plane. Read only when the live pull fails. Holds no customer data and no secrets.';

-- Only the service role touches this table, and RLS with no policy is the
-- strictest correct configuration: if a publishable key leaks, it reads nothing.
-- Matching the four intentionally-RLS-disabled tables in this schema was
-- considered and rejected; those are historical, this one is new.
alter table public.tenant_config_cache enable row level security;

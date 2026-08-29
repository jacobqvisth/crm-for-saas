-- Control-plane schema. Applies to the CONTROL-PLANE Supabase project only,
-- never to a tenant database.
--
-- WHAT THIS DATABASE IS FOR
-- -------------------------
-- Which customer exists, which features each one has, and who changed that.
-- That is the whole job.
--
-- WHAT THIS DATABASE MUST NEVER CONTAIN
-- -------------------------------------
--   - customer data of any kind: no contacts, companies, emails, calls, deals
--   - tenant service-role keys, database passwords or OAuth secrets
--
-- The reason is the entire point of the phase 04 design. The obvious build for
-- an admin console is one that holds every tenant's service-role key and writes
-- flags straight into each database. Service-role keys bypass RLS, so that
-- console becomes a single credential that can read every contact, every email
-- and every deal of every customer. One leaked environment variable and the
-- whole book is open.
--
-- Instead the console never reaches into a tenant. Tenants PULL their own
-- config using a token scoped to themselves (phase 05). If this database is
-- compromised, the attacker can toggle features. They cannot read a single row
-- of anyone's CRM.
--
-- `tenants.supabase_project_ref` is a project REFERENCE, not a credential. It
-- is a public identifier (it appears in every project URL) and is stored for
-- display and as the target list for scripts/migrate-tenants.mjs. Adding a key
-- column to this schema would undo the design; do not.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
create table if not exists public.tenants (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique,
  display_name        text not null,
  status              text not null default 'provisioning'
                        check (status in ('active', 'suspended', 'provisioning')),
  -- Which git branch this tenant's Vercel project builds. Displayed only:
  -- promotion is `git push origin main:stable`, not a button. A console that
  -- pretends to move code from a web page is lying about what it does.
  release_channel     text not null default 'stable'
                        check (release_channel in ('main', 'stable')),
  -- Public project identifier, NOT a credential. See the header.
  supabase_project_ref text,
  app_url             text,
  notes               text,
  created_at          timestamptz not null default now()
);

comment on column public.tenants.supabase_project_ref is
  'Public Supabase project ref, for display and as the migrate-tenants target list. Never a key.';

-- ---------------------------------------------------------------------------
-- features: seeded FROM src/config/features.ts by scripts/seed-control-plane.mjs
-- ---------------------------------------------------------------------------
-- The TypeScript registry stays the single definition of what a feature is.
-- This table is a projection of it so the console can render names and
-- categories without importing app code. Re-running the seed is the way to
-- update it; editing rows by hand puts the two out of step.
create table if not exists public.features (
  key             text primary key,
  name            text not null,
  description     text,
  category        text,
  default_enabled boolean not null default true,
  -- Reserved for features whose removal is destructive enough to warrant a
  -- louder confirmation than the standard one. Nothing sets it yet.
  is_dangerous    boolean not null default false,
  synced_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tenant_features: the overrides
-- ---------------------------------------------------------------------------
-- ABSENT ROW MEANS "use features.default_enabled". That is deliberate: it keeps
-- a new feature automatically on for everyone (ground rule R2) without a
-- backfill, and it means the console can show "inheriting" as a real state
-- rather than pretending every value was chosen.
create table if not exists public.tenant_features (
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled     boolean not null,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  text not null,
  primary key (tenant_id, feature_key)
);

-- ---------------------------------------------------------------------------
-- tenant_settings: non-boolean per-tenant values
-- ---------------------------------------------------------------------------
-- Send caps, cache TTLs, alert thresholds: things worth changing without a
-- deploy. Not secrets. A value here is readable by anyone who can read this
-- database, so it must be as harmless as a feature flag.
create table if not exists public.tenant_settings (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  primary key (tenant_id, key)
);

-- ---------------------------------------------------------------------------
-- tenant_tokens: how a tenant proves it is itself when pulling config
-- ---------------------------------------------------------------------------
-- The HASH is stored, never the token. The plaintext is shown once, at
-- creation, and then exists only in that tenant's environment. A read of this
-- table therefore does not let you impersonate a tenant, and a tenant can only
-- ever read its own row (phase 05 enforces that at the endpoint).
create table if not exists public.tenant_tokens (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  created_by   text not null,
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists tenant_tokens_tenant_idx
  on public.tenant_tokens (tenant_id) where revoked_at is null;

comment on column public.tenant_tokens.token_hash is
  'SHA-256 of the token. The plaintext is shown once at creation and never stored.';

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
-- Every write through the console appends here. Non-negotiable: this is a page
-- that can turn a paying customer's features off. With one admin it looks like
-- ceremony; it is exactly what you want the first day there are two.
create table if not exists public.audit_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  actor     text not null,
  tenant_id uuid references public.tenants(id) on delete set null,
  action    text not null,
  before    jsonb,
  after     jsonb
);

create index if not exists audit_log_tenant_at_idx on public.audit_log (tenant_id, at desc);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

-- ---------------------------------------------------------------------------
-- RLS: deny everything to anon and authenticated.
-- ---------------------------------------------------------------------------
-- Every one of these tables is reached only by the console's server code using
-- the service role, which bypasses RLS. No browser client ever queries this
-- database directly. Enabling RLS with NO policies is therefore the correct
-- and strictest configuration: if a publishable key ever leaks, it can read
-- nothing.
--
-- This is the opposite of the tenant databases, where RLS exists to separate
-- workspaces from each other. Here it exists to keep everyone out.
alter table public.tenants          enable row level security;
alter table public.features         enable row level security;
alter table public.tenant_features  enable row level security;
alter table public.tenant_settings  enable row level security;
alter table public.tenant_tokens    enable row level security;
alter table public.audit_log        enable row level security;

create extension if not exists "pgcrypto";

create table if not exists public.dashboard_source_accounts (
  source_key text primary key,
  account_id text,
  display_name text not null,
  status text not null default 'pending',
  last_success_at timestamptz,
  watermark timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dashboard_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  rows_read integer not null default 0,
  rows_written integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists dashboard_sync_runs_source_started_idx
  on public.dashboard_sync_runs (source_key, started_at desc);

create table if not exists public.dashboard_raw_metric_rows (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  external_id text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  payload jsonb not null,
  collected_at timestamptz not null default now(),
  unique (source_key, external_id, period_start)
);

create table if not exists public.dashboard_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  metric_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  dimension_key text not null default 'total',
  dimensions jsonb not null default '{}'::jsonb,
  value numeric not null,
  unit text not null default 'count',
  currency text,
  collected_at timestamptz not null default now(),
  unique (source_key, metric_key, period_start, period_end, dimension_key)
);

create index if not exists dashboard_metric_snapshots_metric_period_idx
  on public.dashboard_metric_snapshots (metric_key, period_start desc);

create table if not exists public.dashboard_funnel_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  step_key text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  dimension_key text not null default 'total',
  dimensions jsonb not null default '{}'::jsonb,
  count numeric not null,
  collected_at timestamptz not null default now(),
  unique (source_key, step_key, period_start, period_end, dimension_key)
);

create index if not exists dashboard_funnel_snapshots_step_period_idx
  on public.dashboard_funnel_snapshots (step_key, period_start desc);

create table if not exists public.dashboard_users (
  internal_user_id text primary key,
  workshop_id text,
  email_hash text,
  customer_io_id text,
  ga_client_id text,
  created_at timestamptz,
  last_seen_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.dashboard_workshops (
  workshop_id text primary key,
  name text,
  owner_internal_user_id text references public.dashboard_users(internal_user_id),
  country text,
  plan_key text,
  activated_at timestamptz,
  created_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.dashboard_subscriptions (
  stripe_subscription_id text primary key,
  workshop_id text references public.dashboard_workshops(workshop_id),
  stripe_customer_id text,
  status text not null,
  plan_key text,
  mrr_amount_cents integer not null default 0,
  currency text not null default 'usd',
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at timestamptz,
  canceled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_source_accounts enable row level security;
alter table public.dashboard_sync_runs enable row level security;
alter table public.dashboard_raw_metric_rows enable row level security;
alter table public.dashboard_metric_snapshots enable row level security;
alter table public.dashboard_funnel_snapshots enable row level security;
alter table public.dashboard_users enable row level security;
alter table public.dashboard_workshops enable row level security;
alter table public.dashboard_subscriptions enable row level security;

create policy "authenticated can read source accounts"
  on public.dashboard_source_accounts for select
  to authenticated
  using (true);

create policy "authenticated can read sync runs"
  on public.dashboard_sync_runs for select
  to authenticated
  using (true);

create policy "authenticated can read raw metric rows"
  on public.dashboard_raw_metric_rows for select
  to authenticated
  using (true);

create policy "authenticated can read metric snapshots"
  on public.dashboard_metric_snapshots for select
  to authenticated
  using (true);

create policy "authenticated can read funnel snapshots"
  on public.dashboard_funnel_snapshots for select
  to authenticated
  using (true);

create policy "authenticated can read users"
  on public.dashboard_users for select
  to authenticated
  using (true);

create policy "authenticated can read workshops"
  on public.dashboard_workshops for select
  to authenticated
  using (true);

create policy "authenticated can read subscriptions"
  on public.dashboard_subscriptions for select
  to authenticated
  using (true);

insert into public.dashboard_source_accounts (source_key, display_name, status)
values
  ('ga4', 'GA4 / Firebase', 'pending'),
  ('google_ads', 'Google Ads', 'pending'),
  ('customer_io', 'Customer.io', 'pending'),
  ('stripe', 'Stripe', 'pending'),
  ('app_store_connect', 'App Store Connect', 'pending')
on conflict (source_key) do nothing;
create table if not exists public.dashboard_diagnostics (
  diagnostic_id text primary key,
  workshop_id text,
  internal_user_id text,
  parent_diagnostic_id text,
  status text,
  created_at timestamptz,
  completed_at timestamptz,
  analyzed_at timestamptz,
  ai_model text,
  diag_cost numeric not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  num_causes integer not null default 0,
  has_chat boolean not null default false,
  has_invoice boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_diagnostics_workshop_created_idx
  on public.dashboard_diagnostics (workshop_id, created_at desc);

create index if not exists dashboard_diagnostics_user_created_idx
  on public.dashboard_diagnostics (internal_user_id, created_at desc);

create table if not exists public.dashboard_diagnostic_chats (
  chat_id text primary key,
  diagnostic_id text,
  workshop_id text,
  internal_user_id text,
  created_at timestamptz,
  updated_at timestamptz,
  message_count integer not null default 0,
  chat_cost numeric not null default 0,
  total_input_tokens integer not null default 0,
  total_output_tokens integer not null default 0,
  total_thinking_tokens integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists dashboard_diagnostic_chats_workshop_created_idx
  on public.dashboard_diagnostic_chats (workshop_id, created_at desc);

create index if not exists dashboard_diagnostic_chats_diagnostic_idx
  on public.dashboard_diagnostic_chats (diagnostic_id);

create table if not exists public.dashboard_motor_usage (
  motor_usage_id text primary key,
  month date,
  database_name text,
  total_accesses integer not null default 0,
  unique_users integer not null default 0,
  unique_vehicles integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists dashboard_motor_usage_month_idx
  on public.dashboard_motor_usage (month desc);

create table if not exists public.dashboard_cost_entries (
  cost_entry_id text primary key,
  section text not null,
  item_key text not null,
  amount numeric not null default 0,
  unit text not null default 'count',
  snapshot_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists dashboard_cost_entries_snapshot_idx
  on public.dashboard_cost_entries (snapshot_at desc, section);

alter table public.dashboard_diagnostics enable row level security;
alter table public.dashboard_diagnostic_chats enable row level security;
alter table public.dashboard_motor_usage enable row level security;
alter table public.dashboard_cost_entries enable row level security;

create policy "authenticated can read diagnostics"
  on public.dashboard_diagnostics for select
  to authenticated
  using (true);

create policy "authenticated can read diagnostic chats"
  on public.dashboard_diagnostic_chats for select
  to authenticated
  using (true);

create policy "authenticated can read motor usage"
  on public.dashboard_motor_usage for select
  to authenticated
  using (true);

create policy "authenticated can read cost entries"
  on public.dashboard_cost_entries for select
  to authenticated
  using (true);

insert into public.dashboard_source_accounts (source_key, display_name, status)
values ('core_app', 'Core App Data', 'pending')
on conflict (source_key) do nothing;
insert into public.dashboard_source_accounts (source_key, display_name, status)
values ('search_console', 'Search Console', 'pending')
on conflict (source_key) do nothing;
-- Extended user_stats.json.gz fields released by the core-app team.
--
-- User-level adds: name, phone, core_stripe_customer_id (so we can join
-- dashboard_users -> dashboard_subscriptions by Stripe ID instead of the
-- lossy email-hash fallback).
--
-- Workshop-level adds: language, payment_status, trial_end,
-- created_by_agent (self-service vs sales-touched), core_subscription_status
-- (from the core app for billing-state drift checks against Stripe), plus
-- core_stripe_customer_id / core_stripe_subscription_id for ID-based joins.
--
-- All new columns are nullable. The "core_" prefix on Stripe-derived
-- columns marks them as the core_app first-party copy, distinct from the
-- Stripe-source-of-truth row in dashboard_subscriptions.

alter table public.dashboard_users
  add column if not exists name text,
  add column if not exists phone text,
  add column if not exists core_stripe_customer_id text;

create index if not exists dashboard_users_core_stripe_customer_idx
  on public.dashboard_users (core_stripe_customer_id)
  where core_stripe_customer_id is not null;

alter table public.dashboard_workshops
  add column if not exists language text,
  add column if not exists core_subscription_status text,
  add column if not exists payment_status text,
  add column if not exists trial_end timestamptz,
  add column if not exists created_by_agent boolean,
  add column if not exists core_stripe_customer_id text,
  add column if not exists core_stripe_subscription_id text;

create index if not exists dashboard_workshops_core_stripe_customer_idx
  on public.dashboard_workshops (core_stripe_customer_id)
  where core_stripe_customer_id is not null;

create index if not exists dashboard_workshops_core_stripe_subscription_idx
  on public.dashboard_workshops (core_stripe_subscription_id)
  where core_stripe_subscription_id is not null;

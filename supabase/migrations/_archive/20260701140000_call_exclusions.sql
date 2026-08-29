-- Managed "never call" list for the Call Planner. A workspace can exclude a
-- whole domain, a specific email, or a company from the call-list candidate
-- pool (e.g. chains a rep is working as a direct deal, our own team, or
-- accounts we simply never cold-call). Applied always-on when building
-- "Today's top contacts" — see src/app/api/calls/planner/route.ts.
create table if not exists public.call_exclusions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind         text not null check (kind in ('domain', 'email', 'company')),
  -- domain: bare domain (lowercased); email: full address (lowercased);
  -- company: the company_id (uuid as text).
  value        text not null,
  -- human-readable label for the UI (company name, or same as value).
  label        text,
  created_at   timestamptz not null default now(),
  -- Values are normalised (domains/emails lowercased) before insert, so a plain
  -- unique constraint gives case-insensitive dedup and lets PostgREST upsert
  -- target it via on_conflict.
  constraint call_exclusions_uniq unique (workspace_id, kind, value)
);

create index if not exists call_exclusions_workspace_idx
  on public.call_exclusions (workspace_id);

alter table public.call_exclusions enable row level security;

drop policy if exists "workspace members manage call exclusions" on public.call_exclusions;
create policy "workspace members manage call exclusions"
  on public.call_exclusions
  for all
  using (workspace_id in (select get_user_workspace_ids()))
  with check (workspace_id in (select get_user_workspace_ids()));

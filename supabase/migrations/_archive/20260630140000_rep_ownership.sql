-- Rep ownership: track which sales rep (Hans, Jacob, …) owns each contact/company.
--
-- Primary rep = whoever had the most recent contact; Secondary = next most-recent
-- distinct rep. Auto-assigned by default (owner_auto = true); can be locked to a
-- specific rep by toggling owner_auto = false and setting the ids manually.
--
-- A "rep touch" is any meaningful outbound/inbound contact with the person:
--   email_sent / email_received  -> rep resolved via the sending gmail account
--   call / meeting / note / field_visit -> rep = activities.user_id (the actor)
-- See rep_touches below for the attribution rules.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.contacts
  add column if not exists primary_owner_id     uuid,
  add column if not exists secondary_owner_id   uuid,
  add column if not exists owner_auto           boolean not null default true,
  add column if not exists owner_updated_at     timestamptz,
  add column if not exists primary_owner_source text;

alter table public.companies
  add column if not exists primary_owner_id     uuid,
  add column if not exists secondary_owner_id   uuid,
  add column if not exists owner_auto           boolean not null default true,
  add column if not exists owner_updated_at     timestamptz,
  add column if not exists primary_owner_source text;

comment on column public.contacts.owner_auto is
  'When true, primary/secondary owner are auto-assigned by most-recent contact. When false, the assignment is locked to whatever was set manually.';
comment on column public.companies.owner_auto is
  'When true, primary/secondary owner are auto-assigned by most-recent contact. When false, the assignment is locked to whatever was set manually.';

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- Cast text -> uuid without raising on malformed values (metadata is free-form).
create or replace function public.safe_uuid(t text)
returns uuid
language plpgsql
immutable
as $$
begin
  return t::uuid;
exception when others then
  return null;
end;
$$;

-- Rep identity: one person may connect several Gmail accounts under different
-- auth users (e.g. Hans has 2 user_ids, Magnus 4). Collapse them to a single
-- canonical user_id per person (matched on display name, then email), so a rep
-- is one human — not one mailbox. Canonical = the person's earliest account.
create or replace view public.rep_identity as
select distinct
  ga.user_id,
  first_value(ga.user_id) over (
    partition by lower(coalesce(nullif(btrim(ga.display_name), ''), ga.email_address))
    order by ga.created_at, ga.id
  ) as canonical_user_id
from public.gmail_accounts ga
where ga.user_id is not null;

-- Unified attribution: one row per activity that counts as a rep "touch",
-- with the resolved (canonical) rep and when it happened.
create or replace view public.rep_touches as
select
  raw.activity_id,
  raw.workspace_id,
  raw.contact_id,
  raw.company_id,
  raw.touched_at,
  raw.type,
  coalesce(ri.canonical_user_id, raw.rep_user_id) as rep_user_id
from (
  select
    a.id           as activity_id,
    a.workspace_id,
    a.contact_id,
    a.company_id,
    a.created_at   as touched_at,
    a.type,
    case
      when a.type in ('call', 'meeting', 'note', 'field_visit') then a.user_id
      when a.type in ('email_sent', 'email_received') then (
        select ga.user_id
        from public.gmail_accounts ga
        where ga.id = coalesce(
          public.safe_uuid(a.metadata->>'sender_account_id'),
          (
            select eq.sender_account_id
            from public.email_queue eq
            where eq.id = public.safe_uuid(a.metadata->>'email_queue_id')
          )
        )
      )
      else null
    end as rep_user_id
  from public.activities a
  where a.type in ('email_sent', 'email_received', 'call', 'meeting', 'note', 'field_visit')
) raw
left join public.rep_identity ri on ri.user_id = raw.rep_user_id;

-- ---------------------------------------------------------------------------
-- 3. Recompute functions (used by triggers + the "switch back to auto" action)
-- ---------------------------------------------------------------------------

create or replace function public.recompute_contact_owner(p_contact_id uuid)
returns void
language plpgsql
as $$
declare
  v_auto      boolean;
  v_primary   uuid;
  v_secondary uuid;
  v_source    text;
  v_touched   timestamptz;
begin
  select owner_auto into v_auto from public.contacts where id = p_contact_id;
  if v_auto is distinct from true then
    return; -- locked: never auto-overwrite a manual assignment
  end if;

  with ranked as (
    select
      rep_user_id,
      max(touched_at) as last_touch,
      (array_agg(type order by touched_at desc))[1] as last_type
    from public.rep_touches
    where contact_id = p_contact_id and rep_user_id is not null
    group by rep_user_id
    order by max(touched_at) desc
  )
  select
    (select rep_user_id from ranked offset 0 limit 1),
    (select rep_user_id from ranked offset 1 limit 1),
    (select last_type   from ranked offset 0 limit 1),
    (select last_touch  from ranked offset 0 limit 1)
  into v_primary, v_secondary, v_source, v_touched;

  update public.contacts c
  set
    primary_owner_id     = v_primary,
    secondary_owner_id   = v_secondary,
    primary_owner_source = v_source,
    owner_updated_at     = case
      when c.primary_owner_id is distinct from v_primary
        or c.secondary_owner_id is distinct from v_secondary
      then coalesce(v_touched, now())
      else c.owner_updated_at
    end
  where c.id = p_contact_id;
end;
$$;

create or replace function public.recompute_company_owner(p_company_id uuid)
returns void
language plpgsql
as $$
declare
  v_auto      boolean;
  v_primary   uuid;
  v_secondary uuid;
  v_source    text;
  v_touched   timestamptz;
begin
  select owner_auto into v_auto from public.companies where id = p_company_id;
  if v_auto is distinct from true then
    return;
  end if;

  -- Company touches = activities on the company itself + activities on any of
  -- its contacts.
  with touches as (
    select rt.rep_user_id, rt.touched_at, rt.type
    from public.rep_touches rt
    left join public.contacts c on c.id = rt.contact_id
    where rt.rep_user_id is not null
      and (rt.company_id = p_company_id or c.company_id = p_company_id)
  ),
  ranked as (
    select
      rep_user_id,
      max(touched_at) as last_touch,
      (array_agg(type order by touched_at desc))[1] as last_type
    from touches
    group by rep_user_id
    order by max(touched_at) desc
  )
  select
    (select rep_user_id from ranked offset 0 limit 1),
    (select rep_user_id from ranked offset 1 limit 1),
    (select last_type   from ranked offset 0 limit 1),
    (select last_touch  from ranked offset 0 limit 1)
  into v_primary, v_secondary, v_source, v_touched;

  update public.companies co
  set
    primary_owner_id     = v_primary,
    secondary_owner_id   = v_secondary,
    primary_owner_source = v_source,
    owner_updated_at     = case
      when co.primary_owner_id is distinct from v_primary
        or co.secondary_owner_id is distinct from v_secondary
      then coalesce(v_touched, now())
      else co.owner_updated_at
    end
  where co.id = p_company_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Trigger: recompute owners whenever a new activity lands
-- ---------------------------------------------------------------------------
-- Calls log a 'call' activity (carrying user_id), so a single trigger on
-- activities covers calls too — no separate call_sessions trigger needed.

create or replace function public.trg_recompute_owner_from_activity()
returns trigger
language plpgsql
as $$
declare
  v_company uuid;
begin
  if new.contact_id is not null then
    perform public.recompute_contact_owner(new.contact_id);
    select company_id into v_company from public.contacts where id = new.contact_id;
    if v_company is not null then
      perform public.recompute_company_owner(v_company);
    end if;
  end if;

  if new.company_id is not null and new.company_id is distinct from v_company then
    perform public.recompute_company_owner(new.company_id);
  end if;

  return null;
end;
$$;

drop trigger if exists activities_recompute_owner on public.activities;
create trigger activities_recompute_owner
  after insert on public.activities
  for each row
  execute function public.trg_recompute_owner_from_activity();

-- ---------------------------------------------------------------------------
-- 5. One-time backfill (set-based, respects owner_auto)
-- ---------------------------------------------------------------------------

-- Contacts
with ranked as (
  select
    contact_id,
    rep_user_id,
    max(touched_at) as last_touch,
    (array_agg(type order by touched_at desc))[1] as last_type,
    row_number() over (partition by contact_id order by max(touched_at) desc) as rn
  from public.rep_touches
  where contact_id is not null and rep_user_id is not null
  group by contact_id, rep_user_id
),
agg as (
  select
    contact_id,
    (array_agg(rep_user_id) filter (where rn = 1))[1] as primary_id,
    (array_agg(rep_user_id) filter (where rn = 2))[1] as secondary_id,
    max(last_type)   filter (where rn = 1) as src,
    max(last_touch)  filter (where rn = 1) as lt
  from ranked
  group by contact_id
)
update public.contacts c
set
  primary_owner_id     = agg.primary_id,
  secondary_owner_id   = agg.secondary_id,
  primary_owner_source = agg.src,
  owner_updated_at     = agg.lt
from agg
where agg.contact_id = c.id and c.owner_auto = true;

-- Companies (own touches + their contacts' touches)
with company_touches as (
  select
    coalesce(rt.company_id, c.company_id) as company_id,
    rt.rep_user_id,
    rt.touched_at,
    rt.type
  from public.rep_touches rt
  left join public.contacts c on c.id = rt.contact_id
  where rt.rep_user_id is not null
    and coalesce(rt.company_id, c.company_id) is not null
),
ranked as (
  select
    company_id,
    rep_user_id,
    max(touched_at) as last_touch,
    (array_agg(type order by touched_at desc))[1] as last_type,
    row_number() over (partition by company_id order by max(touched_at) desc) as rn
  from company_touches
  group by company_id, rep_user_id
),
agg as (
  select
    company_id,
    (array_agg(rep_user_id) filter (where rn = 1))[1] as primary_id,
    (array_agg(rep_user_id) filter (where rn = 2))[1] as secondary_id,
    max(last_type)   filter (where rn = 1) as src,
    max(last_touch)  filter (where rn = 1) as lt
  from ranked
  group by company_id
)
update public.companies co
set
  primary_owner_id     = agg.primary_id,
  secondary_owner_id   = agg.secondary_id,
  primary_owner_source = agg.src,
  owner_updated_at     = agg.lt
from agg
where agg.company_id = co.id and co.owner_auto = true;

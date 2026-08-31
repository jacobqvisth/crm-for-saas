-- Per-channel recency columns on contacts, so list filters can ask
-- "called in the last N days" / "emailed in the last N days" without a join.
--
-- Why columns and not a query-time join: PostgREST can't express
-- "max(activities.created_at) where type='call'" as a filter on `contacts`,
-- and materialising the id set client-side runs into the .in() URL-length
-- ceiling (see resolveExcludedContactIds). Dynamic lists resolve through
-- buildFilterQuery, which is a single contacts query — a denormalised column
-- is the only shape that fits it.
--
-- `last_contacted_at` already exists but is ambiguous: logCall bumps it AND
-- reply-matching bumps it, so it means "last touch of any kind". It is left
-- alone for back-compat; the two new columns are the unambiguous ones.

alter table public.contacts
  add column if not exists last_called_at timestamptz,
  add column if not exists last_replied_at timestamptz;

comment on column public.contacts.last_called_at is
  'Max created_at of activities(type=call) for this contact. Maintained by trg_bump_contact_recency.';
comment on column public.contacts.last_replied_at is
  'Max created_at of activities(type=email_received) for this contact. Maintained by trg_bump_contact_recency.';

create index if not exists idx_contacts_last_called_at
  on public.contacts (workspace_id, last_called_at desc nulls last);
create index if not exists idx_contacts_last_replied_at
  on public.contacts (workspace_id, last_replied_at desc nulls last);
create index if not exists idx_contacts_last_emailed_at
  on public.contacts (workspace_id, last_emailed_at desc nulls last);

-- Keep the columns fresh. Sibling of activities_recompute_owner: every call /
-- sent email / reply already lands as an activity row via insertActivity, so
-- one trigger covers all of logCall, the 46elks pipeline, the call agent, the
-- send cron, check-replies and mailbox-sync at once.
--
-- `greatest` + coalesce means a backdated activity (imports pass an explicit
-- created_at) can never move a recency column backwards.
create or replace function public.trg_bump_contact_recency()
returns trigger
language plpgsql
as $$
declare
  ts timestamptz := coalesce(new.created_at, now());
begin
  if new.contact_id is null then
    return new;
  end if;

  if new.type = 'call' then
    update public.contacts
       set last_called_at = greatest(coalesce(last_called_at, ts), ts)
     where id = new.contact_id
       and (last_called_at is null or last_called_at < ts);
  elsif new.type = 'email_sent' then
    update public.contacts
       set last_emailed_at = greatest(coalesce(last_emailed_at, ts), ts)
     where id = new.contact_id
       and (last_emailed_at is null or last_emailed_at < ts);
  elsif new.type = 'email_received' then
    update public.contacts
       set last_replied_at = greatest(coalesce(last_replied_at, ts), ts)
     where id = new.contact_id
       and (last_replied_at is null or last_replied_at < ts);
  end if;

  return new;
end;
$$;

drop trigger if exists activities_bump_contact_recency on public.activities;
create trigger activities_bump_contact_recency
  after insert on public.activities
  for each row execute function public.trg_bump_contact_recency();

-- Backfill from the activity history.
update public.contacts c
   set last_called_at = a.ts
  from (
    select contact_id, max(created_at) as ts
      from public.activities
     where type = 'call' and contact_id is not null
     group by contact_id
  ) a
 where a.contact_id = c.id
   and (c.last_called_at is null or c.last_called_at < a.ts);

update public.contacts c
   set last_replied_at = a.ts
  from (
    select contact_id, max(created_at) as ts
      from public.activities
     where type = 'email_received' and contact_id is not null
     group by contact_id
  ) a
 where a.contact_id = c.id
   and (c.last_replied_at is null or c.last_replied_at < a.ts);

-- last_emailed_at was only ever written by the send path, so contacts whose
-- sends predate that code (or failed the update) have activity rows but a null
-- column. Heal them from history too.
update public.contacts c
   set last_emailed_at = a.ts
  from (
    select contact_id, max(created_at) as ts
      from public.activities
     where type = 'email_sent' and contact_id is not null
     group by contact_id
  ) a
 where a.contact_id = c.id
   and (c.last_emailed_at is null or c.last_emailed_at < a.ts);

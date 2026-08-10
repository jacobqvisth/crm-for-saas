-- Engaged prospects for the Call Planner.
--
-- Replaces the "Hot lead: opened 3 times" task generator, which fired on the
-- open count of a single tracking_id rather than on a contact's actual
-- engagement. That made selection close to arbitrary: 1,209 contacts had 3+
-- opens across their emails, but only 221 ever got a task, and exactly 1 of
-- those was ever called.
--
-- Aggregating in Postgres rather than in the route is deliberate. There are
-- ~9.2k open/click rows, well over PostgREST's 1000-row db-max-rows ceiling,
-- so reading them into the route would silently truncate (the same class of
-- bug as PR #217). This returns one already-filtered row per contact, joined
-- to the contact fields the planner needs, which also avoids passing ~1000
-- uuids back through a `.in()` URL.

create or replace function public.get_engaged_prospects(
  p_workspace_id uuid,
  p_min_opens int default 3,
  p_min_clicks int default 0,
  p_since timestamptz default null,
  p_limit int default 1000
)
returns table (
  contact_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  company_id uuid,
  company_name text,
  lead_status text,
  country_code text,
  primary_owner_id uuid,
  last_contacted_at timestamptz,
  opens bigint,
  clicks bigint,
  emails_opened bigint,
  first_engaged_at timestamptz,
  last_engaged_at timestamptz,
  last_clicked_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $function$
begin
  -- SECURITY DEFINER bypasses RLS, so verify membership for real user calls.
  -- auth.uid() is null for the service role, which is left free to read.
  if auth.uid() is not null
     and p_workspace_id not in (select get_user_workspace_ids()) then
    raise exception 'not a member of workspace %', p_workspace_id
      using errcode = '42501';
  end if;

  return query
  with engagement as (
    select
      q.contact_id as cid,
      count(*) filter (where e.event_type = 'open') as n_opens,
      count(*) filter (where e.event_type = 'click') as n_clicks,
      count(distinct q.id) filter (where e.event_type = 'open') as n_emails_opened,
      min(e.created_at) as first_at,
      max(e.created_at) as last_at,
      max(e.created_at) filter (where e.event_type = 'click') as last_click_at
    from email_queue q
    join email_events e on e.email_queue_id = q.id
    where q.workspace_id = p_workspace_id
      and q.contact_id is not null
      and e.event_type in ('open', 'click')
    group by q.contact_id
  )
  select
    c.id,
    c.first_name::text,
    c.last_name::text,
    c.email::text,
    c.phone::text,
    c.company_id,
    co.name::text,
    c.lead_status::text,
    c.country_code::text,
    c.primary_owner_id,
    c.last_contacted_at,
    g.n_opens,
    g.n_clicks,
    g.n_emails_opened,
    g.first_at,
    g.last_at,
    g.last_click_at
  from engagement g
  join contacts c on c.id = g.cid
  left join companies co on co.id = c.company_id
  where c.workspace_id = p_workspace_id
    -- Never call someone who opted out or whose address is dead.
    and c.status = 'active'
    -- Prospects only. Existing app users are covered by the app-usage scorer.
    and c.wl_user_id is null
    and g.n_opens >= p_min_opens
    and g.n_clicks >= p_min_clicks
    and (p_since is null or g.last_at >= p_since)
  -- Clicks first: a click is a far stronger buying signal than an open, which
  -- privacy proxies inflate. Recency breaks ties.
  order by g.n_clicks desc, g.last_at desc, g.n_opens desc, c.id
  limit p_limit;
end;
$function$;

comment on function public.get_engaged_prospects is
  'Per-contact email engagement for non-app-user prospects, filtered to an engagement bar. Backs the Call Planner engaged_prospect playbook.';

revoke all on function public.get_engaged_prospects(uuid, int, int, timestamptz, int) from public;
grant execute on function public.get_engaged_prospects(uuid, int, int, timestamptz, int) to authenticated, service_role;

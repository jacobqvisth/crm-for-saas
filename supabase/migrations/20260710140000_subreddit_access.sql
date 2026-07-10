-- Cache of each subreddit's posting access, so the Forums UI can warn "you must
-- be an approved member" before you try to post. Populated on demand by
-- /api/forums/subreddit-access (POST), which runs the Apify community scrape and
-- classifies: a readable community page => 'open'; a login/join wall (the
-- scraper only sees the generic "Reddit - The heart of the internet" shell) =>
-- 'members_only'; a failed/transient scrape => 'unknown' (never overwrites a
-- previously known value with a false negative).
--
-- Global reference data (not workspace-scoped), matching the shared forum board:
-- any authenticated CRM user can read and refresh it.

create table if not exists subreddit_access (
  subreddit  text primary key,               -- lowercased, no "r/"
  access     text not null default 'unknown'
             check (access in ('open', 'members_only', 'unknown')),
  title      text,                            -- community title seen during the check
  checked_at timestamptz not null default now()
);

alter table subreddit_access enable row level security;

drop policy if exists "subreddit_access select" on subreddit_access;
create policy "subreddit_access select" on subreddit_access
  for select to authenticated using (true);

drop policy if exists "subreddit_access insert" on subreddit_access;
create policy "subreddit_access insert" on subreddit_access
  for insert to authenticated with check (true);

drop policy if exists "subreddit_access update" on subreddit_access;
create policy "subreddit_access update" on subreddit_access
  for update to authenticated using (true) with check (true);

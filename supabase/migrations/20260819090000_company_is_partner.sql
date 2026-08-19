-- Partner companies: companies we already work with / have partnerships with.
-- They stay in the CRM (contacts, activities, reporting) but can be excluded
-- from outreach list-building via the "partners" exclusion group
-- (src/lib/lists/exclusions.ts) and managed on /settings/partners.
alter table public.companies
  add column if not exists is_partner boolean not null default false;

-- Partner sets are read per-workspace on every list resolution / planner load;
-- keep the lookup cheap without indexing the ~100% false rows.
create index if not exists companies_is_partner_idx
  on public.companies (workspace_id)
  where is_partner;

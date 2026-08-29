-- Register the GA4 per-user attribution report as its own dashboard source.
--
-- Separate from `ga4` (aggregate traffic metrics): this one pulls the
-- user-scoped firstUser* dimensions keyed on customUser:crm_user_id and
-- upserts dashboard_user_attribution. `source_key` is plain text with no
-- CHECK constraint, so no DDL is needed for the new key - this only seeds
-- the account row the sources page reads for status.

insert into public.dashboard_source_accounts (source_key, display_name, status)
values ('ga4_attribution', 'GA4 User Attribution', 'pending')
on conflict (source_key) do nothing;

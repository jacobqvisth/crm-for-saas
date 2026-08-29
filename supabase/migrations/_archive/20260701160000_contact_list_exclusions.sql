-- Per-list exclusion sets. A contact list (calling or email) can subtract
-- contacts that belong to one or more exclusion "sources" at resolution time,
-- WITHOUT baking them into the stored filters. Two built-in group keys plus an
-- arbitrary set of other lists to subtract:
--
--   {
--     "groups": ["never_call", "internal_testers"],
--     "lists":  ["<contact_list uuid>", ...]
--   }
--
--   never_call        -> the managed call_exclusions list (domains/emails/companies)
--   internal_testers  -> the internal-test users/workshops used to exclude from stats
--   lists[]           -> subtract the members of these other contact lists
--                        (e.g. a "Hans – private deals" list)
--
-- Resolution lives in src/lib/lists/exclusions.ts and is applied by
-- resolveListContactIds / the calling worklist / the /api/lists/[id]/resolve
-- endpoint. The "never_call" group is ALSO applied always-on to every calling
-- surface regardless of what is stored here; storing it just makes the choice
-- explicit for non-calling (e.g. email) lists.
--
-- NULL / absent == no exclusions (backwards compatible with existing lists).
alter table public.contact_lists
  add column if not exists exclusions jsonb;

comment on column public.contact_lists.exclusions is
  'Exclusion sources applied at resolution time: {"groups":["never_call","internal_testers"],"lists":["<uuid>"]}. NULL = none.';

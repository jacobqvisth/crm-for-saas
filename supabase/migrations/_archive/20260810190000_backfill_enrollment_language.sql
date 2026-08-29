-- Backfill sequence_enrollments.language for enrollments created before the
-- column existed (PR #635), so a campaign that later turns its languages on
-- picks the right variant per contact instead of sending everyone the master
-- copy.
--
-- Only from contacts.language, the explicit app-sourced signal, normalised the
-- same way normalizeLanguage() does: lowercase, strip a region suffix in
-- either separator, and fold nb/nn onto no. Rows with no known language are
-- left NULL on purpose and resolve to the sequence default at pick time.
--
-- Applied to prod 2026-08-10: 4,217 rows.
update sequence_enrollments e
set language = case
      when split_part(lower(trim(c.language)), '-', 1) in ('nb', 'nn') then 'no'
      else split_part(split_part(lower(trim(c.language)), '-', 1), '_', 1)
    end
from contacts c
where c.id = e.contact_id
  and e.language is null
  and c.language is not null
  and trim(c.language) <> '';

-- Multi-language sequences: one sequence that sends each contact their own
-- language, replacing the "one sequence per language" pattern.
-- See docs/plans/multi-language-sequences.md.

-- Which language a variant is written in. NULL means language-neutral, which
-- is every existing variant, so steps with no tagged variants keep behaving
-- exactly as before. This is what makes the feature backward compatible
-- rather than a migration.
alter table sequence_step_variants add column if not exists language text;

create index if not exists sequence_step_variants_step_language_idx
  on sequence_step_variants (sequence_step_id, language);

comment on column sequence_step_variants.language is
  'ISO 639-1 code this variant is written in. NULL = language-neutral. Variants compete for A/B round-robin only within the same language.';

-- The language resolved for this contact when they enrolled, pinned for the
-- whole sequence. Recomputing per step would let the hourly propagator rewrite
-- contacts.language mid-campaign and send email 1 in English, email 2 in
-- Polish, to the same person.
alter table sequence_enrollments add column if not exists language text;

create index if not exists sequence_enrollments_sequence_language_idx
  on sequence_enrollments (sequence_id, language)
  where language is not null;

comment on column sequence_enrollments.language is
  'Language pinned at enrollment (contacts.language, else country default, else the sequence default). Drives variant selection for every step and is the grouping key for per-language analytics.';

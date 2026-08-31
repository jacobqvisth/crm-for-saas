-- Realign Wrenchlane's migration history with the filenames on `main`.
--
-- WHAT WENT WRONG
-- ---------------
-- Phase 01 reduced `supabase/migrations/` to one honest baseline and rewrote
-- Wrenchlane's history to match, precisely because 129 files and 68 rows shared
-- only two versions. Four migrations added since then were applied with
-- timestamps generated at apply time, while the files on disk carry different
-- prefixes. As of 2026-08-31 the recorded versions matched NO filename:
--
--   recorded            file on main
--   20260831091241  ->  20260831140000_google_ads_asset_performance
--   20260831122837  ->  20260831180000_linkedin_sequence_steps
--   20260831130047  ->  20260831180001_ad_conversion_stats   (renamed, see below)
--   20260831134140  ->  20260831210000_ad_conversion_uploads
--
-- `scripts/migrate-tenants.mjs` compares filenames to recorded versions, so it
-- reported four migrations as PENDING on a database where they are already
-- applied. Running --apply against that would have tried to re-create existing
-- objects; several of those statements are unguarded, so it would have failed
-- part way rather than harmlessly.
--
-- Two files also shared the prefix 20260831180000, and `version` is the PRIMARY
-- KEY of schema_migrations, so both could never be recorded. That is the same
-- duplicate-prefix fault phase 01 found seven of. `ad_conversion_stats` is
-- renamed to ...180001 so it still sorts AFTER linkedin_sequence_steps, which
-- is the order they were really applied in (122837 before 130047).
--
-- SAFE BECAUSE
-- ------------
-- This touches `supabase_migrations.schema_migrations` only. It records which
-- migrations have run; it does not change a single application table. The four
-- new versions do not collide with anything already present.
--
-- Run once, against Wrenchlane. Animech's database is new and gets the correct
-- versions from the start.

begin;

update supabase_migrations.schema_migrations
   set version = case version
     when '20260831091241' then '20260831140000'  -- google_ads_asset_performance
     when '20260831122837' then '20260831180000'  -- linkedin_sequence_steps
     when '20260831130047' then '20260831180001'  -- ad_conversion_stats
     when '20260831134140' then '20260831210000'  -- ad_conversion_uploads
     else version
   end
 where version in (
   '20260831091241', '20260831122837', '20260831130047', '20260831134140'
 );

commit;

-- Afterwards `node scripts/migrate-tenants.mjs --tenant=wrenchlane` must say
-- "nothing to apply". If it still lists migrations, stop: the filenames and the
-- history have diverged again and guessing at it is what caused this.

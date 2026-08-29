-- Phase 01, step 5: make Supabase consider the baseline applied to Wrenchlane
-- WITHOUT re-running it.
--
-- Run this ONCE, against Wrenchlane production, after PR "phase 01: one honest
-- migration baseline" is merged. It touches no schema: the only table it writes
-- is `supabase_migrations.schema_migrations`, which records which migrations ran.
-- Wrenchlane's schema is unchanged by it, which is the point.
--
--   export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
--   export PGPASSWORD="<SUPABASE_DB_PASSWORD from .env.local>"
--   psql -h aws-1-eu-north-1.pooler.supabase.com -p 5432 \
--        -U postgres.wdgiwuhehqpkhpvdzzzl -d postgres \
--        -v ON_ERROR_STOP=1 -f scripts/reconcile-migration-history.sql
--
-- Afterwards, `node scripts/migrate-tenants.mjs` must report
-- "nothing to apply" for wrenchlane. That is the check that this worked.
--
-- WHY IT DELETES RATHER THAN JUST INSERTING
-- -----------------------------------------
-- The obvious version of this script is a single INSERT of the baseline row,
-- leaving the 68 historical rows alone. That does not work. The baseline's
-- version is 00000000000000, which sorts BEFORE every one of those 68 rows, and
-- the Supabase CLI refuses to push when a local migration predates the latest
-- entry in the remote history. Leaving the rows in place would preserve exactly
-- the breakage this phase exists to remove.
--
-- The 68 rows are not lost. Their version and name are recorded in
-- supabase/migrations/_archive/README.md, and the 129 files they partially
-- describe are in supabase/migrations/_archive/. Note that only TWO of the 68
-- versions ever had a matching local file, so these rows were never a usable
-- record of anything in the first place.
--
-- If you want a belt-and-braces copy of all columns before running this:
--
--   pg_dump --data-only --table=supabase_migrations.schema_migrations \
--     --no-owner --no-privileges <connection> > history-backup.sql

\pset pager off

\echo '=== BEFORE ==='
SELECT count(*) AS rows_before FROM supabase_migrations.schema_migrations;

BEGIN;

DELETE FROM supabase_migrations.schema_migrations;

INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('00000000000000', 'baseline');

COMMIT;

\echo '=== AFTER (must be exactly one row: 00000000000000 baseline) ==='
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;

# 01. Squash the migration history into one honest baseline

**Depends on:** nothing. This is first.
**Visible change for Wrenchlane:** none. Not a single byte of schema changes.

## Why this is first

The 128 files in `supabase/migrations/` **do not reproduce the live schema**. Many local
files were never recorded as applied on the remote, and many remote entries have no local
file. `supabase db push --linked` already refuses to run.

With one database that is tolerable debt. With four (three tenants plus the control plane)
it is a blocker, because there is no way to bring a new database up to the current schema
and no way to keep them in step. Every later phase depends on being able to say "apply the
migrations to every tenant" and have it mean something.

## What to do

1. **Dump the live schema.** Get `SUPABASE_DB_PASSWORD` from `.env.local`, or use the
   Management API pattern in the auto-memory reference. Use `libpq` psql, not `node-pg`.

   ```
   pg_dump --schema-only --no-owner --no-privileges \
     --schema=public --schema=storage \
     "$WRENCHLANE_DB_URL" > /tmp/live-schema.sql
   ```

2. **Capture what `pg_dump` misses or mangles.** Verify each of these is present in the
   dump and add it by hand if not:
   - the 9 extensions (`pg_cron`, `pg_net`, `pgcrypto`, `uuid-ossp`, `pg_trgm`, `unaccent`,
     `pg_stat_statements`, `supabase_vault`, `plpgsql`)
   - all 123 RLS policies, and `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on every table
   - all 67 functions, in particular `get_user_workspace_ids()` (SECURITY DEFINER) and
     `update_updated_at`
   - all 53 triggers
   - the 12 views
   - the three storage buckets (`email-images`, `avatars`, `journey-images`) and their policies

   Do **not** carry the `pg_cron` job rows across. See ground rule R6.

3. **Prove it round-trips.** Create a scratch Supabase project, apply the baseline to it,
   dump *that* schema, and diff the two dumps. Iterate until the diff is empty except for
   ordering and generated names. This is the whole value of the phase; do not skip it.

4. **Land it.** Move the 128 existing files to `supabase/migrations/_archive/` (keep them,
   they are the historical record) and add
   `supabase/migrations/00000000000000_baseline.sql`.

5. **Reconcile the remote history** so Supabase considers the baseline applied to
   Wrenchlane without re-running it (`supabase migration repair`, or insert the row into
   `supabase_migrations.schema_migrations` directly). Wrenchlane's schema must not change.

6. **Write the apply script.** `scripts/migrate-tenants.mjs`, which reads the tenant list
   and applies any unapplied migrations to each, with `--dry-run` by default and a summary
   of what would run where. Until phase 04 exists the tenant list can be a local constant.

## Done when

- A brand new empty Supabase project reaches the exact current schema by applying only
  `supabase/migrations/`.
- Wrenchlane's live schema is byte-identical to what it was before the phase started.
- `scripts/migrate-tenants.mjs --dry-run` reports "nothing to apply" for Wrenchlane.
- Delete the scratch project.

## Traps

- The Migration Safety CI check needs an exposed schema in the Supabase dashboard, or it
  goes red for a reason that is not drift.
- `pg_dump` writes `CREATE SCHEMA` and ownership statements that Supabase rejects. Strip
  them, hence `--no-owner --no-privileges`.
- Do not let this phase quietly become a schema cleanup. Orphaned tables (`deals`,
  `pipelines`, `deal_contacts`, the unused warmup columns) stay exactly as they are.
  Phase 10 needs the deal tables.

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

## Prerequisites, verified 2026-08-29

Already checked so you do not lose time to them:

- **`pg_dump` and `psql` are installed** via `brew install libpq`. They are keg-only, so
  prepend the path: `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`. Client is 18.6,
  server is 17.6, which is the right way round.
- **`SUPABASE_DB_PASSWORD` is present** in `.env.local`.
- **Connect through the session pooler**, which avoids the IPv6 problem with the direct host:
  `-h aws-1-eu-north-1.pooler.supabase.com -p 5432 -U postgres.wdgiwuhehqpkhpvdzzzl -d postgres`
- Use `libpq` psql, not `node-pg`.

The dump command has been smoke-tested end to end. It exits 0 and produces about 357 KB.

## Known-good target numbers

The `public` schema dump must contain exactly these. If your dump differs, find out why
before proceeding, because a silent omission here becomes a missing column in production
weeks later.

| Object | Count |
|---|---|
| `CREATE TABLE` | 101 |
| `CREATE FUNCTION` | 32 |
| `CREATE TRIGGER` | 53 |
| `CREATE POLICY` | 123 |
| `ENABLE ROW LEVEL SECURITY` | 97 |
| `CREATE VIEW` | 12 |
| `CREATE INDEX` | 205 |

**Two of those numbers look wrong and are not.** Read this before you go hunting:

- **32 functions, not 67.** The catalogue reports 67 functions in `public`, but 35 of them
  are owned by extensions and `pg_dump` correctly excludes them: they arrive with
  `CREATE EXTENSION`. 32 user functions plus 35 extension functions is the 67.
- **97 RLS statements for 101 tables.** Four tables genuinely have RLS disabled. See below.

## Extensions: this is the part that will bite

Three extensions are installed **into the `public` schema**: `pg_net`, `pg_trgm` and
`unaccent`. A `--schema=public` dump emits index and function references that depend on them
without emitting the `CREATE EXTENSION` statements, so a naive baseline fails to apply.

The baseline must create extensions **first**, in their correct schemas:

| Extension | Schema |
|---|---|
| `pg_net`, `pg_trgm`, `unaccent` | `public` |
| `pg_stat_statements`, `pgcrypto`, `uuid-ossp` | `extensions` |
| `pg_cron`, `plpgsql` | `pg_catalog` |
| `supabase_vault` | `vault` |

## Four tables have RLS disabled

`_ops_queue_pause_2026_04_28`, `dashboard_cta_clicks`, `dashboard_domain_health_checks`
and **`discovered_shops`**.

The first three are ops and analytics tables. `discovered_shops` is different: it holds
about 42,000 rows of scraped prospect data including emails and phone numbers, and it is
workspace-scoped everywhere else in the code.

This is low risk today because there is one tenant with one database. It is **not** low risk
once there are three, and it is very likely one of the known multi-tenant isolation leaks.

**Do not fix it in this phase.** Carry the current state faithfully, and open an issue so it
is closed before phase 08 stands up a second customer. Changing behaviour here would break
ground rule R1.

## What to do

1. **Dump the live schema.**

   ```
   export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
   export PGPASSWORD="<SUPABASE_DB_PASSWORD from .env.local>"
   pg_dump --schema-only --no-owner --no-privileges \
     --schema=public --schema=storage \
     -h aws-1-eu-north-1.pooler.supabase.com -p 5432 \
     -U postgres.wdgiwuhehqpkhpvdzzzl -d postgres > /tmp/live-schema.sql
   ```

2. **Capture what `pg_dump` misses or mangles.** Check each against the table above and
   add by hand what is absent:
   - the 9 extensions, in the schemas listed above, emitted **before** everything else
   - all 123 RLS policies, plus `ENABLE ROW LEVEL SECURITY` on the 97 tables that have it
     and, deliberately, not on the 4 that do not
   - the 32 user functions, in particular `get_user_workspace_ids()` (SECURITY DEFINER,
     the isolation primitive the whole RLS model rests on) and `update_updated_at`
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

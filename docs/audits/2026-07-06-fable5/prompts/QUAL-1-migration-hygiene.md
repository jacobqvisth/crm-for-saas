# QUAL-1 · Migration timestamp repair + pg_cron drift check + types CI

- **Runner:** Sonnet · **Effort:** S · **Repo:** `~/crm-for-saas`

## Context
Three migration-hygiene issues:
- **Duplicate migration timestamps** break deterministic ordering: `20260401000000` (inbox_messages + phase15_sequence_reliability), `20260630120000` (mailbox_sync + phone_numbers), `20260630140000` (per_user_call_settings + rep_ownership).
- `supabase/ceo-cron.sql` + `ceo-cron-throttle.sql` live outside `migrations/` with `__SYNC_SECRET__` placeholders → live pg_cron drifts from the files (already bitten: "verify cron.job vs ceo-cron.sql before trusting today").
- `database.types.ts` is current but there's no CI guard against drift (drift happened once, `c333fd1`).

## PROMPT
1. **Renumber** the second file of each duplicate-timestamp pair by +1 second (rename the file). These are already-applied migrations, so this is a filename-ordering fix only — confirm none is unapplied before renaming, and note in the PR that remote migration history may need `supabase migration repair` (leave the repair to Jacob).
2. **Add `scripts/verify-pg-cron.mjs`** that queries `select jobname, schedule from cron.job` (via the PostgREST/service-role path used by other scripts, or document the psql command) and diffs against a checked-in `supabase/pg-cron-manifest.json`. Run it in the domain-health cron or as a CI check so drift is caught.
3. **Add a CI step** running `supabase gen types typescript` (or the repo's existing gen command) and failing if it diffs from the committed `src/lib/database.types.ts`.

### Definition of done
- No duplicate migration timestamps.
- pg_cron drift check script + manifest exist and run somewhere.
- CI fails on stale database.types.ts.
- `npm run lint` passes.

### Verify
`ls supabase/migrations | sort` shows unique prefixes. Run `verify-pg-cron.mjs` locally against prod (read-only) and confirm it reports match/drift. Introduce a deliberate types diff and confirm the CI check would catch it.

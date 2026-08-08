# CLEAN-1 · Dead code cleanup

- **Runner:** Sonnet · **Effort:** S · **Repo:** `~/crm-for-saas`

## Context
Confirmed-dead items (each verified by import-graph in the audit). Some are gated on feature decisions — **do not drop those columns until the feature is declined.**

## PROMPT
Do the unblocked items now; list the gated ones in the PR for a decision.

**Unblocked (do now):**
1. **7 scripts import the removed `postgres` package** (crash if rerun): `scripts/backfill-scb-sole-prop-contacts.mjs`, `import-scb-shops.mjs`, `enrich-from-scb.mjs`, `import-brreg-no-shops.mjs`, `verify-scb-contacts.mjs`, `import-no-chains.mjs`, `promote-norway-staging.mjs`. Either move to `scripts/archive/` with a README noting they need porting, OR port the still-useful ones to `@supabase/supabase-js` (follow `scripts/promote-discovered-shops.mjs`). More countries are planned, so porting the import scripts has real value — prefer porting `import-*` and archiving the one-off backfills.
2. **`REMOVE_REASONS` route-export error** (PR #150) breaks local `next build`/CI-red on main (Vercel tolerates it). Find the route exporting a non-Next value (`REMOVE_REASONS`) and move it to a `lib` module so the route file only exports Next handlers. (PROJECT-STATUS "Next" item C.)

**Gated (list in PR, don't drop yet):**
3. `deals`/`pipelines`/`deal_contacts` tables + `tasks.deal_id` — dead, but FEAT-10 may revive as a pipeline view. Drop only if FEAT-10 is declined.
4. `gmail_accounts.warmup_*`/`is_warmup`/`health_score` — orphaned, but FEAT-8 (deliverability loop) would use `health_score`. Drop `warmup_*` (PR #36 remnant) if warmup is declined; keep `health_score` if FEAT-8/FEAT-3 proceeds.
5. `companies.health_score` — displayed (`signals.tsx:65`) but never computed. FEAT-3 computes it. Keep if FEAT-3 proceeds.

### Definition of done
- postgres-importing scripts archived or ported; `REMOVE_REASONS` export fixed so `next build` is green locally.
- Gated drops documented with the deciding feature, not executed.
- `npm run build` and `npm run lint` pass.

### Verify
`npm run build` succeeds locally (the REMOVE_REASONS fix). `grep -rl "from 'postgres'" scripts/` returns nothing outside archive.

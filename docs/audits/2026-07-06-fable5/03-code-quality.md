# Code Quality & Architecture Findings

Stamp: `80d00d8` (line numbers cite the `bfee7af` tree). Scope: `src/` (599 TS files), `scripts/`, `supabase/`, `e2e/`. The codebase is clean overall (strict TS, 0 `@ts-ignore`, only 21 `: any`/`as any`, only 2 TODO comments in all of `src/`). The issues are systemic-but-mechanical, and they concentrate in the same two cron files performance flagged.

## HIGH

### REL-2 · Swallowed Supabase errors — 152 unchecked mutations (40% of all mutation sites)
- **Count:** 147 fire-and-forget + 1 captured-unchecked + 4 data-only, vs 229 properly checked (statement-level scan of every `.from(...).insert/update/upsert/delete(`).
- **Concentration:** `cron/process-emails/route.ts` (30), `cron/check-replies/route.ts` (15), `contacts/[id]/forget/route.ts` (11), `lib/calls/process.ts` (8), `lib/enrich/find-phone-for-contact.ts` (7), `cron/mailbox-sync/route.ts` (6).
- **Top risks:**
  1. `process-emails:191` `update({status:"sending"})` unchecked → if the claim fails the item stays `scheduled` → **double-send** next run.
  2. `check-replies:250` `update({status:"replied"})` unchecked → silent failure = **keep cold-emailing someone who already replied**.
  3. `process-emails:419` + `check-replies:499` + `forget:52` suppression inserts unchecked → **keep emailing unsubscribed/bounced/GDPR-erased addresses** (compliance + deliverability).
  4. `forget:84-106` — the entire GDPR erasure cascade (8 deletes incl. contacts/activities/email_queue) is fire-and-forget → route returns success while **erasure silently failed** (legal exposure). See REL-3.
  5. `process-emails:694,765` next-step queue inserts unchecked → enrollment silently stalls (the "zombie enrollment" class).
  6. `process-emails:610,722` `current_step` bumps unchecked → same step re-sent.
  7. `gmail/token-refresh.ts:81,89` token persist + `status:"disconnected"` unchecked → dead mailbox undetected / repeated refresh.
  8. Client components: `csv-import-wizard.tsx:299,307`, `phone-numbers-panel.tsx` (5), `sequence-builder.tsx:step_order renumber` — UI shows success while write failed.
- **Context:** this exact class already caused a prod incident (activities CHECK failures dropped silently for months — documented at `src/lib/activities/insert.ts:1-22`, which is the one table with the proven fix).
- **Fix:** (a) codemod appending `.throwOnError()` (0 uses today) to the 147 fire-and-forget sites — each cron already has an outer try/catch; (b) try/catch + `console.error` for the ~10 "must return 200" tracking-pixel sites; (c) a grep-based CI check forbidding unused-result `insert|update|delete` without `.throwOnError()`. Do the 6 hotspot files first (77/152 sites). → **Prompt:** `prompts/REL-2-throwonerror-hotspots.md`. Effort M (S per hotspot file). Runner: Opus 4.8 for the crons, Sonnet for client components.

### REL-2b · No error observability layer
- `captureException`: 1 hit (test only). `console.error`: 69 sites → Vercel logs only. No Sentry/PostHog exception capture despite PostHog being wired.
- **Fix:** one `reportError(err, context)` helper (console.error + PostHog `captureException` or the existing `SLACK_ALERT_WEBHOOK_URL` used by domain-health); replace the 69 sites mechanically. → **Prompt:** `prompts/REL-2-throwonerror-hotspots.md` (helper section). Effort M. Runner: Sonnet.

### REL-1 · 48 vitest files exist but vitest never runs in CI
- `package.json:5-16` has only `test:e2e*`; `.github/workflows/e2e.yml` runs build+lint+tsc on PRs, playwright on push-to-main. The good unit coverage (render, scheduler, variants, parse-ndr, sender-rotation, 14 ceo files) can silently rot.
- **Fix:** add `"test": "vitest run"` + a CI job. **Highest ROI single change in this report.** → **Prompt:** `prompts/REL-1-vitest-ci.md`. Effort S. Runner: Sonnet.

### ARCH-1 · Auth boilerplate copy-pasted across ~102 routes; no shared helper
- 102 routes inline `createClient()+getUser()+401`. `resolveWorkspace()` exists in **3 identical copies** (`lib/roadmap/server.ts`, `lib/forums/server.ts`, `lib/videos/server.ts`); `getWorkspaceId()` is locally redefined in 6 route files. Any auth change = 100+ edits; drift already visible.
- **Fix:** `src/lib/api/auth.ts` exporting `requireUser()` / `requireWorkspace()` (promote the best `resolveWorkspace`) + `requireCronSecret()`; mechanical migration in batches; delete the 3 copies + 6 local defs. → **Prompt:** `prompts/ARCH-1-auth-helpers.md`. Effort M. Runner: Opus 4.8 to design the helper, Sonnet to migrate routes in batches.

## MEDIUM

### REL-4 · `isAutoReply` duplicated (drift = mis-classified replies)
- Route-local copy `cron/check-replies/route.ts:564-603` vs exported `isAutoReply` in `lib/gmail/messages.ts:62`. This gates reply-rate stats and stop-on-reply.
- **Fix:** delete the route copy, import from lib, add a unit test (OOO subjects en/sv/no/da/de/fi + `Auto-Submitted`/`Precedence:bulk` headers → true; human reply → false). → **Prompt:** `prompts/REL-4-isautoreply-dedup-test.md`. Effort S. Runner: Sonnet.

### REL-6 · Zero tests on the send pipeline's decision logic
Ranked protection-per-test:
1. `isAutoReply` (pure, untested, duplicated) — see REL-4.
2. `enrollContacts` (`lib/sequences/enrollment.ts`, injectable client, mock pattern proven in `render.test.ts`) — unsubscribed/customer/lemlist contact → correct skip counter + **no** queue row; clean contact → exactly 1 enrollment + 1 queue row.
3. Suppression decision — extract pure `isSuppressed(email,domain,rows)` from `process-emails:348-357,400-425`, then test match/no-match.
4. Send-queue selection — extract `selectDueQueueItems()` from the 853-line `process-emails`, then test "≤1 item/sender/run, only senders with capacity".
5. `renderQueuedEmail` — already covered (`render.test.ts`), use as the reference.
- → **Prompt:** `prompts/REL-6-send-pipeline-tests.md`. Effort M–L. Runner: Opus 4.8 (extraction changes behavior surface).

### ARCH-3 · ~40 of 84 body-parsing routes have no zod validation
- zod is installed + used in 38 route files, but sequences/contacts/inbox mostly don't validate — and those are the money paths. 84 routes call `request.json()`.
- **Fix:** add `const body = Schema.parse(await request.json())` to mutation routes under `api/sequences/`, `api/contacts/`, `api/inbox/`. → **Prompt:** `prompts/ARCH-3-zod-validation.md`. Effort M (S per route). Runner: Sonnet.

### ARCH-2 · 147 scattered `process.env` reads (44 vars, 28 non-null-asserted); no central config
- Only `lib/ceo/env.ts` (zod, ceo-only) is centralized. Missing `CRON_SECRET` fails *closed but silently* (crons 401 forever — the memory-noted "cron silently not running" class).
- **Fix:** extend the `lib/ceo/env.ts` pattern to `src/lib/env.ts` with lazy per-group validation (`env.supabase()`, `env.cron()`) that throws with the var name; mechanical replacement. → **Prompt:** `prompts/ARCH-2-central-env.md`. Effort M. Runner: Sonnet.

### QUAL-1 · Duplicate migration timestamps + out-of-band SQL
- Duplicate version prefixes (break ordering): `20260401000000`, `20260630120000`, `20260630140000` (two files each). `supabase/ceo-cron.sql` + `ceo-cron-throttle.sql` live outside `migrations/` with `__SYNC_SECRET__` placeholders → live pg_cron drifts from the files (already bitten).
- **Fix:** renumber the second file of each pair (+1s); add `scripts/verify-pg-cron.mjs` diffing `select jobname,schedule from cron.job` against a checked-in manifest, run in domain-health cron or CI. → **Prompt:** `prompts/QUAL-1-migration-hygiene.md`. Effort S. Runner: Sonnet.

### QUAL-2 · Redundant service-role client factories + third cron-secret form
- `lib/supabase/service.ts` (18 routes) vs `lib/supabase/admin.ts` (4) are the same privilege; 6 routes bypass factories with inline `createClient(env)`. `e2e-login` uses a query-param secret (third convention).
- **Fix:** merge `admin.ts` into `service.ts`; convert the 6 inline sites; standardize on `requireCronSecret()` from ARCH-1. → **Prompt:** `prompts/QUAL-2-client-factory-consolidation.md`. Effort S. Runner: Sonnet.

## LOW

### CLEAN-1 · Dead code
- **7 one-off scripts import the removed `postgres` package** (~1,738 LOC) — crash if rerun (country-import scripts; more countries planned): `backfill-scb-sole-prop-contacts.mjs`, `import-scb-shops.mjs`, `enrich-from-scb.mjs`, `import-brreg-no-shops.mjs`, `verify-scb-contacts.mjs`, `import-no-chains.mjs`, `promote-norway-staging.mjs`. Move to `scripts/archive/` or port to `@supabase/supabase-js` (like `promote-discovered-shops.mjs`).
- **Deals/pipelines dead:** `deals`, `pipelines`, `deal_contacts` tables have **zero** code references; `tasks.deal_id` vestigial. Decide FEAT-10 (revive as pipeline view) vs drop.
- **Warmup schema orphan:** `gmail_accounts.warmup_*/is_warmup/health_score` exist only in `database.types.ts` (~2780-2851). Decide FEAT-8 (use in deliverability loop) vs drop.
- **`companies.health_score`** read for display (`companies/detail/signals.tsx:65`) but never computed → decide FEAT-3 (compute it) vs drop.
- **`REMOVE_REASONS` route-export error** (PR #150) breaks local `next build`/CI-red on main; Vercel tolerates it (PROJECT-STATUS "Next" item C) — fix the export.
- **Verified alive/clean (no action):** /ceo redirects, wl-sync, pilot-stats, `@/lib/ceo` — all reachable.
- → **Prompt:** `prompts/CLEAN-1-dead-code.md`. Effort S (but gate warmup/deals/health_score drops on the feature decisions). Runner: Sonnet.

### QUAL-3 · Type-safety leak via `as unknown as` (69 sites)
- `: any`/`as any` under control (21). But 69 `as unknown as` casts — hotspots `list-detail-client.tsx` (7), `process-emails` (7, incl. casting joined `enrollment.sequences`), `check-replies` (4) — silence exactly the joined-relation typing PostgREST embeds break; a schema change fails at runtime.
- **Fix:** typed row shapes for the 5 recurring join results (enrollment+sequence, contact+company) in `src/lib/types/`; forbid new `as unknown as` outside `*.test.ts`. → **Prompt:** `prompts/QUAL-3-join-types.md`. Effort M. Runner: Opus 4.8.
- Also ~37 hand-rolled entity types shadow generated `Tables<>` (mostly benign extensions; ~10 fully hand-written rows will drift). Convert to `Tables<>`/`Pick<>`. Bundled in the same prompt.

### QUAL-4 · database.types.ts freshness OK, but no drift guard
- Last regen 2026-07-02 = latest migration; but no CI check that types match migrations (drift already happened once, `c333fd1`). Add a CI step running `supabase gen types` + diff. Bundled into `prompts/QUAL-1-migration-hygiene.md`.

## File-size hotspots (maintainability)
`process-emails/route.ts` (853 ln) and `check-replies/route.ts` (651 ln) are simultaneously the highest-blast-radius, most-swallowed-errors, least-tested, most-`unknown`-cast files — every other finding concentrates there. Any refactor budget should first extract their decision logic into `src/lib/sequences/` pure functions (enables REL-2, REL-6, QUAL-3 at once). Client: `dashboard-sections.tsx` (2,954 ln), `contact-detail-client.tsx` (1,598 ln) large but lower risk.

---
type: resource
status: active
tags: [wrenchlane-crm, cc-log, sessions]
created: 2026-03-27
updated: 2026-04-22
---

# CC Session Log — Wrenchlane CRM

> Running log of all Claude Code sessions. Most recent first.
> CC should append a new entry here at the end of every session.
> Cowork reads this at session start instead of relying on Jacob pasting summaries.

---

## Session: CIO fallback + sync-health alerting + Vercel-cron migration (2026-05-12, PRs #183 / #185 / #186 / #187 / #188 / #189)
- **Date:** 2026-05-12
- **Triggered by:** Jacob couldn't find a brand-new signup (`gladjen.tvatt.verkstad@gmail.com`) in `/contacts` even though he'd signed up to the WL app earlier that day.
- **PRs:** #183, #185, #186, #187, #188, #189 (plus #181/#184 logged separately above).

### What was wrong
The signup was real (verified via Customer.io: `cio_id=a4860c00840b850b`, signed up at 2026-05-12T10:41:53 UTC). But the discoverer only reads from the S3 export `latest/user_stats.json.gz`, which refreshes twice daily at 02:00 + 10:00 UTC (Stockholm 04:00 + 12:00). The user signed up *after* the 10:15 UTC export, so he wouldn't land in CRM until tomorrow's 10:25 UTC `core_app` sync → 10:30 UTC discoverer cycle.

Underneath that, three latent issues surfaced:
1. **#181 root cause** — `core_app` sync had been silently failing every run from 2026-05-04 → 2026-05-12. PR #176's dedup pass missed `writeRawRows` + `writeFunnelPoints` (composite conflict keys). Fixed pre-session.
2. **Detection gap** — 8-day silent outage was only noticed when an operator manually tried to find an email. No alerting.
3. **Architectural gap** — even with a healthy S3 sync, the 2x/day cadence means up-to-12h lag between WL-app signup and CRM appearance.

### What shipped

**Real-time fallback (PR #183 → #186 → #187 → #188):**
- New `fetchCioNewWlUsers()` in `src/lib/wl-sync/discover-new.ts` queries CIO's "All Users" segment (id=1, dynamic) for any `wl_user_id` not already in the current S3 snapshot, then attribute-fetches each candidate via `/v1/customers/{cio_id}/attributes`. Folds CIO rows into the same workshops Map that S3 feeds. S3 wins on duplicates (carries `workshop_created_at` CIO doesn't).
- Reuses `CUSTOMER_IO_APP_API_KEY` + `CUSTOMER_IO_REGION` env vars already set for the `customer_io` ceo-sync source.
- **CIO API gotcha #1 (#186 fix):** App API `GET /v1/customers` does NOT support listing without an email filter — returns `400 bad request`. Use segment membership instead (`GET /v1/segments/{id}/membership` is paginable via `next` cursor; doesn't require an email).
- **Regression I introduced (#187 fix):** When adding a dedup-on-user_id guard in #183, I moved `w.users.push(r)` into the `else if` branch, which meant brand-new workshops (first time seen in this run) never got their user pushed. Result: a successful CIO-fallback run created 10 companies with 0 contacts. Always-push (deduped) is the fix.
- **CIO-only test workshops (#188):** The existing `dashboard_workshops.is_internal_test` gate only fires for workshops in S3. CIO-only signups bypass it. Added a word-boundary regex `/\b(test|wrenchlane)\b/i` on `company_name` to catch obvious internal/test workshops at CIO ingestion. Surfaces in new diagnostic field `cioFilteredAsTest`.
- **New diagnostic fields on `DiscoverResult`:** `s3RowsValid`, `cioRowsFetched`, `cioOnlyWorkshops`, `cioFilteredAsTest`. Makes operational logs self-explanatory.

**Sync-health alerting (PR #185):**
- New module `src/lib/ceo/sync/health-check.ts` with `checkSyncHealth()` and `notifySyncHealth()` pure functions.
- New cron route `src/app/api/cron/check-sync-health/route.ts` at `0 8 * * *` UTC.
- Two checks: (a) any failed `dashboard_sync_runs` in the last 26h, (b) any tracked source whose most recent success is older than its freshness budget (core_app: 18h, daily sources: 30h, hourly: 3h).
- Posts to `SLACK_ALERT_WEBHOOK_URL` if set, otherwise `console.error` (surfaces in Vercel logs). No env-var setup required to ship.

**Cron-cost cleanup (PR #189, supersedes #184):**
PR #184 originally throttled 4 CEO syncs (ga4 / google_ads / search_console / app_store_connect) by editing the pg_cron schedule via `supabase/ceo-cron-throttle.sql`. Pasting the substituted SQL into Studio worked but the SQL carries the literal SYNC_SECRET in the cron command string (same anti-pattern as the original PR #120 setup). #189 supersedes it: moves the 4 to Vercel cron entries in `vercel.json` (06:00 / 06:05 / 06:10 / 06:15 UTC). Vercel auto-injects `Authorization: Bearer $CRON_SECRET`, no literal token in any SQL string.
- Required adding a `GET` handler to `src/app/api/ceo-sync/[source]/route.ts` (Vercel cron fires GET by default; old pg_cron fired POST via `net.http_post`).
- 4 pg_cron jobs unscheduled via the Supabase MCP after #189 deployed.
- Remaining in pg_cron: `ceo-sync-core-app-twice-daily`, `ceo-sync-stripe-hourly`, `ceo-sync-customer-io-hourly` (real-time-ish, kept on existing schedules).

### Verification (live, post-deploy)

- Pre-cleanup discoverer run: `cioRowsFetched: 23, cioOnlyWorkshops: 21, cioFilteredAsTest: 4` (Wrenchlane AB + 3 obvious test workshops correctly filtered).
- After cleanup of 26 orphan companies (10 from #183 regression + 16 pre-existing from 2026-05-05 cohort): discoverer rebuilt 21 companies with 6 contacts attached — gladjen included.
- **Final gladjen contact:**
  - `id: eef9e2a6-0d65-4dc1-80f0-ef3bc1c3bba2`
  - `email: gladjen.tvatt.verkstad@gmail.com`
  - `wl_user_id: 90fc79cc-a061-70df-28a6-401b42ed786d`
  - `company_id: 7b8ea448-fbcf-4e27-99ac-d9dd548ba4ed` ("Glädjens biltvätt o bilverkstad AB")
  - `source: wl-app`, `lead_status: customer`, `language: sv`, `country_code: SE`, `app_role: admin`, `is_primary: true`, `tags: ['owner']`
- Final pg_cron state (3 jobs remain): core_app twice-daily, stripe hourly, customer_io hourly.

### Notable decisions
- **CIO as supplement, not replacement.** S3 still gives a complete workshop snapshot (with `workshop_created_at` CIO doesn't carry). Keeping S3 as primary preserves the propagator's expectations. CIO covers the lag window between sign-up and the next S3 export.
- **Segment-membership pagination, not customer enumeration.** App API doesn't allow `GET /v1/customers` without an email filter. The "All Users" segment is dynamic + paginable + cheap to walk.
- **Vercel cron over pg_cron for the throttle.** Single cron surface, source-of-truth lives in git (`vercel.json`), no literal Bearer tokens in pg_cron command strings, no Studio paste for secret rotation.
- **Sync-health alert ships without external setup.** Defaults to console.error → Vercel logs. Slack push is an opt-in env-var addition.

### Open follow-ups (not addressed in this session)
- **Chain-vs-branch data architecture.** 15 of the 21 rebuilt wl-app companies sit orphan because their would-be users' emails are already linked to Hans's manually-imported chain-level companies (e.g. 5 Mekonomen branches share one "Mekonomen Södermalm" company). The discoverer creates a parallel per-branch company, the email-merge guard skips the user, the new company stays orphan. Two paths to decide: (a) propagator sets `wl_workshop_id` on Hans's existing chain-level company and the discoverer skips the per-branch INSERT, or (b) Hans's chain-level companies get split per branch. Either way it's a data-model decision, not a bug.
- **`SLACK_ALERT_WEBHOOK_URL` env var.** Add via `vercel env add` if you want Slack push instead of Vercel-log-only alerts.

### Build / lint / tsc (every PR in this session)
- `npm run lint` clean
- `npx tsc --noEmit` clean
- `npm run build` green

## Session: Dedupe writeRawRows + writeFunnelPoints — finishes the PR #176 dedup pass (PR #181)
- **Date:** 2026-05-12
- **PR:** [#181](https://github.com/jacobqvisth/crm-for-saas/pull/181)
- **Branch:** `fix/ceo-sync-rawrows-funnel-dedup`

### What was wrong
PR #176 deduped `writeUsers`, `writeWorkshops`, `writeSubscriptions`, and the per-diag/chat/motor/cost writers, but missed `writeRawRows` and `writeFunnelPoints` — both have **composite** conflict keys. The 10:25 UTC `ceo-sync-core-app-twice-daily` run today still failed with `ON CONFLICT DO UPDATE command cannot affect row a second time`, so `dashboard_users.last_seen_at` was frozen at 2026-05-03 across all 343 rows.

Trigger that surfaced this: a `@wrenchlane.com` operator couldn't find a fresh WL-app signup (`gladjen.tvatt.verkstad@gmail.com`) in `/contacts`. Investigation showed the user wasn't in `dashboard_users` either — i.e. the upstream sync was stuck.

### Root cause
`buildRawRows("user_stats", body, lastModified, row => user_stats:<user_id>)` keys every raw row by `(source_key, external_id=user_stats:<user_id>, period_start=lastModified)`. If S3 ships the same user_id twice (the exact pattern #176 was fixing on the user/workshop side), `writeRawRows` blows up **before** the deduped `writeUsers` runs.

`writeFunnelPoints` has the same shape risk for any connector that emits funnel rows.

### Fix
Replaced both `rows.map(...)` payload builders with `Map<conflictKey, row>` builders — the same last-value-wins pattern `writeMetricPoints` already uses. No behavior change for clean inputs; collisions resolve to the last row, which matches the post-conflict state Postgres would have ended up in across separate upserts.

### Verification (post-deploy, via prod curl)
- `POST /api/ceo-sync/core_app` returned `{ status: "success", rowsRead: 1749, rowsWritten: 4176 }`.
- `MAX(dashboard_users.last_seen_at)` advanced from **2026-05-03T21:26 UTC** to **2026-05-12T10:08 UTC**.
- Counts: 343 → 363 dashboard_users (+20), 285 → 295 dashboard_workshops (+10).
- `POST /api/cron/discover-new-wl-users` returned `{ status: "ok", newCompanies: 0, newContacts: 0, mergedContacts: 0, skippedInternalTest: 0, errors: 0 }` — the new cron is healthy; the only reason it found nothing is that the upstream S3 file `latest/user_stats.json.gz` LastModified is **2026-05-12T10:15:41 UTC**, before the operator's signup. Next core_app sync after the next S3 refresh will pick it up.

### Build / lint / tsc
- `npx tsc --noEmit` clean
- `npm run lint` clean
- `npm run build` green

### Follow-ups
- **CEO sync health alarm.** Five consecutive failed runs (May 4 → May 12) only surfaced because someone manually tried to find a user. `dashboard_sync_runs.status='failed'` should fire an alert (Slack/email) — silent failures of a twice-daily cron is a footgun. Worth wiring up.
- **S3 export cadence.** Today's `last_modified=10:15:41 UTC` and the CRM cron at 10:25 UTC suggest the WL-app S3 export runs once daily ~10:15 UTC. The 02:25 UTC CRM cron is therefore reprocessing the same file from the previous day — wasted work, harmless. Could drop the 02:25 firing or move it to ~10:30 UTC.

## Session: Daily cron to discover new WL-app signups (PR #179)
- **Date:** 2026-05-12
- **PR:** [#179](https://github.com/jacobqvisth/crm-for-saas/pull/179)
- **Branch:** `feature/discover-new-wl-users-cron`

### What was wrong
PR #176's propagator is UPDATE-only by design — `dashboard_users.email_hash` is hashed, so it can't insert a new contact (no plaintext email available). Result: a brand-new WL-app signup lands in `dashboard_users` via the twice-daily `core_app` sync but is invisible to `/contacts` until someone manually runs `scripts/import-wl-users.mjs`. Five days since last manual run → 6 stranded signups.

### Fix
New Vercel cron at **`30 10 * * *`** (5 minutes after the second `ceo-sync-core-app-twice-daily` firing at 10:25 UTC) that fills only the INSERT path:

- **`src/lib/wl-sync/discover-new.ts`** — pulls `s3://codeoc-dashboard-prod/latest/user_stats.json.gz` (the only source with plaintext email). For each workshop_id not yet linked via `companies.wl_workshop_id`, INSERTs a `companies` row + the workshop's users as `contacts` rows.
- **`src/app/api/cron/discover-new-wl-users/route.ts`** — auth via `SYNC_SECRET`/`CRON_SECRET` Bearer (same pattern as `/api/ceo-sync/*` and `/api/cron/process-emails`).
- **`vercel.json`** — added the cron entry.

Rules baked in:
- **Internal-test workshops** (`dashboard_workshops.is_internal_test = true`, PR #164) are skipped.
- **Email-merge for existing prospects:** if a contact with the same email already exists in the workspace (e.g. a discovery prospect who just signed up), UPDATE it in place (set `wl_user_id` + `source='wl-app'` + `lead_status`) instead of creating a duplicate.
- **Skip contacts that already carry a `wl_user_id`** — those are the propagator's job.
- **Lead status derived from `subscription_status`** — `paused`/`inactive`/`past_due` → `churned`, everything else → `customer`. Mirrors `import-wl-users.mjs`.

### Smoke test (post-deploy)
Curled the route with prod `SYNC_SECRET`:
```
{ "status": "ok", "newCompanies": 6, "newContacts": 6, "mergedContacts": 0, "skippedInternalTest": 0, "errors": 0 }
```
Verified all 6 are correctly tagged `source='wl-app'`, `lead_status='customer'`, `app_role='admin'`, with `country_code` set. Workshops: SE / GA / GB×2 / BY / IN.

### Notable decisions
- **Separate cron, not an extension of the propagator.** PR #176 explicitly kept the propagator UPDATE-only. Adding insert logic there would widen blast radius. A separate cron preserves PR #176's design choice and keeps the responsibility split clean: propagator updates, discoverer inserts.
- **`dashboard_workshops.is_internal_test` query uses an untyped Supabase client** (mirroring `src/lib/ceo/supabase.ts`) because the generated `database.types.ts` doesn't yet include the column added by PR #164. Worth a types regen in a follow-up but not blocking.
- **Test rows not flagged in `dashboard_workshops`** still slip through — the smoke run created `Matteo apple prod test 02` because nobody had toggled its `is_internal_test` flag yet. The cron is doing the right thing; the tag belongs on the CEO settings page.

### Build / lint / tsc / tests
- `npm run lint` clean
- `npx tsc --noEmit` clean
- `npm run build` green; new route listed at `/api/cron/discover-new-wl-users`

### Follow-ups
- Regenerate `database.types.ts` so the dashboard_* untyped-client workaround can go away.
- Decide whether to populate `contacts.diagnostics_total` etc. on insert. The propagator doesn't touch these and the discoverer doesn't either — both leave them at the schema default. Wiring up diagnostics aggregation for new contacts would be a follow-up to either module.

---

## Session: Fix core_app sync dedup bug + propagate dashboard_* into CRM (PR #176)
- **Date:** 2026-05-12
- **PR:** #176 (squash `658530c`)
- **Branch:** `feature/core-app-dedup-fix`

### What changed
Two related fixes for the AWS/S3 core_app sync that had been failing for ~9 days.

**1. Dedup bug** — Postgres rejects an upsert payload containing two rows with the same ON CONFLICT key with `ON CONFLICT DO UPDATE command cannot affect row a second time`. The S3 `user_stats` export occasionally shipped the same `internal_user_id` twice (the same Cognito user appearing in two rows for some reason) and `writeUsers` upserted the raw array, blowing up the whole sync. Last 13 consecutive runs (2026-05-04 → 2026-05-12) all failed with this error.

Added `dedupeByKey(rows, keyField)` helper in `src/lib/ceo/sync/writer.ts` and applied last-value-wins dedup before every upsert: users, workshops, diagnostics, diagnostic_chats, motor_usage, cost_entries, subscriptions. Mirrors what `writeMetricPoints` was already doing.

**2. Propagation** — New `src/lib/ceo/sync/propagate-to-crm.ts`. After a successful `core_app` sync, `runSourceSync` now updates `contacts` and `companies` with fresh dashboard data. UPDATE-only on rows that are already linked via `wl_user_id` / `wl_workshop_id` — never inserts and never unlinks. New WL-app users can't be auto-linked here because `dashboard_users.email_hash` is hashed; that ingest stays a separate concern.

Field mapping:
- **`dashboard_users` → `contacts`:** `last_seen_at → last_active_at`; metadata-derived: `username → app_username`, `user_role → app_role` (whitelisted to `admin`/`mechanic`), `login_count`, `credits_remaining`, `plan_type → user_plan_type`, `subscription_status → user_subscription_status`, `stripe_customer_id → user_stripe_customer_id` (with `core_stripe_customer_id` preferred), `stripe_subscription_id → user_stripe_subscription_id`.
- **`dashboard_workshops` → `companies`:** `activated_at`, `plan_key → plan`, `core_subscription_status → subscription_status`, `payment_status`, `trial_end → trial_ends_at`, `core_stripe_customer_id → stripe_customer_id`, `core_stripe_subscription_id → stripe_subscription_id`, `member_count` (from metadata), `customer_status` derived from `core_subscription_status + activated_at` → `trialing` / `active` / `inactive`.

Propagation failure is non-fatal — the sync still completes successfully, with a `crm_propagation: { contacts_updated, companies_updated }` block in `dashboard_sync_runs.metadata`.

### Files changed
- `src/lib/ceo/sync/writer.ts` — added `dedupeByKey()`, applied to 7 upsert call sites
- `src/lib/ceo/sync/propagate-to-crm.ts` (new) — `propagateDashboardToCrm()` + helpers
- `src/lib/ceo/sync/runner.ts` — calls propagation after successful `core_app` sync; surfaces propagation summary in run metadata

### Branch drift recovery
Initial commit went onto local `main` instead of the feature branch — git did a silent branch switch between `checkout -b` and the actual edits (cause not clear from reflog). Recovered the commit via `git reflog` → cherry-pick onto a fresh branch (`feature/core-app-dedup-fix`) off `origin/main`. Per the parallel-CC-branch-drift memory: `git update-ref` / cherry-pick beats `--hard reset`. Worked cleanly.

### Build / lint / tsc / tests
- `npm run lint` clean
- `npx tsc --noEmit` clean
- `npm run build` green
- Vitest tests for `src/lib/ceo/sync/*` are blocked by a pre-existing `@/*` alias-resolution issue in the vitest setup (same failure on `origin/main`, not introduced here). The `routes/` test suite runs fine; only the ceo/sync tests are affected. Worth fixing in its own PR.

### Verification
Vercel auto-deploys on push to main; the next scheduled `ceo-sync-core-app-twice-daily` cron firing (02:25 UTC) will exercise both the dedup fix and the propagation. Expected: `dashboard_sync_runs` shows a `core_app` row with `status='success'` and `metadata.crm_propagation = { contacts_updated, companies_updated }`. The dashboard_users / dashboard_workshops / dashboard_diagnostics tables will get fresh writes for the first time since 2026-05-03, and ~333 contacts + ~269 companies will see their WL-app fields updated.

### Follow-ups
- Fix the vitest `@/*` alias resolution for `src/lib/ceo/*.test.ts` so the sync logic gets test coverage going forward.
- If the dashboard sync starts producing `customer_status` values outside `trialing` / `active` / `inactive` (which we pruned from the contacts filter dropdown in PR #174), revisit the filter UI options.

---

## Session: Remove Prospector + prune dead enum values + AWS sync audit (PR #174)
- **Date:** 2026-05-12
- **PR:** #174 (squash `<see git log>`)
- **Branch:** `feature/prospector-removal-enum-cleanup`

### What changed (code)
Jacob: *"we will not use the prospector anymore. fix all the rest as u seem best."*

- **Prospector removed entirely** — `src/app/(dashboard)/prospector/page.tsx`, all 6 routes under `src/app/api/prospector/` (add-contacts, search, check-in-crm, saved-searches GET/POST/[id], ai-filter), plus `src/app/(dashboard)/settings/ai-filter/page.tsx` (existed only to score Prospector results). Drops the "AI Lead Filter" settings card and the temporary "Other tools" footer link added in PR #172. `prospeo` removed from `ALL_SOURCES` / `SOURCE_LABELS` in the contacts page filter.
- **Dead enum values pruned from UI option lists** (each one had zero rows in prod after a service-role count over 10,554 contacts + companies):
  - `contacts.status.archived` — removed from contact-detail dropdown, contacts filter, `STATUS_OPTIONS` in `src/lib/lists/filter-query.ts`
  - `contacts.lead_status.engaged`, `.unqualified` — removed from contacts filter (contact-detail already omitted them)
  - `contacts.email_status.unverified` — swapped to `.unknown` (368 rows in prod vs 0)
  - `companies.lifecycle_stage.reactivation`, `companies.customer_status.paused`, `.churned` — removed
- **Seniority editable field removed from contact-detail page.** 0/10,554 rows have a value, no automation writes it. Column left in schema (no migration).
- **Source-tagging:** `/contacts` Add Contact insert → `source: 'manual'`, `/companies/[id]` add-contact modal → `source: 'manual'`, CSV importer → `source: 'csv'`. Closes the long-standing gap where these paths wrote `source: null`.

### Files changed
- Deleted: `src/app/(dashboard)/prospector/page.tsx`, `src/app/(dashboard)/settings/ai-filter/page.tsx`, 6 files under `src/app/api/prospector/`
- Modified: `src/app/(dashboard)/settings/page.tsx`, `src/components/contacts/contacts-page-client.tsx`, `src/components/contacts/contact-detail-client.tsx`, `src/components/contacts/csv-import-wizard.tsx`, `src/components/companies/detail/add-contact-modal.tsx`, `src/lib/lists/filter-query.ts`

### AWS sync audit (investigation, no code change)
Jacob asked whether the AWS sync is on and what data it provides. Pulled `dashboard_sync_runs` over the last 60 days for the `core_app` source.

- **It IS scheduled** — pg_cron job `ceo-sync-core-app-twice-daily` fires at 02:25 and 10:25 UTC every day, hitting `https://crm-for-saas.vercel.app/api/ceo-sync/core_app` with `Authorization: Bearer SYNC_SECRET`.
- **It IS currently failing** — 13/28 runs in the last 60 days have failed; the last 13 consecutive runs (since ~2026-05-04) all error with `ON CONFLICT DO UPDATE command cannot affect row a second time`. This is the duplicate-user-id bug noted in the post-PR-#120 follow-ups in memory `project_wl-dashboard`.
- **The fix is small** — `src/lib/ceo/sync/sources/core-app.ts:1142` returns `mappedRows.filter(...)` without deduping by `internal_user_id`. Adding a `Map<id, row>` reduction before the return would close it. Same pattern needed in `buildWorkshopRows` (line 1145+) for the workshop upsert.
- **What it provides when healthy** — pulls `user_stats.json.gz` from the S3 `DATA_BUCKET`:
  - **users** (→ `dashboard_users`): internal_user_id, workshop_id, email_hash, customer_io_id, ga_client_id, created_at, last_seen_at, name, phone, core_stripe_customer_id, plus metadata (login_count, plan_type, subscription_status, stripe enrichment, etc.)
  - **workshops** (→ `dashboard_workshops`): workshop_id, name, owner_internal_user_id, country, plan_key, activated_at, language, core_subscription_status, payment_status, trial_end, created_by_agent, stripe IDs
  - **diagnostics, motor usage, diagnostic-chats, cost entries, raw metrics** (→ matching `dashboard_*` tables)
  - Stripe subscriptions are independently fetched and reconciled
- **What it does NOT do** — there is no writer anywhere in the CRM repo for `contacts.wl_user_id`, `contacts.app_role`, `companies.wl_workshop_id`, or any of the other Wrenchlane-app fields on contacts/companies. Those were filled by the one-off backfill at the time of the wl-dashboard absorption (PR #120, 2026-05-06). They are frozen until someone wires `dashboard_users` → `contacts.wl_user_id` (and similarly for workshops). The sync only feeds CEO-dashboard reads.

### Follow-ups Jacob should decide on
- **Fix the core_app dedup bug** — one-day work, restores S3 sync. Worth doing soon since `dashboard_diagnostics`/`dashboard_users` are 9 days stale.
- **Wire `dashboard_*` → `contacts`/`companies`** if we want the WL-app status fields to stay fresh (`wl_user_id`, `app_role`, `user_plan_type`, `customer_status`, `wl_workshop_id`, etc.). Otherwise the 333 contacts with `wl_user_id` will drift.

### Build / lint / tsc / tests
- `npm run lint` clean
- `npx tsc --noEmit` clean (after `rm -rf .next/` to clear stale validator types from the deleted routes)
- `npm run build` green; route table no longer lists `/prospector` or `/settings/ai-filter`

---

## Session: UX bundle — rename route, hide Prospector, lead-status dropdown + contact taxonomy audit (PR #172)
- **Date:** 2026-05-11
- **PR:** #172 (squash `508ca29`)
- **Branch:** `feature/rename-route-prospector-leadstatus`

### What changed
Three small UX changes from Jacob plus a one-off research deliverable.

1. **Inline route rename.** PATCH `/api/routes/[id]` accepts `cluster_label` (trimmed, 1–200 chars). Route detail header is click-to-edit: title turns into an input, Enter saves, Escape cancels. Optimistic local update.
2. **Prospector relocated.** Removed `/prospector` from the sidebar nav (Search icon import dropped too). Added an "Other tools" footer section at the bottom of `/settings` with a card linking to it. The page itself is untouched.
3. **Lead-status filter is a dropdown.** Replaced the standalone pill-tab row on `/contacts` with a MultiSelect joined to the other filters. `LEAD_STATUS_TABS` → `LEAD_STATUS_OPTIONS` (MultiSelectOption shape). One uniform filter row.
4. **Contact taxonomy audit** delivered to Jacob in-thread (not committed). Mapped every enum field on `contacts` + the joined `companies` fields visible from `/contacts`, with code-side writer/reader call sites *and* prod row counts pulled via service-role supabase-js. Findings: several enum values are documented but never written (`status.archived`, `lead_status.engaged`, `lead_status.unqualified`, `email_status.unverified`, `companies.lifecycle_stage.reactivation`, `companies.customer_status.paused`/`.churned`), `seniority` is 100% null, and the Prospector add-contacts endpoint writes `source: "prospector"` while the `/contacts` filter dropdown lists `"prospeo"` — those don't match.

### Files changed (code)
- `src/app/api/routes/[id]/route.ts` — PATCH accepts `cluster_label`
- `src/app/(dashboard)/routes/[id]/page.tsx` — `editingName` / `nameDraft` state, save/cancel handlers, inline-edit input in header
- `src/components/sidebar.tsx` — removed `/prospector` nav item + Search icon import
- `src/app/(dashboard)/settings/page.tsx` — new "Other tools" section with Prospector link card
- `src/components/contacts/contacts-page-client.tsx` — pill row gone, `LEAD_STATUS_OPTIONS` MultiSelect added at the head of the filter row

### Build / lint / tsc / tests
- `npm run lint` clean
- `npx tsc --noEmit` clean
- `npm run build` green (PATH=/opt/homebrew/bin per the Node-bindings memory)

### Parallel-session note
Session started while another CC session was mid-flight in the same checkout (the Hans manual-outreach import + `last_visited_at` work, eventually shipped as PR #170 + #171). First attempt at these edits got silently reverted by the parallel session. Stood down, waited for the other PRs to merge, then restarted from a fresh branch off the new main. No overlap on touched files between the two sessions.

### Follow-ups for Jacob to decide
- **Source value mismatch.** Prospector writes `source: "prospector"`; filter dropdown expects `"prospeo"`. If Prospector contacts ever get added, they'll be invisible via the source filter. Pick one canonical value and rename either the writer or the option.
- **Dead enum values.** Decide whether to strip the never-written values from the UI option lists (`status.archived`, `lead_status.engaged`, `lead_status.unqualified`, `email_status.unverified`, `companies.lifecycle_stage.reactivation`, `companies.customer_status.paused|churned`) — or keep them as forward-looking placeholders.
- **`contacts.seniority` is 100% null in prod (10,554 rows).** The field exists, the detail page lets you type into it, no automation writes it. Either drop the column or wire some source for it (Prospector enrichment?).
- **`tags` is free-form** — no enforcement, no UI for editing other than CSV import + Discovery promote (which always writes `["owner"]`). If we want tag governance we'd need a tag picker.

---

## Session: Import Hans's manual outreach + wire `last_visited_at` into Field Routes (PR #170)
- **Date:** 2026-05-11
- **PR:** #170 (squash `5047ba1`)
- **Branch:** `feature/import-hans-manual-outreach`
- **Source data:** `_inbox/wrenchlane_verkstadsmail_2025-2026.xlsx` (Hans's Gmail outreach ledger, 82 threads, 2025-03 → 2025-11)

### What was built

**Migration** `20260511000000_last_visited_at.sql` — adds `companies.last_visited_at` and `contacts.last_visited_at` (timestamptz, nullable). Indexed on companies (workspace_id, last_visited_at DESC). Applied directly to prod via psql.

**Field Routes Phase 5 wiring** (`src/lib/routes/generate.ts`) — `fetchMostRecentVisits` now accepts an optional `directVisits` map and folds `companies.last_visited_at` in with `route_stops.visited_at`, taking MAX. Both candidate-pool queries select `last_visited_at` and pass it through. Signature-compatible; 56/56 route tests green.

**Import script** `scripts/import-hans-outreach.mjs` — reads `scripts/data/hans-manual-outreach.json`, classifies rows (cold / mid_stage / late_stage / customer), upserts companies (domain → name fallback → INSERT with unique-violation retry that nulls the domain), contacts (by email), and one `activities` row per thread. Tags `manual-outreach-2025` cohort-wide + `hot-replied-2025` on the 7 replied threads. `--dry-run` (default) / `--apply`. Idempotent on re-run.

### Production landed

- **79 contacts** + **79 companies** + **81 activity notes** tagged `manual-outreach-2025`
- **7 hot-replied** contacts tagged `hot-replied-2025`
- **2 customers** flagged (`info@pbz.se` — Arash, PBZ AB Uppsala; `avvologjanin@gmail.com` — Anton, Mekonomen Södermalm) → `lead_status=customer`, `customer_status=active`, `lifecycle_stage=paying`

### Notable decisions

- **`lead_status` constraint reality vs CLAUDE.md.** The DB check accepts only `new | contacted | qualified | customer | churned`. CLAUDE.md documents `engaged`/`unqualified` but those are NOT in the constraint. Mid-stage and late-stage replied threads both map to `qualified`; funnel detail carried by `lifecycle_stage` (mql vs sql) and the `hot-replied-2025` tag.
- **Domain collision in chains** (Speedy Bilservice has 25 branch rows sharing one domain). Approach: first row to claim the domain wins via INSERT; subsequent rows that 23505 on insert retry with `domain=NULL` so the branch lands as its own company record. UPDATE path never overwrites an existing domain.
- **Activity notes, not `contacts.notes` overwrite.** One `activities` row per thread (type=note, metadata.source=`hans-manual-outreach-2025`, metadata.thread_date) preserves Hans's free-text summaries without trampling existing CRM annotations.

### Follow-ups

- **Pre-existing duplicate contacts in CRM** — `huddingesyd@mekonomenbilverkstad.se` and `tyreso@mecabilservice.se` each have two rows in `contacts` with the same email and workspace. Both got tagged by this import; the script's `fetchExistingContacts` Map collapses on email so the second copy's tags arrive on the SECOND-fetched contact, not whichever the rest of the system considers canonical. Worth a generic dedupe pass.
- **Sheet 3 ("Körningar med Magnus")** intentionally skipped — it's route-level data (date + area + Maps URL + workshop count) with no individual workshop names, so per-workshop `last_visited_at` can't be derived from it. Sheet 1's `Datum` is the visit-date proxy and IS workshop-specific.
- **`scripts/diagnose-min-interval-column.mjs`** still untracked in working tree (left over from a prior session — flagged in PR #152 notes already). Not this session's to claim.

### Parallel-session note

Mid-session a `git stash pop` surfaced 5 modified files (sidebar.tsx, contacts-page-client.tsx, routes/[id]/page.tsx, settings/page.tsx, api/routes/[id]/route.ts) from another CC session on branch `feature/route-rename-sidebar-leadstatus`. Those edits removed `/prospector` from the sidebar but left a dangling `LEAD_STATUS_TABS` ref that breaks the build. Stashed locally under `parallel-session-wip-not-mine (rescued by import-hans-outreach session 2026-05-11)` for that session to recover.

### Build status

- `npm run build` green (Webpack — Codex.app Node + Turbopack native-bindings issue is pre-existing on this machine)
- `npm run lint` clean
- `npx tsc --noEmit` clean
- Vercel auto-deploy: 307 on `/` post-merge (expected auth redirect)

---

## Session: Field Routes — pre-generation filter dropdown + drop `(cold)` label suffix (PR #168)
- **Date:** 2026-05-11
- **PR:** #168 (squash `<see git log>`)
- **Branch:** `feature/route-filters-and-label-cleanup`

### What changed
Jacob spotted that route labels read "Södertälje (cold)" with a `COLD` pill right next to it — redundant. Also asked for a multi-select filter to prune the candidate pool before generation.

**Filter dropdown** (the bigger half):
- New "Filter out" button on `/routes` next to Where? / For when?. Popover with checkboxes, click-outside closes, count badge on the trigger.
- Four filter keys (all whitelisted server-side):
  - `exclude_already_emailed` — drop companies whose any contact has `email_queue.sent_at IS NOT NULL`
  - `exclude_never_emailed` — include-only filter: keep only emailed companies (the inverse)
  - `exclude_replied` — drop companies whose any contact has `contacts.last_contacted_at IS NOT NULL`
  - `exclude_has_account` — drop companies with `wl_workshop_id IS NOT NULL` (already onboarded as app workshops)
- `generateRoute()` accepts `filters: CandidateFilterKey[]`. New `applyCandidateFilters` runs after `fetchEnrichedPool` — pre-fetches the relevant exclude/include company-id sets (chunked `.in()` at 200 per PR #99 pattern) and prunes the pool before clustering.
- Stacking opposing filters (already_emailed + never_emailed) collapses pool to empty by design; the user owns that choice.

**Label cleanup**:
- Dropped `decorateLabelWithMode` from `generate.ts` (only caller). `cluster_label` now stored as plain stop-aware label.
- Deleted the function from `cluster-label.ts` + its test cases (only caller was generate).
- Both `/routes` index and `/routes/[id]` strip any trailing ` (cold)`/`(lapsed)`/`(mixed)` suffix via `cleanLabel()` at render time so legacy rows show clean without a DB mutation. (Auto-mode classifier blocked the prod UPDATE — fair, since the DB rows are append-only by default and a display strip has zero blast radius.)

### Files changed
- `src/lib/routes/generate.ts` — `CandidateFilterKey` type + 4 fetchers + `applyCandidateFilters`; removed `decorateLabelWithMode` import/call
- `src/lib/routes/cluster-label.ts` — deleted `decorateLabelWithMode`
- `src/lib/routes/cluster-label.test.ts` — removed the 3 stale `decorateLabelWithMode` cases
- `src/app/api/routes/generate/route.ts` — accepts `filters: unknown` in body, validates via `parseFilters` against `CANDIDATE_FILTER_KEYS`, forwards
- `src/app/(dashboard)/routes/page.tsx` — `FILTER_OPTIONS`, dropdown UI with click-outside close, count badge, POST body includes `filters`, `cleanLabel()` on render
- `src/app/(dashboard)/routes/[id]/page.tsx` — `cleanLabel()` on the detail header

### Migration
None. DB rows still carry the old ` (cold)` suffix for routes generated before this PR — the UI strips it. New routes save clean. If we ever want to actually mutate the rows: `UPDATE daily_routes SET cluster_label = regexp_replace(cluster_label, ' \((cold|lapsed|mixed)\)$', '')` — currently blocked by auto-mode classifier.

### Build / lint / tsc / tests
- `npx tsc --noEmit` clean
- `npm run lint` clean
- `npm run build` green
- `npx vitest run src/lib/routes/` — 9 files, 56 tests passing (down from 59 because 3 stale `decorateLabelWithMode` cases were removed)

### Deploy verification
- `https://crm-for-saas.vercel.app` — Vercel auto-deploys on push to main.
- Jacob to visually verify: clean labels on `/routes`, filter dropdown opens, generation with one or more filters selected still succeeds (or returns `no_eligible_cluster` with a clear reason).

### Notable decisions
- **Display-time strip, not DB backfill.** Pure display concern; new routes already save clean; reversible.
- **Include-only filter compose path** for `exclude_never_emailed`. Treated as an intersection: if both `already_emailed` and `never_emailed` are selected, the pool collapses to empty rather than silently picking one. Predictable.
- **No "paying customers" filter exposed** — `fetchEnrichedPool` already excludes them by default via the subscription_status / customer_status WHERE clauses. Adding a redundant toggle would be confusing.
- **Suffix strip lives in two places** (index and detail). Could be hoisted to a shared util in `src/lib/routes/`, but two callers is the bar where I'd usually inline.

### Follow-ups
- Once Hans has run generation with filters a few times, capture diagnostics to see which filters change the pool size most.
- Consider exposing the filter selection on each generated route (so a viewer knows it was filtered by "exclude_already_emailed" etc.) — currently filters aren't persisted with the route.
- Pre-existing untracked `scripts/diagnose-min-interval-column.mjs` is still in the worktree — unchanged this session.

---

## Session: Field Routes — list under map, per-stop email status, 10-stop cap, auto-replace on remove (PR #166)
- **Date:** 2026-05-11
- **PR:** #166 (squash `3f9d2ec`)
- **Branch:** `feature/route-planner-revamp`

### What changed
Route detail page revamp driven by Jacob's field-rep feedback. Five things:

1. **Layout** — switched from a 5-col grid (map left, narrow list sidebar right) to a vertical stack: full-width map on top, full-width stop list below. Each row now has horizontal room for richer info instead of cramped truncation.
2. **Per-stop email status** — `GET /api/routes/[id]` now resolves `last_emailed_at` for each stop by walking `company_id → contacts → email_queue.sent_at`, taking the MAX across all contacts at the company. Chunked `.in()` at 200 per PR #99 pattern. Helper lives at `src/lib/routes/email-status.ts`. UI renders an emerald `Emailed Xd ago` pill or a muted `Never emailed` pill (date-fns `formatDistanceToNow`). discovered_shop-only stops always show "Never emailed" since they have no contacts yet.
3. **Company profile link** — each row with `company_id` gets a "Profile ↗" link to `/companies/{id}` opening in a new tab. discovered_shop-only rows skip the link.
4. **10-stop hard cap (was 12)** — Jacob noted Google Maps web Directions URL only accepts start + 10 waypoints. `MAX_STOPS_PER_ROUTE` drops from 12 → 10 in `src/lib/routes/generate.ts`. `MAX_STOPS` in the page drops to match. The deeplink builder now defensively slices to `MAX_GOOGLE_MAPS_WAYPOINTS = 10` so any pre-existing 11–12-stop routes still produce a usable URL.
5. **Auto-replace on remove** — when the user removes a stop from a route that was at the 10-stop cap, the existing Add-Stop sheet auto-opens (toast switches to "Stop removed — pick a replacement"). The Add-Stop sheet already had a Suggested tab keyed off centroid distance, so no new endpoint needed for v1. If route was below cap, behavior is unchanged.

### Files changed
- `src/lib/routes/email-status.ts` (new) — `fetchLastEmailedByCompany()` helper
- `src/lib/routes/generate.ts` — `MAX_STOPS_PER_ROUTE` 12→10, added `MAX_GOOGLE_MAPS_WAYPOINTS = 10`, deeplink slice
- `src/app/api/routes/[id]/route.ts` — call the helper, decorate stops with `last_emailed_at`
- `src/app/(dashboard)/routes/[id]/page.tsx` — layout swap (vertical stack), `MAX_STOPS` 12→10, container width `max-w-6xl` → `max-w-7xl`, `Stop` type + `ReorderStop` mapping gain `last_emailed_at`/`companyId`/`discoveredShopId`, `submitRemove` auto-opens AddStop sheet when `stops.length >= MAX_STOPS` pre-removal
- `src/components/routes/stops-reorder-list.tsx` — `ReorderStop` type extended, row layout widened (`px-4 py-3` instead of `px-3 py-2.5`), added Emailed/Never-emailed pill (md+ only) and Profile link, default `maxStops` 12→10

### Migration
None.

### Build / lint / tsc / tests
- `npm run lint` — clean
- `npx tsc --noEmit` — clean (after clearing stale `.next/`)
- `npm run build` — green (had to prepend `/opt/homebrew/bin` to PATH; Codex.app Node breaks Turbopack native bindings, see memory `reference_node-codex-vs-brew.md`)
- `npx vitest run src/lib/routes/` — 9 files, 59 tests, all passing (including the previously-flaky `generate.test.ts`)

### Deploy verification
- `curl -I https://crm-for-saas.vercel.app` → 307 (auth redirect, expected)
- Visual smoke not done — Jacob to verify the layout, emailed pill, and replace-on-remove flow against a real route on prod.

### Notable decisions
- **Email status is per-company, not per-contact.** A company can have many contacts; rolling up to MAX(`sent_at`) across all of them gives "has this workshop been emailed" semantics, which is what Jacob asked for.
- **Used `email_queue.sent_at`, not `contacts.last_contacted_at`.** The latter is only updated by the reply-check cron (so it would mean "has replied"), not the send pipeline. `email_queue.sent_at` is the true "we sent something" signal.
- **Legacy routes with >10 stops keep rendering**, but their Maps deeplink truncates to the first 10 waypoints. No auto-trim of stored rows — Hans can hit remove if he wants. Since Field Routes Phase 1 only shipped 2026-05-07, the pool of >10-stop routes is small or empty.
- **Replace-on-remove uses existing nearby-suggestions endpoint** (centroid distance only). Could be upgraded later to use the Phase 5 stop-score for richer ranking, but Jacob's wording ("fits in the route") doesn't demand it for v1.

### Follow-ups
- Visual QA on prod once Jacob opens a route detail page.
- If Hans finds the centroid-only suggestion ranking too coarse, port the Phase 5 stop-score into `/api/routes/[routeId]/suggestions` so ranking factors in freshness, quality, and outreach restraint, not just distance.
- Pre-existing untracked `scripts/diagnose-min-interval-column.mjs` still sits in the worktree from an earlier session — left alone here.

---

## Session: CEO dashboard — manage internal-test exclusions from /ceo/settings (PR #164)
- **Date:** 2026-05-08
- **PR:** #164
- **Branch:** `feature/internal-test-users-db`

### What changed
The internal-test exclusion list (14 users · 8 workshops · 6 emails · 4 usernames) used to live as static const arrays in `src/config/ceo/internal-test-users.ts`. Edits required a code change + redeploy. Moved into the database with a manage UI on `/ceo/settings`, and added Internal pills + a Show internal toggle on the workshop views so flagged entities are visible (not just silently filtered).

### Schema (already applied to prod via psql)
`supabase/migrations/20260508010000_internal_test_users_db.sql`
- `dashboard_users` adds: `is_internal_test`, `is_internal_test_exempt`, `internal_test_note`, `internal_test_set_at`, `internal_test_set_by`
- `dashboard_workshops` adds: `is_internal_test`, `internal_test_note`, `internal_test_set_at`, `internal_test_set_by`
- New `dashboard_internal_test_patterns(kind, value, note)` with unique index on `(kind, lower(value))` for the email/username fallback patterns
- Backfilled from the prior static config — verified post-migration: 14 / 3 / 8 / 6 / 4

### Runtime architecture
`src/lib/ceo/internal-test/loader.ts` is the new source of truth.
- `loadInternalTestSets()` is wrapped in React `cache()` so every render pays a single Supabase round-trip
- The data layer (`new-users.ts`, `workshops.ts`, `app-usage.ts`) and the core_app sync (`buildDiagnosticsMetrics`, `buildDiagnosticChatMetrics`) load the sets at the entry point and pass them down to pure per-row filters — keeping row-level checks synchronous
- Public helpers expose a `*With` suffix (`isInternalTestUserOrWorkshopWith(sets, ...)`) to make the dependency on preloaded sets explicit
- `searchDashboardUsers(q)` / `searchDashboardWorkshops(q)` for the settings UI run an ILIKE across name/id/note/customer_io_id
- `listInternalTestPatterns()` for the Patterns tab

The static `src/config/ceo/internal-test-users.ts` is deleted. No backwards-compat shim.

### UI
- `/ceo/workshops` list — `Internal` pill on flagged workshops (yellow), `Show internal` checkbox in filter bar threads `?showInternal=1` through `getWorkshopDrilldownList({ includeInternal: true })`
- `/ceo/workshops/[id]` — pill in header, plus per-member `Internal` (yellow) and `Exempt` (green) pills
- `/ceo/settings` — two top-level tabs (Playbook / Internal-test exclusions). Internal tab has sub-tabs Users / Workshops / Patterns, search bar, mark-internal/mark-exempt toggle buttons per row, and "add by ID" forms for flagging users/workshops not yet synced
- `/ceo/app-usage` exclusion panel is now DB-driven and links to `/ceo/settings` instead of pointing at the deleted source file

### Server actions
`src/app/(ceo)/ceo/settings/actions.ts` — `setUserInternalAction`, `setUserExemptAction`, `setWorkshopInternalAction`, `addPatternAction`, `removePatternAction`. Each action uses Zod schemas, upserts via the service-role client, and calls `revalidatePath()` for `/ceo/{settings,workshops,new-users,app-usage}` so flag flips propagate immediately.

### Build / lint / tsc
- `npm run build` green
- `npm run lint` green
- `npx tsc --noEmit` green
- `npm run test:e2e:smoke` blocked on the pre-existing `/api/routes/[id]` vs `/api/routes/[routeId]` slug-name conflict from PR #150 — unrelated to this change

### Deploy verification
- Vercel `x-vercel-id: arn1::zkcjg-1778245779641-c39b45848859`
- `/ceo/settings`, `/ceo/workshops`, `/ceo/app-usage` all return 307 (auth redirect, expected)

### Notable decisions
- **No backwards-compat shim** for the deleted static file. Helper signatures changed (`isInternalTestUserOrWorkshop` → `isInternalTestUserOrWorkshopWith(sets, ...)`) so all 5 consumers got migrated in one pass; reverting would require re-introducing the const data
- **`getWorkshopDetail()` always includes internal** — a workshop detail page should show the requested workshop regardless of its flag. The `Show internal` toggle only governs the *list*
- **Patterns are stored lowercased** to match the unique index on `(kind, lower(value))` and the loader's case-insensitive lookup. The add form lowercases on insert
- **The `Add by ID` form upserts** so a flagged user/workshop doesn't have to exist in `dashboard_users` / `dashboard_workshops` yet (e.g. flagging an internal user before user_stats sync runs)
- **Migration-only orphan file** `scripts/diagnose-min-interval-column.mjs` left untracked (carried over from a prior session — unrelated)

### Follow-ups
- The `internal_test_set_by` column exists but isn't populated — the (ceo) layout doesn't currently expose the actor email to server actions. Add when the auth context is wired up
- E2E coverage for the new toggle + manage UI flows
- Consider auto-triggering a `core_app` sync after a flag flip (today's only refreshes the read-side; the metric snapshots persisted in `dashboard_metric_snapshots` still reflect the pre-flip count until the next sync run)

---

## Session: Contacts page — customizable columns (PR #162)
- **Date:** 2026-05-08
- **PR:** #162
- **Branch:** `feature/contacts-customizable-columns`

### What changed
A "Columns" button in the contacts header opens a SlideOver where the user toggles which columns are visible and drags the visible ones to reorder. Layout persists per workspace in localStorage (`crm-contacts-columns:<workspaceId>`).

17 columns total. Default-on (7): Name · Email · Phone · Company · Country · Lead status · Created. Default-off (10): Title · Contact status · Email status · Source · Lifecycle · Customer status · App user · Tags · Last contacted · Updated.

The 4 company-side columns (Lifecycle · Customer status · App user · existing Company name) come from extending the existing contacts→companies join projection — `companies(name, lifecycle_stage, customer_status, wl_workshop_id)` instead of just `companies(name)`. One-shot select extension; columns hidden = field unread.

### File split
- `src/components/contacts/column-config.ts` — column universe (`COLUMNS`, `DEFAULT_COLUMN_IDS`, `COLUMN_BY_ID`), localStorage helpers (`loadColumnIds`, `saveColumnIds`).
- `src/components/contacts/column-customizer.tsx` — SlideOver with `@hello-pangea/dnd` drag-reorder of visible cols + click-to-show on hidden.
- `contacts-page-client.tsx` — added `columnIds` state, dynamic `<thead>` (loops the visible ids; sortable cols still use `SortableTh`), dynamic `<tbody>` cells via `renderCell(id, contact)` switch, `colSpan` follows visible count, plus the "Columns" trigger button in the page header.

### Build/deploy
`npm run build` · `npm run lint` · `npx tsc --noEmit` all green. Squash-merged via `gh pr merge 162 --squash`. Vercel auto-deployed; fresh `x-vercel-id` confirmed.

### Notable decisions
- **Persistence is localStorage, not a DB row.** Per-user-per-browser is sufficient for v1; promote to a `user_preferences` table only when multi-device drift becomes annoying. Falls back to defaults on parse failure or absent value, so a corrupt cache can never brick the page.
- **Extended select projection unconditionally** — the alternative (dynamically grow the projection only when the company-derived columns are visible) saves a few bytes but makes `fetchContacts` deps churn on column-config changes. The extra columns are tiny.
- **Sortable headers loop the visible columns**, falling back to plain `<th>` for non-sortable joined / derived cells (Lifecycle, Customer status, App user, Tags, Title, Contact status, Email status, Source — all currently `sortable: false`). Wiring sort for the joined company columns is the next bite if Hans asks.

### Follow-ups
- Per-column width drag-resize.
- Frozen first column on horizontal scroll once tables get wide.
- Server-side persistence (per-user DB row) — defer.

---

## Session: Contacts page — drop language filter + sortable headers (PR #161)
- **Date:** 2026-05-08
- **PR:** #161
- **Branch:** `feature/contacts-sortable-columns`

### What changed
Two unrelated tweaks bundled because they touched the same area:

1. **Removed the Language multi-select.** Not used in practice — contact language is implied by country for the markets we target. Dropped `LANGUAGE_OPTIONS`, `filters.language`, the server-side `language` field on `ContactFilters`, and its clauses in `resolveContactIdsByFilters`.

2. **Clickable sortable column headers.** Click any header to sort. Same column → toggles asc/desc. Different column → switch with a sensible default (`asc` for text, `desc` for `created_at`). Hover affordance shows a faint chevron on inactive columns; active column shows the solid direction icon. `aria-sort` lives on the `<th>` (not the `<button>`) so screen readers report column state correctly.

Sort key → query mapping:
- `name` → `last_name` primary + `first_name` secondary (surname-first)
- `email` → `email`
- `phone` → `phone`, nulls last
- `company` → `companies.name` via `foreignTable: 'companies'`
- `country` → `country`, nulls last
- `lead_status` → `lead_status`
- `created_at` → `created_at` (default desc)

### Build/deploy
Build / lint / tsc green. Squash-merged via `gh pr merge 161 --squash`. Vercel auto-deployed.

### Notable decisions
- **Surname-primary on the Name sort.** Most CRM users sort by last name. First-name secondary to keep it stable when surnames match.
- **Sort state is local to the page**, not URL-bound — matches the existing filter pattern. URL persistence is a separate ask if it ever becomes useful.

### Mid-session glitch
Two sessions ran in parallel against the same working tree. My commit landed on local main twice instead of the feature branch (the parallel session checked out their own branch in between). Each time, recovered by `git update-ref` to relocate my commit to the correct feature branch and reset `main` to `origin/main` — non-destructive, no work lost. Worth flagging that running parallel CC sessions in the same repo working tree is dicey; one-checkout-per-session would have avoided the dance.

---

## Session: Contacts page — multi-select filters + new status filters (PR #156)
- **Date:** 2026-05-08
- **PR:** #156
- **Branch:** `feature/contacts-multi-select-filters`

### What changed
Every dropdown on the contacts page is now multi-select, and four new status filters are exposed (the ones surfaced by the company-detail Statuses tab from PR #155).

**Multi-select everywhere:**
- Lead status pill row: was single-select with an "All" pill the only way to clear. Now multi-toggle. New pills: Engaged, Unqualified (matching the schema enum).
- Country, Email status, Source, Contact status: `<select>` → MultiSelect popover.

**Four new filters (not previously exposed):**
- Language (sv / no / da / fi / et / lv / lt / en) — *removed in PR #161, not used in practice*
- Lifecycle stage — joined via `companies.lifecycle_stage`
- Customer status — joined via `companies.customer_status`
- Has app account — `yes` / `no`, joined via `companies.wl_workshop_id`

The three company-joined filters use a `!inner` join only when active, so contacts without a company aren't silently dropped from unrelated queries.

### File split
- `src/components/ui/multi-select.tsx` — new UI primitive: popover with checkboxes, search input when ≥6 options, click-outside to close, clear button on the trigger when populated.
- `src/lib/contacts-filter.ts` — `ContactFilters` extended; `resolveContactIdsByFilters` accepts both `string[]` (new) and `string` (legacy) on every multi-select field. Bulk-action API routes need no change — they pass through.
- `contacts-page-client.tsx` — `LocalFilters` shifted to arrays, `currentFilters` mapping rebuilt, `fetchContacts` query rewired with `.in()` calls and the optional `companies!inner` projection.

### Build/deploy
Build / lint / tsc green. Squash-merged + Vercel auto-deployed.

### Notable decisions
- **Legacy single-string acceptance on the server-side resolver** keeps any in-flight bulk-action requests from old client builds working through the deploy. Cheap insurance.
- **`!inner` join only when company-side filters are active** — using it unconditionally would silently drop contacts without a company from every list view.

---

## Session: Company detail — Statuses tab (PR #155)
- **Date:** 2026-05-06
- **PR:** #155
- **Branch:** `feature/company-statuses-tab`

### What changed
A new "Statuses" tab between Deals and Subscriptions on the company detail page. Six concept cards, one per status field tracked on a company. Each card lists every canonical value as a pill — the one(s) currently set on the record keep their hero-color (paying = emerald, churned = red, customer = emerald, etc.); the rest go slate-grey with a thin border so they read as "possible but not set."

Concepts shown:
- Has app account (`companies.wl_workshop_id`) — yes / no
- Lifecycle stage — `lead` / `mql` / `sql` / `trial` / `paying` / `churned` / `reactivation`
- Customer status (operational) — `trialing` / `active` / `paused` / `inactive` / `churned`
- Payment status (Stripe) — `paid` / `past_due` / `unpaid` / `failed` / `incomplete`
- Subscription status (Stripe) — `active` / `trialing` / `past_due` / `canceled` / etc.
- Outreach status (derived from `contacts.lead_status`, aggregated)

### File split
- `src/components/companies/detail/statuses-tab.tsx` — pure presentation component, takes `company` + `outreachStatus` props.
- `detail/types.ts` — added `'statuses'` to the `TabId` enum.
- `detail/tabs.tsx` — new tab in the bar, dispatches to `<StatusesTab />`.
- `company-detail-client.tsx` — passes `company` + `outreachStatus` to `<CompanyTabs />`.

### Build/deploy
Build / lint / tsc green. Squash-merged + Vercel deployed.

### Notable decisions
- **Pill colors mirror the hero badges.** A user can match the active pill in the Statuses tab to the corresponding badge in the hero — same color = same concept = same value.
- **Stripe-side fields surface unknown values as a "(custom)" amber pill.** Stripe webhook strings can drift from any canonical list; better to render them than drop them silently. Visible drift is the point of the tab.

---

## Session: Company detail — quick actions + status badges (PR #154)
- **Date:** 2026-05-06
- **PR:** #154
- **Branch:** `feature/company-detail-quick-actions`

### What changed
The hero buttons added in PR #139 only switched tabs — they were stubs. Wired all three to real flows and added status badges that answer "have an account / paying / contacted":

- **Add Contact** → SlideOver mini-form (first/last/email/phone/title/lead_status), `company_id` locked. Inserts into `contacts`, writes a `contact_created` activity, refreshes the contacts list, switches to Contacts tab.
- **Add Deal** → SlideOver wraps the existing `AddDealForm`. Fetches the workspace's first pipeline on open, prefills `company_id`, hides the picker. Refreshes deals on save and switches to Deals tab.
- **Log activity** → Modal with a 4-button type selector (Note / Call / Meeting / Email logged), subject + body, optional contact-link dropdown. Writes to `activities` and switches to Activity tab.
- **Hero badges** — replaced the old "lifecycle / customer / category / industry" set with: **App user** (violet, when `wl_workshop_id` is set) vs **Prospect** · **Lifecycle stage** · **Customer status** (when distinct) · **Outreach** (derived) · Category · Industry.
- **Outreach status** is the derived signal. Aggregates per-contact `lead_status` into one priority-ranked label: customer > churned > qualified > engaged > contacted > unqualified > not_contacted.

### File split
- `detail/add-contact-modal.tsx` · `detail/add-deal-modal.tsx` · `detail/log-activity-modal.tsx` — three new modal components scoped to the company-detail flow.
- `detail/status.ts` — `deriveOutreachStatus()` + `OUTREACH_LABEL` / `OUTREACH_COLOR` maps. Pure logic, no React.
- `detail/hero.tsx` — `Badges` rewritten to take an `outreachStatus` prop and render the new set.
- `company-detail-client.tsx` — added `addContactOpen` / `addDealOpen` / `logActivityOpen` state, narrow refetch helpers (`refetchContacts`, `refetchDeals`, `refetchActivities`) so the modals can refresh just what they touched without re-running the full page-load.
- `deals/add-deal-form.tsx` — gained optional `defaultCompanyId` + `hideCompanyPicker` props so the form is reusable from the company-detail context. No change at the existing call site.

### Build/deploy
Build / lint / tsc green. Squash-merged + Vercel deployed.

### Notable decisions
- **Per-modal narrow refetch instead of one big page reload.** Adding a `refreshKey` dep on the existing `load()` useEffect would have flickered the whole page (`setLoading(true)` early in `load`). Wrote three small helpers that update only the affected slice + activities, since activity rows reference contacts/deals.
- **Outreach is priority-aggregated, not max-progression.** "Churned" outranks "Qualified" because it's the more important state to surface — the company has someone who explicitly walked away. "Customer" still wins overall.
- **`AddDealForm` extended in place rather than forked.** Two optional props is cheaper than maintaining two near-identical forms.
- **Activity `body` column** — `contact-detail-client.tsx` writes notes/calls into a `description` field that doesn't exist on `activities` (the column is `body`). Pre-existing bug, not fixed in this PR. Flagged as a follow-up. New code in this PR uses `body` correctly.

### Follow-ups
- Fix the `description` → `body` bug on contact-detail-client note/call adds.
- "Add Deal" assumes one pipeline per workspace (uses `.limit(1)` on first-by-`created_at`). If multi-pipeline workspaces become real, surface a pipeline picker.

---

## Session: Enrollment guardrail for already-sequenced contacts
- **Date:** 2026-05-08
- **PR:** #159
- **Branch:** `feature/enrollment-guard-already-sequenced`
- **Builds on:** #157 (Lemlist CSV cohort tagging)

### What was built

`enrollContacts()` now skips any contact whose `tags` array overlaps `ALREADY_SEQUENCED_TAGS` (currently `['lemlist-csv']`). The guard is bypassable via a new `allowAlreadySequenced` param. Result shape gains a typed `skippedAlreadySequenced: number` so callers don't have to parse `reasons[]` to render "X excluded".

**Bypass policy:**

| Surface | Default |
|---|---|
| `/api/sequences/enroll` | block (override accepted via request body) |
| **Add Contacts to Sequence** modal | block; checkbox to include |
| **Enroll List** modal | block; checkbox to include |
| **Field Routes — `logVisit`** | bypass (post-visit followup is deliberate re-engagement) |
| Single-contact "Enroll in sequence" modal | block, no toggle yet (follow-up) |
| Launch Campaign modal | block, no toggle yet (follow-up) |

### Notable decisions

- **Field Routes bypasses the guard.** When Hans visits a Lemlist-cohort shop and the outcome triggers auto-followup, that's deliberate re-engagement — not the double-send the guard exists to prevent. Without the bypass, the auto-followup would silently no-op for the most-likely-to-need-it cohort.
- **Bypass is per-call, not per-contact.** I considered "remove the tag from the contact to permanently allow enrollment" as the override mechanism, but a transient flag is more flexible — Hans can enroll the cohort once for a follow-up campaign without losing the historical signal. The tag stays.
- **Two modals updated, two skipped.** Bulk enrollment paths (Add Contacts, Enroll List) are where the cohort would actually be touched; single-contact and launch-campaign modals are lower-volume and can get the same toggle in a follow-up.
- **Tag list is hardcoded for now.** `ALREADY_SEQUENCED_TAGS = ['lemlist-csv']`. A workspace-level setting would be cleaner long-term but overkill for a single tag.

### Build / verify

- `npx tsc --noEmit` green
- `npm run build` green
- Backfill from PR #157 (765 contacts tagged `lemlist-csv`) is still in prod, so the guard immediately protects them.

### Follow-ups

- **Add the toggle to the single-contact "Enroll in sequence" and launch-campaign modals** — they currently default-block but offer no UI override.
- **Consider a workspace-level tag setting** so a future workspace can use a different cohort name (`mailshake-2024`, etc.) without code change.
- **Telemetry: log how often the override fires** — useful signal for whether the default is correct.

---

## Session: Tag the Lemlist CSV cohort + add Tags filter
- **Date:** 2026-05-08
- **PR:** #157
- **Branch:** `feature/lemlist-cohort-tagging`
- **Merge commit:** `2a22a51` (squash-merged 2026-05-08 10:15 UTC)

### Problem

Hans had already sequenced ~1k Swedish workshops via Lemlist (3 emails apiece) before this CRM owned outreach. The Lemlist CSV import in March only tagged the **shop** layer (`discovered_shops.source='lemlist'`, 803 SE rows). Once those shops got promoted to companies via the discovery flow, the resulting **765 contacts** and **758 companies** had no Lemlist signal at all — they looked indistinguishable from any other discovered prospect, so anyone enrolling them in a fresh CRM sequence would silently double-send.

The contacts page Source filter dropdown was visibly only showing `Discovery` even though `'lemlist'` was already declared in `ALL_SOURCES` — because no row actually had `source='lemlist'` for the dropdown's distinct-values fetch to find.

### What was built

**1. Data backfill** — `supabase/migrations/20260508000000_backfill_lemlist_cohort.sql`. Joins `discovered_shops` (`source='lemlist'`) → `companies` → `contacts` and:
- Sets `contacts.source='lemlist'` (so the existing Source multi-select surfaces Lemlist).
- Appends `'lemlist-csv'` to `contacts.tags` and `companies.tags` (no-op if already present — idempotent).
- Copies surviving Lemlist provenance into `contacts.custom_fields.lemlist`: campaigns, owner, addedToLemlist, firstContactedDate, lastContactedDate, lastRepliedDate, isActiveInCampaigns, leadStatus. `jsonb_strip_nulls` drops empty fields.

Applied via psql before merge:
| | count |
|---|---:|
| contacts source=lemlist | 765 |
| contacts tagged lemlist-csv | 765 |
| contacts with custom_fields.lemlist | 765 |
| companies tagged lemlist-csv | 758 |

**2. Tags filter UI** — added a new MultiSelect to `/contacts`:
- `LocalFilters.tags: string[]` + `DEFAULT_FILTERS` entry.
- Paginated effect that fetches every distinct tag in the workspace and dedupes client-side (~10 round-trips for the 10k-contact workspace). `<MultiSelect allLabel="tags">` next to Has-account.
- Wired into both the client list query (`.overlaps('tags', ...)`) and the server resolver `resolveContactIdsByFilters` so select-all-matching stays consistent.
- `ContactFilters.tags` accepts `string | string[]` (PR #156 multi-select pattern). `.overlaps()` for OR-semantics.

### Notable decisions

- **Did NOT keep `contacts.source='discovery'`** for the cohort. Strict provenance would say the contact rows came from the discovery flow, not from a Lemlist CSV (Lemlist created the *shop*, not the contact). But Jacob's UX intuition matched the cohort to Lemlist directly, and the Source filter is the most natural surface — so we set `source='lemlist'`. The "discovered_shops created the row" lineage still lives in `discovered_shops.crm_company_id` if anyone needs to reconstruct it.
- **Did NOT touch `companies.source`.** It's nullable and inconsistently used today (only 269 rows have it, all `wl-app`). Tags are the cleaner company-level signal.
- **Did NOT add an enrollment-time guardrail** (refuse to enroll `lemlist-csv`-tagged contacts). That's the obvious next step — but tags + filter ship the visibility today; the guardrail can be its own PR with a confirm-override.
- **Tag fetching is paginated client-side** rather than via an RPC. With 10k contacts, ~10 round-trips on first load is acceptable, and avoids adding a SECURITY DEFINER `distinct_contact_tags(workspace)` migration just for the dropdown.

### Build / verify

- `npm run build` green
- `npm run lint` green
- `npx tsc --noEmit` green
- Prod deploy 200 (307 auth redirect on unauthenticated probe — expected)

### Follow-ups

- **Enrollment guardrail** — block (or warn-and-confirm) sequence enrollment for contacts tagged `lemlist-csv` so even if a user forgets to filter, double-sends are caught.
- **Apply the same tagging to NO/PL when those scrapes import** — the gitignored `scripts/lemlist-no-pl-history.json` (926 rows) is still waiting. When it lands, repeat the migration with the appropriate source filter.
- **Surface `custom_fields.lemlist` on the contact detail page** — campaigns/owner/dates are useful on the contact card ("Imported from Lemlist 2026-03-20, campaign Meko_Autoexperten_BDS_SE, opened email").
- **Companies page Tags filter** — the contacts page now has it; the companies page doesn't yet. Same pattern would apply.

---

## Session: Field Routes — Phase 4 (per-rep origins, PTO calendar, revisit interval, multi-rep)
- **Date:** 2026-05-07
- **PR:** #150
- **Branch:** `feature/field-routes-phase4`
- **Merge commit:** `e1d815b` (squash-merged 2026-05-07 18:33 UTC)

### What was built

Takes Field Routes from "auto-generated, then frozen" to a tool a rep can actually plan with. Five themes:

1. **Per-rep origin override** — each user can set their own start address in `/settings/profile`; routes generate from there.
2. **Working calendar + PTO** — weekly working-day toggle + ad-hoc unavailable dates; schedule-guard returns 409 with a confirm-anyway prompt for off-days.
3. **Min revisit interval** — workspace default (30d) + per-company override; the generator and the suggestions endpoint both filter recently-visited shops.
4. **Add / remove stops** — `+ Add stop` row with Suggested + Search tabs, × icon per row with a 5-reason removal modal. `wrong_location` / `not_icp` / `permanently_closed` flip `do_not_route=true` on the underlying record (the last also sets `discovered_shops.permanently_closed`).
5. **Multi-rep visibility** — `daily_routes.assigned_to`, Mine vs All toggle on `/routes`, admin-only Reassign + Generate-for dropdowns.

**Schema (migration `20260507030000_field_routes_phase4.sql`, applied to prod via Management API):**
- `user_profiles`: `origin_address`, `origin_latitude`, `origin_longitude`, `origin_geocoded_at`, `working_days JSONB DEFAULT '{...}'`
- `user_unavailable_dates` table — `(user_id, date) UNIQUE`, RLS workspace-read + self-write/update/delete
- `companies`: `min_revisit_interval_days INT NULL`, `do_not_route BOOLEAN DEFAULT false`, `do_not_route_reason`, `do_not_route_at`
- `discovered_shops`: same `do_not_route*` triple
- `daily_routes`: `assigned_to UUID FK auth.users(id) ON DELETE SET NULL`, partial index `(workspace_id, assigned_to, status, generated_at DESC)`
- Partial indexes `companies_do_not_route_idx` / `discovered_shops_do_not_route_idx` `WHERE do_not_route = true` to keep generator pool query fast.

**Backend:**
- `src/lib/routes/profile.ts` — `getUserOrigin` (user_profiles → env fallback chain), `getWorkingDays`, `isUnavailable`, `parseWorkingDays`, `dayKeyForIsoDate`. Fully unit-tested.
- `src/lib/routes/recompute.ts` — `recomputeRouteAfterMutation` helper for stop add/remove. Reads current stops in `stop_order`, calls `recomputeFixedOrder`, optionally enforces day-window with `?force=true` bypass, writes per-stop legs + `daily_routes` totals + deeplink. Empty-route fallback clears totals.
- `src/lib/routes/generate.ts` — accepts `assignedTo`, filters by `min_revisit_interval_days` (per-company override → workspace default 30d), excludes `do_not_route=true`, sets `daily_routes.assigned_to` on insert. `MIN_STOPS_PER_ROUTE`/`MAX_STOPS_PER_ROUTE` exported.
- `/api/settings/profile` (GET/POST): origin geocoded only when address changes (avoids burning the API on save-without-change). Working-days merged onto existing.
- `/api/settings/profile/unavailable-dates` (GET/POST/DELETE): self-managed PTO entries, workspace-scoped.
- `/api/routes/[id]` PATCH: schedule guard runs `isUnavailable(assigned_to ?? caller, scheduled_for)`, returns 409 with `{reason, detail}` unless `?force=true`.
- `/api/routes/[id]/assign` PATCH: admin-only, validates target is a workspace member.
- `/api/routes/[routeId]/stops` POST: refuses at MAX_STOPS, refuses duplicates by company_id/discovered_shop_id, inserts at `max(stop_order)+1`, recomputes — rolls back the insert on `exceeds_day_window` 409 if `force` is not set.
- `/api/routes/[routeId]/stops/[stopId]` DELETE: validates reason, deletes stop, recomputes (force=true since deletion only shortens), inserts `activities` row (`type='route_stop_removed'`), flips `do_not_route` per reason, sets `permanently_closed` for that specific reason.
- `/api/routes/[routeId]/suggestions` GET: nearby ICP companies ranked by Haversine distance from existing-stops centroid (or origin if route is empty); excludes already-in-route, recently-visited (per-company or workspace default), `do_not_route=true`. Returns up to 10 by default.
- `/api/routes/[routeId]/stop-search` GET: name search across workspace `companies` (any) + `discovered_shops` filtered to ICP shop_types (`auto_repair`, `tire_combo`, `auto_glass`, `auto_body`) and SE.
- `/api/routes/generate` POST: optional `forUserId` (admin-only); resolves origin in order `originOverride` → `user_profiles` → env defaults.
- `/api/routes` GET: new `?scope=mine|all` filter; mine matches `assigned_to.eq.<user>` OR `assigned_to.is.null`.

**UI:**
- `/settings/profile`: origin textarea + geocoded-coords readout, weekly working-days toggle group, PTO list with date+reason inputs.
- `/routes`: Mine vs All toggle, assignee initials chip, admin Generate-for dropdown.
- `/routes/[id]`: assignee chip + admin Reassign select; schedule 409 → window.confirm → force retry; min-stops warning banner.
- `StopsReorderList`: × icon per row → opens `RemoveStopModal` (5 reason radios + free-text notes); `+ Add stop` row → opens `AddStopSheet` (Suggested + Search tabs); above-12 collapses to "Max stops reached".
- `RemoveStopModal` (new): radio-driven reasons with per-reason hints describing the side effect (flag vs no-flag).
- `AddStopSheet` (new): two-tab modal/sheet, Suggested tab calls `/suggestions`, Search tab debounces 250ms against `/stop-search`.
- `/companies/[id]` About panel: read-only `do_not_route` callout with reason + date when set. Write path is the route-detail removal modal.
- `/discovery` rows: read-only "do not route" badge under the shop name with reason + date in the title attribute.

### Build status
- `npx tsc --noEmit` ✅
- `npm run lint` ✅
- `npm run build` ✅
- `vitest run src/lib/routes/...` ✅ 44 tests passing (added `profile.test.ts` for `parseWorkingDays` + `dayKeyForIsoDate`; extended `generate.test.ts` mock for the new `workspaces` settings + `route_stops` recent-visits reads)
- Vercel deploy: triggered by merge of #150; verified in background.

### Notable decisions
- **Geocode only on address change.** The profile POST diffs `origin_address` against the existing row before calling Geocoding; identical-address saves don't re-spend the API. Failures (no result, missing key) save the address with a `geocode_note` so the UI can toast the user.
- **`recomputeRouteAfterMutation` instead of extending the Phase-2 RPC.** Phase 2's `reorder_route_stops` plpgsql function requires the input set to match existing stops 1:1, so it can't handle deletes or appends mid-call. Did per-stop UPDATE for legs + a single UPDATE on `daily_routes`. The unique-constraint shenanigans Phase 2 needed don't apply here — adds and removes don't shuffle existing orders.
- **Add-stop-then-rollback for the day-window guard.** POST inserts the row first, then recomputes. If the recompute returns 409 and `force` is not set, the route is restored by deleting the just-inserted row. Pattern preserved the simpler "always recompute over current stops" approach instead of pre-flight optimization.
- **`getNextSender`-style sort for the empty-route case.** When the last stop on a route is removed, `recomputeRouteAfterMutation` short-circuits: zeros out totals + drive seconds + sets stop_count=0 + writes a no-waypoints deeplink (just origin → origin). Avoids calling Routes API for a degenerate route.
- **Suggestions distance is Haversine from existing-stops centroid**, not from origin. Routes drift from origin during the day; suggesting "nearby to where you'll actually be" is more useful than "nearby to home base." Falls back to origin only when stops list is empty.
- **Schedule guard has confirm-then-force, not hard-block.** The PATCH endpoint returns 409 + `?force=true` bypass; the UI always offers an override prompt. Reasoning: an admin scheduling a Saturday route is a real use case (e.g., trade show), and the rep usually knows their own calendar better than the JSON snapshot.
- **`do_not_route` on /companies and /discovery is read-only.** Canonical write path is the route-detail removal modal — keeping flag-flipping in one place avoids accidental UI-driven flag flips on a company detail page from undoing the rep's deliberate "yes, do route here, my bad" recovery (still a future phase).
- **Migration applied via Supabase Management API** (https://api.supabase.com/v1/projects/{ref}/database/query) since the harness blocked the direct pooler path. Same path Phase 1/2 used. Worth promoting that to the documented default in CLAUDE.md if the harness rules persist.

### Follow-ups (out of scope, parked)
- Optional admin "clear do_not_route flag" button on the company detail page — design says "if you have time," skipped here.
- Shared rep capacity / max routes per day per rep.
- Auto-suggest revisit dates when a shop is suppressed by interval.
- Calendar imports (Google Calendar, Outlook).
- Per-rep route templates ("Hans always does Tuesday: Stockholm South").
- Workspace-level min revisit interval is read but not yet writable from the field-visits settings UI — currently only via direct Supabase write or future settings-page extension.

---

## Session: Field Routes — Phase 3 (visit logging + auto follow-up)
- **Date:** 2026-05-07
- **PR:** #145
- **Branch:** `feature/field-routes-phase3`
- **Merge commit:** `gh pr 145 squash-merged at 16:48 UTC`

### What was built
Closes the field-route loop. From `/routes/[id]`, Hans (or any field rep) taps "Mark visited" on a stop, picks one of five outcomes in a bottom sheet (mobile) or modal (desktop), optionally adds notes, and submits. The visit becomes a permanent `activities` row + a populated `route_stops` row, and the company's primary contact gets auto-enrolled in an outcome-specific follow-up sequence — unless one of three suppression rules fires.

**Schema (migration `20260507020000_field_visit_followup.sql`, applied to prod via psql + pooler):**
- `companies.skip_auto_followup BOOLEAN NOT NULL DEFAULT false` — per-company opt-out
- `companies.do_not_contact BOOLEAN NOT NULL DEFAULT false` — set automatically on `not_interested`
- partial index `companies_skip_auto_followup_idx ON (workspace_id, skip_auto_followup) WHERE skip = true`
- Hand-edited the `companies` Row/Insert/Update in `src/lib/database.types.ts` for both columns rather than full type regen — same shortcut as PR #143's `reorder_route_stops` cast, smaller blast radius, preserves the manual-export header.

**Backend (`src/lib/routes/`):**
- `visits-decision.ts` — pure functions: `decideEnrollment`, `readFieldVisitsSettings`, `AUTO_ENROLL_DEFAULT`/`FOLLOW_UP_REQUIRED_DEFAULT` tables, `VISIT_OUTCOMES` const, `VisitOutcome` type. Zero `@/`-aliased imports so vitest runs without path-alias config.
- `visits.ts` — `logVisit({routeStopId, outcome, notes?, followUpRequiredOverride?, enrollOverride?, visitedAt?, userId, supabase})` orchestrator. Loads the stop with workspace check, runs cold-shop promotion if needed, updates `route_stops`, inserts `activities` row, sets `do_not_contact` on `not_interested`, runs the enrollment-decision tree, enrolls the primary contact via existing `enrollContacts`. Re-exports the pure-module symbols for callers that already import from `visits`.
- `src/lib/discovery/promote.ts` — new `promoteDiscoveredShop(shopId, {workspaceId, supabase})`. Idempotent (returns existing `crm_company_id` if already linked). Dedupes against existing companies by domain (global) or name+country (scoped). The bulk `/api/discovery/promote` endpoint stays on its own batched path — refactoring it to call this lib N times would lose its prefetch-once dedup-map performance. Phase 4 follow-up.

**API:**
- `POST /api/routes/[routeId]/stops/[stopId]/visit` — auth + workspace-membership gate, Zod-validated body (`outcome` ∈ 5 outcomes, `notes` ≤ 500 chars, optional overrides + visitedAt). Calls `logVisit`. Returns `{ok: true, routeStop, activityId, promotedCompanyId?, enrollmentId?, enrollmentSkipReason?}`.
- `PATCH /api/companies/[id]` — new file (no existing /api/companies/[id] route). Allows updating `skip_auto_followup` + `do_not_contact`. Workspace-membership gated.
- `GET/POST /api/settings/field-visits` — read/write `workspaces.settings.field_visits` JSONB. POST cleans up null/empty entries from `sequence_by_outcome` so the JSONB stays tidy, then merges with the existing `settings` (preserves other keys like `sending_settings` adjacents, ai_filter, etc.).

**Workspace settings JSONB shape (no schema change, just documented):**
```json
{
  "field_visits": {
    "auto_followup_enabled": true,
    "sequence_by_outcome": { "interested": "<seq_id>", "no_answer": "<seq_id>" }
  }
}
```

**UI:**
- `/settings/field-visits/page.tsx` — new subpage. Toggle for `auto_followup_enabled`, sequence dropdowns for the two auto-enroll outcomes (`interested`, `no_answer`). Other three outcomes documented inline as "no auto-enroll". Linked from the `/settings` index card grid.
- `/routes/[id]/page.tsx` — added day-progress indicator at the top of the header card (`X of Y visited · Z remaining · N follow-ups queued`), warning banner when an auto-enroll outcome lacks a configured sequence (links to `/settings/field-visits`), wired the new "Mark visited" / "Edit" button per stop into a sheet.
- `src/components/routes/stops-reorder-list.tsx` — extended `ReorderStop` with `visitedAt` + `visitOutcome`. Each row now shows an outcome pill (5 colour-coded variants) when visited, greys out the row, swaps the action button between "Mark visited" (indigo) and "Edit" (slate). Drag handle + reorder behaviour unchanged.
- `src/components/routes/mark-visited-sheet.tsx` — new bottom-sheet on mobile / centered modal on desktop. 44px tap targets, `vh`-based max height, top-anchored close, autoFocus OFF on the notes textarea (so the keyboard doesn't obscure the outcome radios when Hans taps in). Auto-enroll checkbox is hidden when the outcome doesn't auto-enroll OR the workspace hasn't configured a sequence — replaced with helper text in the latter case.
- `src/components/companies/detail/about-panel.tsx` — added an "Outreach controls" card to the sidebar with two toggles ("Skip auto follow-up" + "Do not contact"), saving via `PATCH /api/companies/[id]`. New `ToggleRow` helper component.

**Tests:**
- `src/lib/routes/visits.test.ts` — 12 unit tests covering each branch of `decideEnrollment` (every reason value + override precedence + decision-order checks like "explicit_override fires before no_company") + `readFieldVisitsSettings` shape parsing.
- `e2e/field-visits.spec.ts` — settings page renders, visit endpoint requires auth, visit endpoint rejects invalid outcome, company PATCH rejects empty body, route detail shows day-progress + Mark visited button when stops exist (skips when no routes generated).

**Build/deploy:**
- `npx tsc --noEmit` clean, `npm run lint` clean, `npm run build` green. New routes registered in the build manifest: `/api/companies/[id]`, `/api/routes/[routeId]/stops/[stopId]/visit`, `/api/settings/field-visits`, `/settings/field-visits`.
- Vitest: `src/lib/routes` 31/31 (Phase 1+2 tests still pass plus new 12). Pre-existing CEO + variable-interpolation vitest failures unchanged (already noted in PR #141 log).
- PR #145 squash-merged via `gh pr merge 145 --squash`. Vercel auto-deploy verified: `/login` 200, `/routes` 200, `/settings/field-visits` 307→login (correct), API endpoints 404 unauthed (existing middleware behaviour).

### Notable decisions
- **Pure-module split (`visits-decision.ts` + `visits.ts`)** — was forced by a build error: client UI components (`/settings/field-visits`, the bottom sheet, the stops list) need `VisitOutcome` and `VISIT_OUTCOMES`, but `visits.ts` transitively imports `@/lib/sequences/enrollment` → `@/lib/supabase/server` → `next/headers` (server-only). Splitting the pure decision logic + types into a separate file fixed both the Turbopack server/client boundary and the vitest path-alias issue in one move.
- **Single-shop promote lib added; bulk endpoint not refactored.** The spec asked to "use it from both places" but the bulk endpoint's prefetch-once dedup map is what makes thousand-shop imports tolerable. Calling `promoteDiscoveredShop` N times would issue 4–5 round-trips per shop. Logged as a Phase 4 follow-up.
- **Hand-edited `database.types.ts` rather than re-running `supabase gen types`.** Two boolean columns with defaults — three small inserts in companies Row/Insert/Update. Same conservative path PR #143 took for the `reorder_route_stops` RPC. Type-regen still on the table for the next round of changes.
- **Activity row uses `metadata.discoveredShopId` for non-promoted cold shops** — the `activities` table has no `discovered_shop_id` column. For `outcome IN ('not_interested','no_answer','skipped')` on a cold shop, the activity row is created with `company_id = null` and the shop id stashed in `metadata.discoveredShopId` so we can still surface it in a discovered-shops activity feed later.
- **"Primary contact" resolution: `is_primary` first, then oldest active contact, then skip with `enrollmentSkipReason='no_contact'`.** The visit is still recorded; the UI shows a toast hint to add a contact. Bulk-enroll-all-contacts is filed for Phase 4.
- **Decision-tree order matters and is documented in the unit tests.** Override → outcome default → company id → company skip → workspace disabled → sequence configured. First gate wins; later state can't unblock an earlier rejection.

### Required for new sessions / follow-ups
- **Could not verify on a physical phone in this session.** Tested at desktop browser mobile viewport widths only. Mobile-on-device verification belongs in the first phone-using session — note in the PR description.
- **Bulk `/api/discovery/promote` consolidation onto `promoteDiscoveredShop`** — would unify the two paths but loses per-batch dedup-map prefetch performance. Either (a) keep two implementations and let them drift slowly, or (b) extract a shared "build payloads from N shops" helper that both call. Phase 4.
- **Bulk-enroll-all-contacts on visit** instead of just the primary contact — Phase 4 once Hans actually wants it.
- **Per-user origin overrides + multi-rep capacity** — deferred from Phase 1, still open.
- **Stale `scripts/diagnose-min-interval-column.mjs`** in the working tree from a prior session — not committed by Phase 3 PR. Probably worth a one-line decision next session: keep, move under `scripts/diagnostics/`, or delete.

---

## Session: Field Routes — Phase 2 (interactive map + drag-reorder)
- **Date:** 2026-05-07
- **PR:** #143
- **Branch:** `feature/field-routes-phase2`
- **Merge commit:** `d7167f2`

### What was built
The static stops table on `/routes/[id]` is now an embedded Google Map + a drag-to-reorder list. Hans (or any field rep) can move stops around in the office, save, and the route's totals + leg drives + Google Maps deeplink update via a fresh Routes API call.

**UI components (new):**
- `src/components/routes/route-map.tsx` — `@vis.gl/react-google-maps` (`^1.8.3`). Origin pin labeled "S" (indigo-600), numbered stop pins coloured by source — sky-600 for cold prospects (`discovered_shop_id`), amber-600 for lapsed customers (`company_id`). Pin shape is an inline SVG data URL so we don't need a Map ID configured for AdvancedMarker. Click a pin → InfoWindow with shop name, address, mode tag, leg drive time. Polyline overlay reads `routes_api_response.routes[0].polyline.encodedPolyline` if present, else falls back to straight lines (origin → stop[0] → … → origin) and logs a warning. Auto-fit bounds includes origin + every stop. Aspect ratio: `aspect-square` mobile, `aspect-[16/9]` md+.
- `src/components/routes/stops-reorder-list.tsx` — drag-reorder using `@hello-pangea/dnd` (already a project dep, used by deals board + pipelines settings; the prompt said reuse if present). Sticky header with Save / Cancel. Save button is disabled until something moves; saving disables both. Each row: drag handle, #, shop name + cold/lapsed pill, address, leg drive time.

**`/routes/[id]/page.tsx` (rewritten):**
- 60/40 split (`md:grid-cols-5` with map = `col-span-3`, list = `col-span-2`); stacked on mobile.
- Map is `next/dynamic({ssr: false})` so the `/routes` list page doesn't pull the ~400 KB Maps JS bundle.
- Save flow: POST `/api/routes/[id]/reorder` with `{stopIds: [...]}`. On 409 (`exceeds_day_window`) shows `window.confirm("This route is now Xh Ym, longer than the 7.5h day window. Save anyway?")` and re-POSTs with `?force=true`. On 200, shows toast and refetches.
- Existing header / actions / Schedule / Discard preserved; `max-w-5xl` widened to `max-w-6xl` for the split.
- New `loading.tsx` skeleton matches the new layout.

**Backend (new):**
- `POST /api/routes/[id]/reorder` — `src/app/api/routes/[id]/reorder/route.ts`. Auth + workspace-membership gate (mirrors Phase 1's `[id]/route.ts`). Zod-validates `stopIds: uuid[]`, asserts the ID set matches existing stops 1:1 (no dupes, no extras, no missing). Builds ordered LatLng waypoints in the user-specified order, calls `recomputeFixedOrder`, returns 502 if Routes API fails (no DB writes). Day-window check returns 409 with `estimated_day_seconds` unless `?force=true`. On success, calls `reorder_route_stops` plpgsql function for atomic DB writes.
- `recomputeFixedOrder` in `routes-api.ts` — same shape as `optimizeRoute` but `optimizeWaypointOrder: false`. Field mask now includes `routes.polyline.encodedPolyline` for both — so going forward, reorders AND fresh generates ship polylines.
- Day-window logic extracted to `src/lib/routes/day-window.ts` so the boundary check (`exceedsDayWindow`) is unit-testable.

**DB (new function, applied to prod):**
- `supabase/migrations/20260507010000_reorder_route_stops_fn.sql` — `reorder_route_stops(p_route_id, p_workspace_id, p_stop_orders, p_total_drive_seconds, p_total_drive_meters, p_estimated_day_seconds, p_google_maps_deeplink, p_routes_api_response)`. `SECURITY DEFINER` with `search_path = public, pg_temp`. Two-pass UPDATE: first bumps every stop's `stop_order` to negative offset (`-1 - stop_order`) so the `UNIQUE(route_id, stop_order)` constraint can't catch us mid-reassignment, then applies the new orders + leg drives, then updates the parent `daily_routes` totals. Whole thing is one Postgres transaction (function = implicit tx), so a failure rolls back everything cleanly. Applied via Management API (`POST /v1/projects/wdgiwuhehqpkhpvdzzzl/database/query`, returned 201).

**Tests:**
- `src/lib/routes/day-window.test.ts` (new) — boundary asserts: `7.5h × 3600` exact passes, +1s rejects; comfortable day passes; very long day rejects. **Pure-function testing of the rejection logic the prompt called out.**
- `src/lib/routes/routes-api.test.ts` (new) — mocks `globalThis.fetch`, asserts `recomputeFixedOrder` sends `optimizeWaypointOrder: false` in the request body, parses `polyline.encodedPolyline` and per-leg duration/distance correctly, throws on non-2xx.
- `e2e/field-routes-phase2.spec.ts` (new) — `test.skip(!NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY, ...)`. Asserts a `div[role="application"]` (Maps JS render target) appears on `/routes/[id]`, and the reorder API rejects empty `stopIds` and non-existent stop IDs with 4xx.

**Build/deploy:**
- `npx tsc --noEmit`, `npm run lint`, `npx vitest run src/lib/routes` (17/17 pass), `npm run test:e2e:smoke` (8/8 pass) all green.
- `npm run build` clean.
- Vercel preview deploy on the PR branch failed at static prerender of `/login` because Preview scope is missing `NEXT_PUBLIC_SUPABASE_*` (pre-existing gap, also failed on PR #141). Production deploy on main triggered after merge.
- PR squash-merged via `gh pr merge 143 --squash`.

### Vercel env config (Preview scope)
- Production + Development scopes already had all five: `GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`, `ROUTE_DEFAULT_ORIGIN_ADDRESS/LAT/LNG`. Preview only had `GOOGLE_MAPS_API_KEY`.
- Added the four missing vars to Preview scope **scoped to branch `feature/field-routes-phase2`** because the CLI all-preview-branches form is broken — `vercel env add NAME preview --value … --yes` returns `git_branch_required` regardless. Per-branch form (`vercel env add NAME preview <branch> --value … --yes`) works once the branch exists on the remote. Worth filing a CLI bug; the dashboard tick-box still works without issue.
- The branch-scoped env vars are still on Vercel even after the merge — they're harmless for the now-merged branch and only cost a row in the Vercel UI.

### Notable decisions
- **`@hello-pangea/dnd` over `@dnd-kit`** — the prompt suggested `@dnd-kit` but said "reuse the existing DnD library if one is in use." Hello-pangea is what deals + pipelines already use; pulling in a second DnD lib would have added bundle weight and a second mental model. The keyboard / a11y story is good with hello-pangea.
- **Legacy `<Marker>` over `<AdvancedMarker>`** — AdvancedMarker requires a Map ID in Google Cloud Console (Maps Customization). Using inline-SVG data URLs on legacy Markers gets us numbered, coloured pins with no GCP setup required. Tradeoff: legacy Markers are deprecated in Google's roadmap; if/when they break we can migrate to AdvancedMarker + `<Pin>` and configure a Map ID.
- **Two-pass UPDATE in plpgsql, not bulk upsert** — the `UNIQUE(route_id, stop_order)` constraint on `route_stops` makes a single bulk UPDATE that swaps orders impossible. Two-pass (negative offset → final order) inside one transaction is the cleanest fix and keeps the constraint as a real safeguard rather than dropping it. Alternative would have been declaring the constraint DEFERRABLE — that change has wider implications and isn't justified for one code path.
- **Polyline field-mask added to `optimizeRoute` too**, not just the new `recomputeFixedOrder`. Otherwise newly-generated routes would still lack polyline data and Phase 2's map would always be on the straight-line fallback for them. Now both fresh generates and reorders ship polyline data; pre-existing rows continue to fall back to straight lines (visible warning in the browser console — by design).
- **Day-window check at `>` not `>=`** — exactly 7.5h is the cap, not the rejection point. Boundary test enforces this.
- **Cast through `unknown` for the `reorder_route_stops` RPC call** rather than regenerate `database.types.ts`. Type regen would require redoing the manual-export header preserved by PR #128's procedure for one new function. Documented the cast in a comment.

### Required for new sessions / follow-ups
- **Phase 3:** Mark-visited UI + visit-outcome capture + auto-enroll into a follow-up sequence on `interested`. Schema columns (`visited_at`, `visit_outcome`, `visit_notes`, `follow_up_required`) are already there from Phase 1.
- **Phase 4:** Per-user origin overrides (Hans's home is hardcoded today), multi-rep scheduling, min revisit interval.
- **Phase 1 deferred items still open:** geocoding backfill (`scripts/backfill-companies-latlng.mjs`) hasn't been run; first prod-route generation hasn't been verified end-to-end. Both blocked on Jacob running locally.
- **Vercel CLI bug to file:** `vercel env add NAME preview --value VALUE --yes` (omitting `<gitbranch>`) returns `git_branch_required` error. Per the CLI's own help text, omitting the branch arg should "add to all Preview branches"; instead it bails. Repro happens on `Vercel CLI 50.37.0`. Workaround: pass `<gitbranch>` explicitly. Or use the dashboard.

---

## Session: Field Routes — Phase 1 (backend + list UI)
- **Date:** 2026-05-07
- **PR:** #141
- **Branch:** `feature/field-routes-phase1`
- **Merge commit:** `63eb927`

### What was built
A field-rep route planner ("Field routes" in the sidebar). Generates 10 candidate one-day driving routes from clusters of cold prospects (`discovered_shops`) and lapsed customers (`companies` with no/canceled subscription). Each route gets a Google Maps deeplink Hans (or any field rep) can open on a phone or in CarPlay.

**Schema (migration `20260507000000_field_routes.sql`, applied to prod via Management API):**
- `companies` gained `latitude DOUBLE PRECISION`, `longitude DOUBLE PRECISION`, `geocoded_at TIMESTAMPTZ` + a partial index on `(latitude, longitude) WHERE latitude IS NOT NULL`.
- `daily_routes` table — one row per generated route. Fields: composition (`mode` mixed/cold/lapsed, `mode_fallback_reason`, `cluster_label`), planning (`origin_address/lat/lng`, `scheduled_for`, `status`), precomputed totals (`stop_count`, `total_drive_seconds/meters`, `estimated_day_seconds`), `google_maps_deeplink`, raw `routes_api_response JSONB` for debugging, `generation_batch_id` so the 10 routes from one run group together.
- `route_stops` table — denormalized stops per route (stable even if shop later moves/renames). One stop is either a `discovered_shop_id` or a `company_id` (CHECK enforces exactly one). Per-leg drive seconds/meters from the previous waypoint. Visit-state columns (`visited_at`, `visit_outcome`, `visit_notes`, `follow_up_required`) created now for stable schema even though Phase 3 will populate them.
- RLS enabled on both tables, mirroring the `tasks` pattern (`workspace_id IN (SELECT get_user_workspace_ids())`).

**Backend (`src/lib/routes/`):**
- `geocode.ts` — Google Geocoding API wrapper with in-request cache + typed `MissingApiKeyError`.
- `routes-api.ts` — Routes API v2 wrapper. Single `optimizeRoute({origin, waypoints, returnToOrigin})` function. `routingPreference: TRAFFIC_AWARE`, `optimizeWaypointOrder: true`, narrow field mask.
- `cluster.ts` — k-means with k-means++ init, Haversine distance, ≤30 iterations, pure JS no dependencies.
- `cluster-label.ts` — coarse Swedish-region labelling for cluster centroids ("Stockholm North", "Uppsala", "Mälardalen West", etc.).
- `generate.ts` — main generator. Pulls cold + lapsed pools, Haversine-prefilters to 120 km from Stockholm city center, k-means clusters, ranks by lapsed-density to assign `lapsed`/`mixed`/`cold` modes (with fallback to mixed if a "lapsed" cluster has fewer than 6 lapsed shops — `mode_fallback_reason` recorded), sorts each cluster, calls Routes API, drops the farthest stop and retries if the productive day exceeds 7.5 h, persists via service-role client.

**API (`src/app/api/routes/`):**
- `POST /api/routes/generate` — auth + workspace-membership gated. Returns `{batchId, routesCreated, coldPoolSize, lapsedPoolSize, fallbacks, routes}`. Returns `503` with a clear message if `GOOGLE_MAPS_API_KEY` is missing — no fake-data fallback.
- `GET /api/routes` — list (filterable by `status` / `batch`).
- `GET /api/routes/[id]` — single route + ordered stops, joined with `discovered_shops` / `companies`.
- `PATCH /api/routes/[id]` — `{scheduled_for?, status?}` for assigning a date or discarding.

**UI:**
- `/routes` (list) — Generate button, Candidate / Scheduled sections, mode badges (mixed/violet, cold/sky, lapsed/amber).
- `/routes/[id]` (detail) — header with totals, "Open in Google Maps" CTA (the deeplink), "Schedule for date" picker, stops table in optimized order with per-leg drive time, "Discard route" footer.
- Sidebar entry "Field routes" between Discovery and Inbox (using `lucide-react` `Map` icon).

**Geocoding backfill script:** `scripts/backfill-companies-latlng.mjs` — reads `.env.local`, hits Supabase REST + Google Geocoding API, throttles to ~10/sec, idempotent (skips rows where `geocoded_at` is set, marks failures with `geocoded_at` so re-runs skip them too). **NOT YET RUN** — see deferred items below.

**Tests:**
- `src/lib/routes/cluster.test.ts` — `haversineKm` + `cluster` correctness with seeded RNG; verifies two distinct geographic groups separate cleanly.
- `src/lib/routes/generate.test.ts` — `buildGoogleMapsDeeplink` encoding + integration of mode-assignment math against a mocked Routes API + Supabase.
- `e2e/field-routes.spec.ts` — smoke (page loads, button visible) + a Generate end-to-end test that `test.skip`s when `GOOGLE_MAPS_API_KEY` isn't in env.

**Build/deploy:**
- `npx tsc --noEmit` clean (had to add `latitude/longitude/geocoded_at: null` to the `Company` stub in `src/lib/sequences/__tests__/variable-interpolation.test.ts` after the type regen).
- `npm run lint` clean.
- `npm run build` green — new routes show in the routes manifest as `/routes`, `/routes/[id]`, `/api/routes`, `/api/routes/[id]`, `/api/routes/generate`.
- New unit tests: 8/8 passing. (Pre-existing `src/lib/ceo/...` test files fail to import in vitest — unrelated to this PR.)

### Notable decisions
- **Service-role client for `/api/routes/generate`.** The generator reads from `discovered_shops` (which lives outside per-user RLS in some workflows) and writes to `daily_routes` / `route_stops`. Auth + workspace-membership check happens in the route handler before delegating to the service client — same defense-in-depth pattern PR #120 used for the CEO dashboard absorption.
- **Sidebar position: between Discovery and Inbox**, not the prompt's "between Sequences and Tasks". Justified by topic adjacency — Discovery and Field routes are the two map-driven views.
- **Mode fallback sets `mode='mixed'`** (and records `mode_fallback_reason`) when a cluster designated for `lapsed` has fewer than 6 lapsed shops. The data model still distinguishes "intended lapsed but fell back" from "always mixed" via the reason column.
- **Routes API cost guard via `MAX_STOPS_PER_ROUTE = 12`** — keeps each `optimizeRoute` call within the deeplink-safe range and below Routes API's per-call cap, and means the day-length retry loop drops at most ~8 stops before giving up below `MIN_STOPS_PER_ROUTE = 4`.
- **Did not run the backfill or a verification generation in this session.** Jacob opted to ship code-only after seeing the cost estimate (~$47 for backfill, ~$0.05 for first generate). Both are stable and idempotent — re-runnable any time.

### Required env vars (Jacob to add in Vercel)
- `GOOGLE_MAPS_API_KEY` — single key with **Routes API** + **Geocoding API** + **Maps JavaScript API** enabled. Server-side only — DO NOT expose on `NEXT_PUBLIC_*`.
- `ROUTE_DEFAULT_ORIGIN_ADDRESS=Markvägen 23, 162 71 Vällingby`
- `ROUTE_DEFAULT_ORIGIN_LAT=59.3625` (verify by geocoding the address; this is the rough placeholder)
- `ROUTE_DEFAULT_ORIGIN_LNG=17.8722`

If `GOOGLE_MAPS_API_KEY` is missing at request time, `/api/routes/generate` returns `503 {error: "GOOGLE_MAPS_API_KEY not configured"}`.

### Deferred items
- **Geocoding backfill not yet run.** ~9,349 `companies` rows have `address IS NOT NULL AND latitude IS NULL`. Run `node scripts/backfill-companies-latlng.mjs` once `GOOGLE_MAPS_API_KEY` is set locally. Until that runs, the lapsed pool will be empty and every cluster will fall back to `cold` (or `mixed → cold` since lapsed pool < 6 everywhere).
- **First end-to-end generation not yet verified against prod.** Click "Generate today's routes" on `/routes` once env vars are in Vercel and a deploy has shipped — should produce ≤10 candidate routes within ~30 s.
- **Phase 2:** interactive Maps JS embed on the route detail page (replace the deeplink-only handoff with an in-app map).
- **Phase 3:** "Mark visited" UI + visit-outcome capture + auto-enroll into a follow-up sequence on `interested`.
- **Phase 4:** per-user origin overrides (Hans's home is hardcoded today), multi-rep scheduling, min revisit interval.



## Session: wl-app sync now reads from S3 directly
- **Date:** 2026-05-07
- **PR:** TBD
- **Branch:** `feature/wl-app-sync-from-s3`

### What was wrong
The wl-app sync (`scripts/import-wl-users.mjs`) read from a static `/tmp/wl-users.csv` last refreshed 2 days earlier. The CRM's view of who's a current customer vs churned was drifting from the actual app state — workshops the app had since reactivated were still marked `lifecycle_stage='churned'`.

### Fix
Refactored the sync to fetch directly from the same S3 bucket the wl-dashboard reads:
- **`s3://codeoc-dashboard-prod/latest/user_stats.json.gz`** — users + workshop fields (one row per user)
- **`s3://codeoc-dashboard-prod/latest/diagnostics.json.gz`** — diagnostic records, aggregated per user_id into `diagnostics_total / first_at / last_at / last_30d`

AWS credentials come from the default credential chain (`~/.aws/credentials`, IAM user `codeoc-dashboard-readonly` with `GetObject` on those keys). `DATA_BUCKET` and `AWS_REGION` are env-overridable but default to the prod bucket and `eu-north-1`.

The S3 JSON is flatter than the CSV (e.g. `subscription_status` is a single field, not split into user/workshop). The script now projects the JSON into the CSV-style row shape the existing `lifecycleStage()`/`customerStatus()`/`companyRecord()`/`contactRecord()` helpers already understood, so the lifecycle mapping logic stays unchanged.

Also fixed an `ON CONFLICT DO UPDATE command cannot affect row a second time` error — 4 user_ids appear in two workshops in the S3 dump, so the upsert batch occasionally contained two rows for the same wl_user_id. Dedupes by wl_user_id now, keeping the most-recent-`last_active` row.

### Run result vs. previous (2-day-stale) DB state
- companies (wl-app): 269 (was 255 — 14 new workshops since the CSV)
- contacts (wl-app):  333 (was 316)
- companies lifecycle_stage: paying=152 / trial=93 / churned=12 / lead=12 (was paying=37 / trial=99 / churned=56 / lead=63)
- contacts lead_status: customer=321 / churned=12 (was customer=259 / churned=57)
- SE specifically: customer=189 (was 174) / churned=1 (was 7)

The ~44 net "un-churned" workshops are real — the JSON shows them as `active`/`trialing` now. The remaining 12 churned in DB are residual `inactive`/`past_due` from 23 workshops not in the current JSON dump (likely truly dropped from the app).

### Notable decisions
- **Kept the 23 not-in-JSON workshops at their previous state** rather than auto-deleting them. The JSON dump may exclude some workshops for technical reasons unrelated to whether they're really gone; deletion on absence is irreversible.
- **`diagnostics_total` now actually populated** on contacts, with `last_30d` recomputed at sync time. Previously the field passed through from CSV but the CSV didn't have it — the field was always 0.
- **Subscription metadata source** changed from `wl-users-csv-2026-04-21` to the S3 key. Helps trace future weirdness back to the actual ingest path.


## Session: company detail page redesign (PR #139)
- **Date:** 2026-05-06
- **PR:** #139
- **Branch:** `feature/company-detail-redesign`

### What changed
- Replaced the 1205-line `company-detail-client.tsx` monolith with a structured layout: identity hero · KPI signals strip · discovery provenance pill · two-column body (compact About panel | tabs).
- Hero: Google-favicon logo + name (inline-edit) + domain link + phone (inline-edit) + lifecycle/customer-status/category/industry badges + quick actions (Add Contact / Add Deal / Log activity / overflow → Delete). "Back to Companies" relocated inside the hero.
- Signals strip: data-driven KPI row — only renders cards with values. Surfaces rating, MRR (or ARR), health score, last active, trial-ends, diagnostics-30d, contacts count.
- Discovery provenance: dedicated cyan-tinted strip when a `discovered_shops` row links to the company. Maps button + shop_type/email_status badges + closed-state warnings + scrape timestamp.
- About panel (left rail, 280 px): renders only populated firmographic fields (no more 25 em-dashes). One "Edit" button opens a SlideOver drawer for the full form. Customer + Account + Location + Hierarchy + Social + Tags/Notes + Delete are separate cards that render only when applicable.
- Edit drawer: single batched-save form with sections (Identity, About, Location, Social, Hierarchy, read-only Google Maps, Custom fields). Replaces ~600 lines of inline-per-field click-to-edit markup with one Save button → one Supabase update → one toast.
- Tabs container: 5 panels in one file (`tabs.tsx`). **Default tab is now Activity** (was Contacts).

### File split
- `company-detail-client.tsx` — orchestrator (data fetching + state + layout, ~250 lines)
- `detail/types.ts` — shared types + INDUSTRIES/CATEGORIES constants
- `detail/hero.tsx` · `detail/signals.tsx` · `detail/discovery-strip.tsx` · `detail/about-panel.tsx` · `detail/edit-drawer.tsx` · `detail/tabs.tsx`

Net diff: 8 files changed, +1513 / −1072. The monolith shrank to a thin orchestrator; the rest is new focused components.

### Build/deploy
- `npm run build` green (had to prepend `/opt/homebrew/bin` to PATH locally — Codex.app Node breaks `@next/swc-darwin-arm64` native binding; documented in user memory)
- `npm run lint` clean (fixed two `Date.now()`-in-render purity errors carried over from old code by handling null `created_at` explicitly; suppressed `<img>` warning on the Google favicon — `next/image` here would require remotePatterns config for an unoptimized 64×64 external)
- `npx tsc --noEmit` clean
- Squash-merged via `gh pr merge 139 --squash` (GitHub returned a 504 mid-merge but the merge persisted — verified `state=MERGED`).
- Vercel auto-deployed `crm-for-saas.vercel.app` — confirmed live with fresh `x-vercel-id`.

### Notable decisions
- **Kept client-side data fetching** instead of moving to Server Components. Every `(dashboard)/*/page.tsx` in this codebase uses the `Suspense → client wrapper → useWorkspace()` pattern; converting just one page would be inconsistent and would have required deriving `workspaceId` server-side from the auth cookie. The redesign value is in layout + edit UX, both of which work fine with the existing pattern.
- **Single drawer with batched save** instead of preserving per-field PATCHes. UX win (one save, one toast, one round-trip), and shrinks the orchestrator state — no more `editField` / `editValue` strings shared across 15 inline fields.
- **Inline edit kept narrow.** Hero: name + phone only. About panel: tags + notes only. Everything else moves into the drawer. The original "click any field to edit it" pattern was never used at scale because most fields are empty.
- **Google favicon as logo source** (`https://www.google.com/s2/favicons?domain=...&sz=64`). No backend change, falls back to a slate first-letter avatar if domain is null or the request fails. Could swap to Clearbit later if we want higher-res logos.
- **Default tab = Activity** is a behavioural change Jacob signed off on. Activity is the highest-traffic tab on existing customer companies; Contacts only matters when triaging new prospects (and there's a "+ Contact" button in the hero anyway).
- **Discovery strip is its own visual zone**, not a sidebar section. The `discovered_shops` row is provenance, not a CRM-editable field — separating it visually makes that clear.

### Mystery: duplicate-fields screenshot
Jacob's screenshot showed Website / Industry / Category / Description / Employee Count / Annual Revenue / Revenue Range rendered **twice** in the sidebar. I grepped every label in source — each appears exactly once on `main`. Open PR #36 (`claude/loving-perlman` email warmup) doesn't touch the file. Can't reproduce locally and the screenshot doesn't match the source. Either a stale browser/Vercel cache, or a render-time artifact I couldn't see. **Either way, the redesign replaces the entire panel — symptom dies regardless.** Worth a re-screenshot after deploy to confirm.

### Follow-ups
- Phase-2 polish on the Edit drawer: form-level validation (e.g. URL fields should reject obvious garbage), Stripe-ID copy buttons in the read-only Google Maps section.
- "Add Contact" / "Add Deal" / "Log activity" buttons currently just switch to the right tab. Wiring them to actually open creation flows is a separate task.
- Consider extracting a `LifecycleBadge` from the inline coloring in hero.tsx into `components/ui/badge.tsx` once it's used in a third place.

---

## Session: contacts page cleanup + churned lead_status from workshop state
- **Date:** 2026-05-06
- **PR:** TBD
- **Branch:** `fix/contacts-page-cleanup`

### What changed (per Jacob's feedback)
- **Removed "All companies" filter dropdown** (kept the company-search picker on the bulk action bar and the "Add Contact" form).
- **Removed "All languages" filter dropdown** + the distinct-languages fetcher.
- **Removed "Language" + "Source" columns** from the contacts table. Source filter dropdown stays — Jacob only flagged the columns.
- **Patched `scripts/import-wl-users.mjs`** so contact `lead_status` is derived from the workshop's `lifecycle_stage`: churned workshops produce churned contacts, every other state (trial, paying, lead) produces `customer`. Adds a `leadStatusFromWorkshop(row)` helper alongside the existing `lifecycleStage()` mapping.
- **Backfilled 316 existing wl-app contacts** inline against prod. Result: 259 customer / 57 churned (was 316 customer / 0 churned). SE-specific: 174 customer / 7 churned, all now visible in the right tabs.

### "Contacted" tab — not a bug, no data
Jacob flagged "the contacted filter does not seem to work." It does — there are just zero contacts with `lead_status='contacted'`. There's no automatic state transition when a sequence sends an email (would be a feature, not a fix). Manual transitions happen via the bulk-action bar's "Change Lead Status" dropdown or the per-contact detail page. Flagged for him to decide whether to add auto-transition later.

### Notable decisions
- **Mapping `lead='lead'` → contact.lead_status='customer'`**, not `'qualified'`. Workshops in stage='lead' have signed up for the app but never run a diagnostic — they're still customers in our model (they have an account), just inactive. Treating them as `qualified` would imply they're prospects, which they're not.
- **Source filter dropdown kept**, source column removed. Reasoning: Jacob's feedback was specific ("the columns, language and source"; "remove the language drop down"); didn't include "source dropdown". The source filter remains useful when triaging where a batch came from.


## Session: backfill wl-app customer country_code (Customer + country filter)
- **Date:** 2026-05-06
- **PR:** TBD chore
- **Branch:** `fix/wl-app-contact-country`

### What was wrong
Jacob filtered `/contacts` to **Customer + Sweden** and saw "No contacts found" even though 181 of his 316 paying app users are at SE workshops.

Root cause: `scripts/import-wl-users.mjs` (the wl-app sync) populates `companies.country_code` from `meta.workshop_country` but never sets `contacts.country_code` on the user rows. All 316 customer contacts had `country_code=NULL` while their company had it.

The contacts list filter does `eq('country_code', filters.country_code)` on the contact, not the joined company — so customer + country filtering missed all of them.

### Fix
- **`scripts/import-wl-users.mjs`** — added `country_code: NULL(row.workshop_country)` to the contact record so future syncs denormalize the workshop's country onto each user.
- **One-off backfill** (run from inline node script, not committed): updated all 316 wl-app customer contacts' `country_code` + `country` from their company. Verification post-backfill: 181 SE / 316 total customers, breakdown DK 5 / NO 1 / and a handful of bad-data outliers (ZW, CN, AD, BD, UM, BY, FR) that came in misclassified from the wl-app source — flagged but not addressed in this session.

### Notable decisions
- **Denormalize, don't join.** Could have changed the contacts filter to `OR contact.country_code = X OR company.country_code = X`, but that's a more invasive UI/API change and leaves the data shape inconsistent (other contact sources like discovery already populate the field). Mirroring the existing pattern is simpler.
- **Backfill not kept as a script** — the patch to `import-wl-users.mjs` is the durable fix; future syncs won't drift again. A re-runnable backfill template feels like over-engineering for what is now a one-off correction.


## Session: drop auto_glass from Core ICP + un-promote 219 pure auto-glass shops
- **Date:** 2026-05-06
- **PR (preset change):** [#135](https://github.com/jacobqvisth/crm-for-saas/pull/135)
- **PR (script + log):** TBD chore
- **Branch:** `feature/core-icp-drop-auto-glass`

### What was wrong
After the SE backfill landed and Jacob looked at `/contacts` filtered to Sweden, he flagged that `Carglass` (a pure auto-glass-replacement chain like the European Belron subsidiary) had been promoted. His scoping rule: "the ones that only have auto glass should be un-promoted; combos of auto_body + auto_glass we keep."

Root cause: today's PR #129 hard-coded `auto_glass` into `CORE_ICP_SHOP_TYPES` because the SE 'other' bucket cleanup PR's stated sequence enrollment filter included it. That stated filter no longer matches Jacob's actual ICP — pure glass shops aren't a fit for mechanic-focused outreach.

### Fix
- **`src/lib/shop-types.ts`** — removed `auto_glass` from `CORE_ICP_SHOP_TYPES`. The "Core ICP" preset in the discovery dropdown now selects `auto_repair + tire_combo + auto_body` only.
- **`scripts/unpromote-auto-glass-only.mjs`** (new) — re-runnable un-promote helper. Filters by `shop_type='auto_glass' AND status='imported' AND all_categories does NOT contain auto-body keywords`. Carefully handles shared companies: if a chain like Carglass has multiple locations linked to one company row, the shared company stays alive; only the target shops' soft pointers are unhooked.

### Run result (SE only — other countries' shop_type field isn't populated)
- SE imported auto_glass before: 220 (219 pure-glass + 1 combo)
- Shops moved to status='skipped': 219
- Contacts deleted: 119 (the rest were dedup-promoted with `crm_contact_id=NULL`)
- Companies deleted: 119 (had no other shop refs)
- Companies kept (shared with non-target shops, e.g. Carglass chain locations): 6
- Combo kept: 1 (Auto body parts supplier | Auto glass shop | Glazier)
- Verification: `Carglass` SE removed; SE workspace went from 3,584 → 3,465 contacts.

### Notable decisions
- **Conservative shared-company handling.** The promote route's dedup links multiple shops to one company when they share a domain or name+country. For 6 of the 125 distinct target companies, at least one non-target shop still references them — those companies were kept (just unhooked from the un-promoted shops) so the non-target shops don't end up with broken pointers.
- **Body-keyword detection is regex-based on `all_categories`** rather than checking shop_type alone. The combo cohort uses Google's category labels (e.g. "Auto body parts supplier") to qualify — a single shop can have several Google categories, and that's the signal for a combo classification.
- **Non-SE pure-glass shops (4 found: GB My Car Glass, CZ Carglass, etc.) are still imported** under `shop_type='other'` because the SE 'other' bucket cleanup migration was SE-only. Flagged to Jacob — broader cleanup pending his call.


## Session: workspace-scoping fix + relocate misallocated contacts/companies
- **Date:** 2026-05-06
- **PR (route fix):** [#133](https://github.com/jacobqvisth/crm-for-saas/pull/133)
- **PR (scripts + log):** TBD chore
- **Branch:** `fix/promote-workspace-scoping`

### What was wrong
Jacob filtered `/contacts` to country=Sweden and saw "No contacts found" even though 3,584 SE contacts existed in the DB. Diagnosis: `src/app/api/discovery/promote/route.ts` resolved the workspace via `.from("workspaces").select("id").limit(1).single()` with no ORDER BY. Postgres returned non-deterministic results once multiple workspaces existed, and at some point the "first" row flipped — silently dumping promote results into a workspace the active user wasn't a member of.

Misallocation in prod: 4,690 rows (3,584 SE + 1,106 CZ contacts/companies) had landed in `264b795c` ("Jacob Qvisth's Workspace" — owned by the secondary `jacob.qvisth@gmail.com` account) instead of `d946ea1f` ("My Workspace" — the wrenchlane.com session). The 1,106 CZ companies in `264b795c` were domain-collision duplicates of companies in `d946ea1f`, created when the same shops were promoted across two non-deterministic runs.

### Fix
- **`src/app/api/discovery/promote/route.ts`** — replaced the `.limit(1)` workspace lookup with a `workspace_members.user_id = auth.uid()` lookup, mirroring the canonical pattern in `src/lib/hooks/use-workspace.ts` and the auth callback.
- **`scripts/backfill-promote-icp-by-shop-type.mjs`** — workspace is now an explicit `--workspace` (or `--user-email`) argument; the old "first workspace" pattern was removed.
- **`scripts/move-workspace-data.mjs`** (new) — re-runnable migration that moves all companies + contacts from one workspace to another. Handles the partial UNIQUE `(workspace_id, domain)` index by merging colliding companies, reattaching contacts to the kept company, deleting duplicate contacts whose email already exists at the target, and re-pointing every `discovered_shops.crm_company_id` and `crm_contact_id` so the company/contact-detail pages remain consistent.

### Migration result
- Domain collisions merged: 1,106
- Duplicate FROM contacts deleted (same email already in TO): 1,104
- Contacts re-pointed to merged-into companies: 2
- Companies moved (workspace_id flip): 3,584
- Contacts moved (workspace_id flip): 3,584
- `discovered_shops` pointers re-pointed: 2,210
- `264b795c` after: companies=0, contacts=0
- `d946ea1f` after: companies=10,555, contacts=10,621 (gained 3,584 SE contacts and 3,584 SE companies)

### Notable decisions
- **Kept the secondary workspace `264b795c` in place** (Jacob explicitly opted not to delete it). It's now empty but still has its owner membership for `jacob.qvisth@gmail.com`. Easy to revisit later.
- **Used the well-known 200-chunk `.in()` pattern** when validating orphan pointers (the same gotcha PR #99/#102 fixed for sequence enrollment) — an earlier 500-chunk pass appeared to find 6,500 orphans but was just URL-truncated. With proper chunking, 0 orphan pointers remain.
- **Scripts are kept as templates**, not deleted after the one-off run. Both have explicit safety arguments (`--from`/`--to` UUIDs, `--dry-run`, `--workspace` required) so a careless re-run can't repeat the original mistake.


## Session: discovery shop_type filter + deliverable-email semantics
- **Date:** 2026-05-06
- **PR:** [#129](https://github.com/jacobqvisth/crm-for-saas/pull/129)
- **Branch:** `feature/discovery-shop-type-filter`
- **Merge commit:** `22a6de9`

### What was wrong
After PR #124 (SE 'other' bucket cleanup) reclassified ~1,660 SE rows into core ICP `shop_type` buckets, Jacob tried to bulk-promote SE auto-repair shops with verified emails and found 928 still stuck in `discovered_shops.status='new'`. The cleanup made `shop_type` the canonical ICP classifier — but the discovery UI still filtered by Google Maps `category` only.

The 928 unpromoted SE auto_repair valid-email rows broke down as:
- 753 with `category=NULL` (Lemlist legacy chain shops + NULL-category Apify hits, both reclassified by the cleanup using `source` and `raw_data->>'term'` rather than Google's category field)
- 734 from `source='lemlist'` specifically

So when Jacob applied a category filter in the UI, those rows were excluded from "select all matching" even though they belong in the core ICP. Across SE, the gap was ~1,253 shops (auto_repair + auto_glass + auto_body + tire_combo, status=new, email_status IN valid|catch_all).

Secondary issue: the "Verified email" toggle was `email_status='valid'` only. The SE plan's deliverable definition is `email_status IN ('valid','catch_all')`, so catch-all rows couldn't be promoted via the toggle either.

### Fix
- **`src/lib/shop-types.ts`** (new) — `CORE_ICP_SHOP_TYPES` constant + display labels.
- **`src/app/api/discovery/{shops,promote,skip,verify-email}/route.ts`** — added `shop_types` filter (PostgREST `.in('shop_type', ...)`) and renamed `verified_email` → `email_deliverable` with widened semantics (`.in('email_status', ['valid','catch_all'])`).
- **`src/app/api/discovery/stats/route.ts`** — added `by_shop_type` aggregation so the UI dropdown can show counts.
- **`src/components/discovery/discovery-page-client.tsx`** — new `ShopTypeFilterDropdown` (mirrors `CategoryFilterDropdown`) with a one-click **Core ICP** preset that selects auto_repair + tire_combo + auto_glass + auto_body. The "Verified email" toggle was renamed to "Deliverable email" and now matches the canonical sequence enrollment filter. Shop type is rendered as a separate filter from category, with core ICP types visually grouped at the top.

### Build status
- `npm run build` ✅ clean (8.2s)
- `npm run lint` ✅ clean
- `npx tsc --noEmit` ✅ clean
- Vercel deploy: triggered by PR #129 merge, prod returned 307 on `/` (auth redirect) and 200 on `/discovery` (expected).

### Notable decisions
- **Replaced `verified_email` rather than adding a parallel `email_deliverable` flag.** The deliverable definition is the canonical one used by sequence enrollment; a `valid`-only toggle was strictly narrower than the actual ICP and never useful in practice. No external API consumers, so the breaking rename is contained to the discovery client.
- **`shop_type` and Google `category` filters live side-by-side**, not merged. They answer different questions: `shop_type` is the workshop's ICP classification (set deliberately by us), `category` is Google Maps' raw label set (often missing or overly granular). Both have legitimate uses — Jacob may want to filter by Google "Auto repair shop" specifically when triaging new scrapes, even within the `auto_repair` bucket.
- **"Core ICP" preset is a button, not the default state.** A default-on filter would silently hide other ICP types from the list view, which is wrong — the discovery surface is also used for non-core inventory triage. The preset is one click away when you want it.
- **Backfill executed via `scripts/backfill-promote-icp-by-shop-type.mjs`** (kept as re-usable template). Mirrors the promote route's dedup + insert logic against prod with the service role. SE result: 1,104 new companies+contacts created, 148 linked to existing companies as duplicates, 0 invalid-email skips. Verification after run: `still_stuck = 0`, `se_core_icp_imported_with_deliverable_email = 3355` — matches the SE plan's stated sendable target exactly.


## 2026-04-29 — Fix: discovery promote bulk path timed out after PR #77

**Session type:** CC bug fix (full cycle: branch → PR → merge → deploy verify).

- **PR:** [#81](https://github.com/jacobqvisth/crm-for-saas/pull/81) — squash-merged (commit `4fbd75a`)
- **Branch:** `fix/discovery-promote-bulk` (deleted on merge)
- **Triggered by:** PR #77 fix worked for single-row promote but bulk (50, all) silently failed. Cause: PR #77 replaced the bulk upsert with sequential per-row `.update()` calls — fine for 1 row, exceeded the Vercel function timeout for 50+.

### Change in `src/app/api/discovery/promote/route.ts`
- Restored bulk `upsert(...)` on both call sites (duplicate marking + newly-promoted updates) but included `name: shop.name` in the payload so PostgREST's INSERT side of `INSERT ... ON CONFLICT (id) DO UPDATE` satisfies the NOT NULL constraint on `discovered_shops.name`. The conflict path triggers UPDATE which sets `name` to the same existing value (no-op).
- Added explicit `if (error) return 500` on both upsert calls so future silent-failure regressions surface as real errors instead of misleading `{promoted, skipped_duplicates}` counts.
- Round trips for bulk now O(rows / PAGE_SIZE) instead of O(rows).

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- Deploy: https://crm-for-saas.vercel.app live (index 307; `/api/discovery/promote` 401 unauth as expected).

### Follow-up
- Confirm 50- and all-row LT promote work end-to-end in the UI; expect ~582 LT shops to land in `companies` + `contacts` and corresponding staging rows to flip to `imported`.

---

## 2026-04-28 — Fix: discovery promote silently skipped all rows

**Session type:** CC bug fix (full cycle: branch → PR → merge → deploy verify).

- **PR:** [#77](https://github.com/jacobqvisth/crm-for-saas/pull/77) — squash-merged (commit `4c4d030`)
- **Branch:** `fix/discovery-promote-upsert-and-dedup` (deleted on merge)
- **Triggered by:** Jacob attempted to promote LT shops from `/discovery`. Toast read "Promoted 0 shops · 1 duplicate skipped" but no rows changed in the DB. Same behavior for any LT row attempted.

### Two bugs in `src/app/api/discovery/promote/route.ts`
1. **Silent upsert failure.** `discovered_shops.name` is NOT NULL with no default. Both the duplicate-marking path and the newly-promoted update path used `.upsert([{id, status, crm_company_id}])` without `name`. PostgREST resolves upsert as `INSERT ... ON CONFLICT (id) DO UPDATE` — the INSERT side validates NOT NULL on the proposed row before the conflict triggers UPDATE, so Postgres rejected the entire statement. No error handling on those calls, so the API still returned `{promoted, skipped_duplicates}` while the DB stayed unchanged. Switched both call sites to per-row `.update().eq("id", shop.id)` which never hits the INSERT path.
2. **Cross-country name dedup.** Dedup matched name globally — "AD Baltic" in EE collided with "AD Baltic" in LT (different domains, different businesses, different localizations). Name match is now country-scoped via `${country_code}:${name.toLowerCase()}` compound key. Domain match remains global since a domain identifies one business across markets.

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- `npm run build` skipped (lightningcss native-binding issue, pre-existing per PR #73 log).
- Deploy: https://crm-for-saas.vercel.app — index 307 → /login (live); `/api/discovery/promote` returns 401 unauth (expected).

### Follow-up
- Test path: promote one LT row → confirm `companies` + `contacts` insert and `discovered_shops.status='imported'`. Then bulk-promote the 581 remaining verified-valid LT rows.

---

## 2026-04-28 — Ops: EE/LV verification sweep + full MV coverage across both tables

**Session type:** Ops + tooling (no app code change).

### Trigger
EE and LV contacts were enrolled in active sequences with `email_status='unknown'` (LV: 232/279) or stale legacy MX-only "valid" (EE: 232/281). 5 EE bounces + 18 LV bounces had already accrued, hurting sender reputation. 508 emails were scheduled to send to unverified addresses.

### What ran (in order)
1. **Snapshot + pause queue.** Created `_ops_queue_pause_2026_04_28` (queue_id, contact_id, country_code, email, scheduled_for) and flipped 508 `email_queue` rows (275 EE + 233 LV) from `scheduled` → `cancelled` to halt sending.
2. **Verified 527 active EE+LV contacts** with new MillionVerifier sweep — `scripts/verify-contacts-ee-lv.mjs` (concurrency 20, ~91s). Bypassed `shouldSkip` because legacy MX-only "valid" rows weren't trustworthy.
3. **Re-enabled queue** (`status=scheduled`, `error_message=NULL`) for the 411 rows whose contact came back `email_status='valid'` (232 EE + 179 LV).
4. **Paused 103 enrollments** (43 EE + 60 LV) for contacts now `risky`/`catch_all`/`invalid` — `sequence_enrollments.status='paused'` so cron won't queue future steps (per `src/app/api/cron/process-emails/route.ts:187`).
5. **Backfilled MV verification across the rest of both tables.** All `discovered_shops` legacy/null cohorts (LT 701, EE 335, LV 340) plus 36 stragglers in `contacts` (`unknown`/null) verified via `scripts/verify-emails.mjs --country LT|EE|LV` and new `scripts/verify-contacts-unknown.mjs`.

### Result — 100% MV coverage
Every email in `contacts` (2,872) and `discovered_shops` (8,141) now has a fresh `email_status` from MillionVerifier. No more `null`/`unknown`/legacy-only rows.

Notable downgrades: LT staging lost 119 of its legacy 690 "valids" (now 582 valid / 48 risky / 39 catch_all / 32 invalid). LV staging surfaced 95 non-deliverable from 340 previously-unverified (245 valid / 36 risky / 36 catch_all / 23 invalid).

### What changed in this PR
- `scripts/verify-contacts-ee-lv.mjs` (new) — one-shot sweep of EE/LV active enrollees against MV.
- `scripts/verify-contacts-unknown.mjs` (new) — sweeps `contacts` rows where `email_status` is null or `unknown`.
- This log entry.

### Build status
- `npm run lint` ✅ clean against the two new scripts
- No `src/` changes — Vercel build skipped via `ignoreCommand` (only `scripts/` + log touched).

### Reversibility
`_ops_queue_pause_2026_04_28` retains the original `scheduled_for` for all 508 paused rows; 97 are permanently `cancelled` (status≠valid contacts) and can be recreated from the snapshot if ever needed.

### Follow-up
- LT contacts/companies are still 0 — Jacob's earlier import attempt didn't land. Worth retrying the import for the 582 LT shops now confirmed `valid`.
- LV invalid rate (7.5% of contacts) is meaningfully higher than EE (2.8%) — flag for source-quality review.

---

## 2026-04-27 — Fix: cron skips over-capacity senders before LIMIT

**Session type:** CC bug fix (full cycle: branch → PR → merge → deploy verify).

- **PR:** [#73](https://github.com/jacobqvisth/crm-for-saas/pull/73) — squash-merged (commit `9c89262`)
- **Branch:** `fix/cron-skip-over-capacity-senders` (deleted on merge)
- **Bug confirmed in prod earlier today**: hans.markebrant@ at 80/80 with 142 due-now rows blocked 281 Estonia rows pinned to hans.m@ (fully available). Cron was returning `{processed: 0}`. Jacob manually deferred the blocking rows to unblock today's send.

### What changed
- **`src/app/api/cron/process-emails/route.ts`**: Pre-fetch active gmail accounts, compute `availableSenderIds` in JS where `daily_sends_count < max_daily_sends`, and add `.in("sender_account_id", availableSenderIds)` to the queue query so the `LIMIT 100` window only sees rows that can actually send. Early-return `{processed: 0, message: "No senders with capacity"}` if all senders are maxed out. Per-sender circuit breaker, jitter, and 1-per-sender-per-run logic unchanged.

### Build status
- `npm run lint` ✅ clean
- `npx tsc --noEmit` ✅ clean
- `npm run build` ⚠️ blocked locally by missing `lightningcss/lightningcss.darwin-arm64.node` (file lives in sibling `lightningcss-darwin-arm64/` but the wrapper looks for it inside `lightningcss/`). Pre-existing node_modules state issue, unrelated to this change. Vercel build env is unaffected — site is live.
- `TEST_BASE_URL=https://crm-for-saas.vercel.app npm run test:e2e:smoke` ✅ 8/8 passing (incl. cron-secret API health checks)
- Deploy: https://crm-for-saas.vercel.app — HTTP 307 → /login (live); `/api/cron/process-emails` returns 401 without CRON_SECRET (expected).

### Follow-up
- Add an explicit unit test for the head-of-line scenario (2 senders, oldest pinned to maxed sender, assert cron sends from available sender). Not done in this PR; flagged in PR #73 description.

---

## 2026-04-27 — Per-sequence editable auto-rotate pool

**Session type:** CC feature build (full cycle: branch → build → PR → merge → deploy verify).

- **PR:** [#71](https://github.com/jacobqvisth/crm-for-saas/pull/71) — squash-merged
- **Branch:** `feature/per-sequence-rotation-pool`
- **Spec:** `cc-prompt-per-sequence-rotation-pool.md` (vault, `_prompts/`)

### What was built
- **`src/lib/database.types.ts`**: Added optional `rotation_account_ids?: string[]` to `SequenceSettings`. No DB migration — `sequences.settings` is already JSONB.
- **`src/lib/gmail/sender-rotation.ts`**: `getNextSender` now takes optional `allowedAccountIds`; when non-empty, filters via `.in("id", allowedAccountIds)`. Empty/undefined keeps the all-active behavior.
- **`src/lib/sequences/enrollment.ts`**: When the user picks auto-rotate (no explicit `senderAccountId`), reads `settings.rotation_account_ids` and passes it to `getNextSender`. Skip reason when the pool has no capacity: `"No accounts in this sequence's rotation pool have capacity"`.
- **`src/app/api/cron/process-emails/route.ts`**: Re-pin fallback (when an enrollment's pinned sender goes inactive) also respects the per-sequence pool.
- **`src/components/sequences/sequence-settings.tsx`**: New "Auto-rotate pool" section — per-account checkboxes, Select all / Deselect all, helper copy. Empty arrays are not persisted (treated as undefined) so deselecting everyone falls back to "all active" rather than bricking the sequence.
- **`src/components/gmail/sender-account-selector.tsx`**: Added optional `autoRotateLabel` prop so callers can override the default "Auto-rotate across all accounts" option text.
- **`src/components/sequences/enroll-contacts-modal.tsx`**: When a pool is configured, the auto-rotate option label becomes `Auto-rotate (N of M accounts)` and a small "Edit pool" link deep-links into the settings panel.
- **`src/app/(dashboard)/sequences/[id]/page.tsx`**: Wires `sequenceSettings` and `onOpenSettings` from the page into the enroll modal.

### Build status
- `npm run lint` ✅ clean
- `npx tsc --noEmit` ✅ clean
- `npm run build` ✅ (had to use `/opt/homebrew/bin/node` locally — the harness's bundled node has a hardened-runtime Team-ID mismatch with `lightningcss-darwin-arm64` and `@next/swc-darwin-arm64`. Vercel's build env is unaffected.)
- `npm run test:e2e:smoke` ✅ 8/8 passing
- Deploy: https://crm-for-saas.vercel.app — HTTP 307 → /login (live, expected)

### Notable decisions
- Empty array vs. undefined: both mean "rotate across all active accounts". The picker doesn't persist an empty array — it just unsets the field — so an accidental "deselect all" can never block enrollments.
- Cron re-pin path is pool-aware too. Without that, a paused in-pool sender would have re-pinned to a random workspace account and silently expanded the pool.
- The `autoRotateLabel` selector prop is intentionally minimal — no editor inside the modal, just the count + deep-link, per spec.

---

## 2026-04-22 — Cowork-side data-ops: Slovakia (SK) scrape + email verification

**Session type:** Cowork data-ops (not a CC build). Script added to repo via PR below.

### Slovakia (SK) scrape — complete
- Pipeline: 12 Apify `compass/crawler-google-places` runs — 1 country-wide (5 terms: autoservis, auto servis, autoopravovňa, autolakovňa, karoséria) + 2 Bratislava grids (main + BA-split) + 9 city grids (Košice, Prešov, Žilina, Nitra, Banská Bystrica, Trnava, Martin, Trenčín, Poprad).
- Raw fetched: **4,918** items across all 12 datasets. Dedup removed 715 placeId dups + 625 secondary-key dups.
- Final: **3,573 unique rows in `discovered_shops`** where `country_code='SK'`. 1,414 with email (40%), 3,271 with phone (92%), 683 unique cities.
- Country-wide run took 45 min (dominant bottleneck — 5 terms + `scrapeContacts: true`); city grids completed in 8–10 min each in parallel.
- Import script: `scripts/import-slovakia-shops.mjs` (committed via PR below). Fetches directly from Apify datasets; upserts on `google_place_id`; idempotent.
- Key difference vs CZ script: `'Slovakia'` / `'SK'` country/country_code, `autoopravovňa` added to `INCLUDE_CATEGORY_REGEX`, 12 datasets vs 15.
- Apify cost: ~$34 (4,918 items × $7/1k). Plan + actuals at `_reference/scrape-plan-SK.md` in vault.

### Email verification (MillionVerifier)
- 1,414 SK emails verified in 4 chunks of 400 / 400 / 400 / 214 at concurrency=80. 0 errors across all chunks.
- Final SK distribution: **valid=791 / risky=288 / catch_all=290 / invalid=45 / unknown=0**. No null remaining.
- MV credits used: ~1,414. Credits remaining after run: ~50,286.

### Import script committed
- Branch `chore/add-slovakia-import`, PR merged — `scripts/import-slovakia-shops.mjs` added.

### Total `discovered_shops` table state (post-SK)
- Total rows: **13,654** (CZ + SK + prior EE/LT/LV/SE-Stockholm rows)
- SK rows: 3,573 | CZ rows: 6,295 (from prior session)

---

## 2026-04-22 — Cowork-side data-ops: Czech Republic scrape + MillionVerifier migration

**Session type:** Cowork data-ops (not a CC build). Scripts added to repo, 2 API routes edited but **uncommitted — awaiting CC merge**.

### Czech Republic (CZ) scrape — complete
- Pipeline: 15 Apify `compass/crawler-google-places` runs (Wave 1: country-wide + Praha/Brno/Ostrava; Wave 2: 11 medium-city grids; + Kladno retry after geocoding miss).
- Final: **6,295 unique rows in `discovered_shops`** where `country_code='CZ'`. 3,227 with email (51%), 5,700+ with phone (91%).
- Dedup cascade applied: `google_place_id → domain → phone (last 9) → name+city`. 399 placeId dups + 1,108 secondary-key dups removed.
- Import script committed: `scripts/import-czech-shops.mjs` (fetches directly from Apify datasets; no local JSON file). Idempotent on `google_place_id`.
- Apify cost: ~$50. Duration: ~2 hours (parallel wave launches).
- Plan + actuals: `_reference/scrape-plan-CZ.md` in planning vault.

### MillionVerifier replaces Prospeo /email-verifier (Prospeo deprecated it Feb 2026)
- **Bug discovered:** Prospeo's new deprecation response shape `{req_status:false, error_code:"DEPRECATED"}` bypassed our `data.error` check — every verify call silently mapped to `"unknown"` and poisoned the DB. Rolled back ~100 bogus stamps via `UPDATE discovered_shops SET email_status=NULL, email_verified_at=NULL WHERE email_verified_at > now() - interval '30 minutes'`.
- **New reusable module:** `scripts/lib/email-verify.mjs` — `verifyEmail()`, `mapMillionVerifierResult()`, `shouldSkipVerification()`, `sleep()`. **Throws loudly** on any provider-side error (`result === 'error'` OR non-empty `error` field) — no silent mapping. Freshness cache: valid=90d, invalid=30d, risky=7d, catch_all/unknown always retry.
- **New parameterized script:** `scripts/verify-emails.mjs --country <CC>` replaces the old `verify-czech-emails.mjs`. Flags: `--limit N`, `--concurrency N` (default 20, 80 is safe — MV SMTP handshake is ~7s/call), `--only-null` (skip already-verified rows), `--dry-run`, `--no-snapshot`. Halts on credit/quota/auth errors instead of eating credits blind. Paginates Supabase reads past the 1000-row cap.
- **CZ verification run:** 2,849 emails verified via MV. Final distribution: **2,102 valid / 494 risky / 510 catch_all / 121 invalid / 0 unknown**. MV credits burned: ~2,000 (~$0.70).
- **Prod API routes swapped (UNCOMMITTED on main — CC, please merge):**
  - `src/app/api/discovery/verify-email/route.ts` — Prospeo call replaced with inlined MV helper (same throw-on-error pattern), early return if `MILLIONVERIFIER_API_KEY` missing.
  - `src/app/api/contacts/verify-email/route.ts` — same swap, applied to the `/contacts` bulk-verify flow.
  - Both routes still use the existing workspace-guard + 50-row cap + 200ms throttle patterns. No interface changes.
  - **Env var needed in prod:** `vercel env add MILLIONVERIFIER_API_KEY production` — Jacob's local key is in `.env.local` and `.env.local.example` has the documented stub.

### Action items for CC next session
1. Review + commit the two uncommitted route edits. No other code depends on them.
2. Run `npm run build && npm run lint && npx tsc --noEmit` before merging (pre-existing tiptap/test-insert type errors are unrelated to the MV swap — verified via `grep verify-email`).
3. After merge, remind Jacob to run `vercel env add MILLIONVERIFIER_API_KEY production` so the in-app Verify button works in prod.
4. (Optional) `scripts/verify-czech-emails.mjs` is now dead code — safe to delete.

### Slovakia (SK) kickoff staged
- Approved plan: `_reference/scrape-plan-SK.md` (planning vault).
- Kickoff prompt: `_prompts/cowork-prompt-sk-scrape-kickoff.md` — paste into a fresh Cowork session.
- Expected: ~2,200–3,200 unique, ~$24–32 Apify, 1.5–3 hours.

---

## 2026-04-21 — Phase SE-Stockholm-4a: ServiceFinder migration + utilities + Stockholm pilot

- **Branch**: `feature/se-stockholm-4a-servicefinder-migration-utils-pilot` → PR #55
- **PRs**: 2 commits — migration + utilities, then website-extractor bugfix
- **Build**: ✅ `npm run build` clean, `npm run lint` clean, `node --test` 5/5 pass
- **Deploy**: Vercel auto-deploys; no UI changes in this phase

### Phase A — Migration (Kundbolaget `ugibcnidxrhcxflqamxs`)
- Applied `20260422010000_servicefinder_dorunner_schema.sql`
- Added 17 new columns: `servicefinder_id/state/area_served/jobs_completed`, `dorunner_rating/review_count/url/slug/jobs_completed`, `partial_org_number`, `logo_url`, `photos`, `f_skatt_registered`, `bankid_verified`, `insurance_carrier`, `insurance_amount_sek`, `warranty_years`
- Created `discovered_shop_reviews` table with idempotent upsert, FTS index, RLS off
- Regenerated `coverage_stats` view with new ratios
- Verification: 17 columns ✅, reviews table 0 rows ✅, coverage_stats returns 3,200 Stockholm rows ✅

### Phase B — Shared utilities
- `scripts/lib/supabase-kundbolaget.mjs` — dedicated Kundbolaget Supabase client
- `scripts/lib/normalize.mjs` — extended with `normalizeDomain/Phone/Name` aliases, `makeReviewId`, `isStockholmsLan`, `postalToState` (backward-compat with existing callers)
- `scripts/lib/shop-merger.mjs` — `upsertShop` (6-key priority match, additive merge, event log) + `upsertReview` (idempotent via SHA1 key)
- `scripts/lib/__tests__/normalize.test.mjs` — 5/5 tests pass via `node --test`

### Phase C — Stockholm pilot (`scrape-servicefinder.mjs`)
- Discovery crawl: 9 trades × 24 Stockholm cities = 216 requests → **136 unique profiles discovered**
- SF listing pages cap at 8-12 results per trade/city combo regardless of pagination — national run (4b) should use full sitemap or ID range scan
- Profile fetch: 136 fetched, **89 skipped** (non-Stockholm postal code), **47 processed**
- Merge results: **40 inserts** (new to DB) + **7 updates** (enriched existing shops) + **134 reviews** inserted
- Run ID: `bf3150ba-b072-4c74-a466-000a2ad91dd7` — status: `complete`

#### Bug found + fixed during pilot
False-positive domain match: SF profiles link to `mittanbudmarketplaces.com` (shared marketplace), causing all 46 profiles to match the same existing shop via `normalized_domain`. Fixed by adding a `SHARED_PLATFORM_DOMAINS` blocklist in `extractExternalWebsite()`. Rerun after fix yielded correct results.

### Spot-checks (5 profiles, all pass)
| Profile | Name | phone ✅ | rating ✅ | reviews SF / DB | Trust signals |
|---|---|---|---|---|---|
| 9290469 | Mackans Måleri AB | +46729086280 | 5.00 | 26 / 3* | — |
| 6969645 | Rörservice & Montering Stockholm AB | +46707207543 | 4.80 | 49 / 3* | — |
| 9070974 | AK GIPSPUTS AB | +46763197851 | 5.00 | 5 / 3* | bankid ✅, folksam ✅ |
| 6822464 | Din Bygg & Städ i Sverige AB | +46760548789 | 4.92 | 13 / 3* | länsförsäkringar ✅ |
| 7042391 | A.E Entreprenad AB | +46760808131 | 4.66 | 32 / 3* | bankid ✅ |

*SF ld+json only includes the 3 most recent reviews — full review count stored in `servicefinder_review_count`.

### Coverage stats delta (Stockholms län subset)
| Metric | Phase 3 end | After 4a pilot |
|---|---|---|
| Total shops in state | 3,200 | 3,241 |
| % on ServiceFinder | 0% | 1.5% (47 shops) |
| Reviews in `discovered_shop_reviews` | 0 | 134 |
| % with logo_url | 0% | 1.3% |
| % f_skatt_registered = TRUE | 0% | 0.0% (1/47)* |
| % bankid_verified = TRUE | 0% | 30% among SF profiles (14/47) |
| Avg SF review count (matched) | — | 21.6 |
| Insert vs update ratio | — | 40:7 (85% new) |

*f_skatt hits rarely: SF profiles don't typically display F-skatt status explicitly. Phase 4b should add `F-skattesedel` variant to regex.

### Notes for Phase 4b
- Discovery: listing pages cap at 8-12 per trade/city regardless of pagination. For national run, use full profile ID range scan or sitemap from SF partner API
- Reviews: only 3 per profile (ld+json truncation). Accept as-is or add separate review endpoint scrape
- f_skatt regex: needs `F-skattesedel` and `F-skattegodkänd` variants
- `partial_org_number`: extracted from `taxID` field — 40/47 profiles had this populated

---

## 2026-04-21 — Phase SE-Stockholm-2: Gap-fill scrape + Contact enrichment

- **Branch**: `feature/stockholm-phase2-gapfill-enrichment` → PR #52
- **Scripts added**: `scripts/orchestrate-stockholm-gapfill.mjs`, `scripts/enrich-stockholm-contacts.mjs`, `scripts/lib/normalize.mjs`
- **Target DB**: Kundbolaget (`ugibcnidxrhcxflqamxs`) — not Wrenchlane

### Pass A — Gap-fill scrape (google_maps / stockholm_metro_gapfill)
- **Run ID**: `71d9174e-14b0-4f49-ab4e-2fd7d46618e6`
- **Jobs**: 32/32 launched and completed (28 missed cells + 4 byggfirma sub-grid cells), **0 failures**
- **Wave batching**: waves of 5 — no memory-cap hits (vs Phase 1 that lost 28 jobs fire-and-forget)
- **Sub-grid results**: NE=54, NW=287, SE=237, SW=327 — all under 500-cap (no further sub-grid needed)
- **Rows**: 1,907 fetched → 1,559 unique kept → **746 inserted** (new), **813 merged** into existing Phase-1 rows (merge-not-clobber — only filled NULLs)
- **Cost**: $6.36

### Pass B — Contact-info enrichment (contact_info_scraper / stockholm_metro_enrichment)
- **Run ID**: `dafe3beb-ba9e-4bf3-9fe3-f6b7b6d14a26`
- **Actor**: `vdrmota/contact-info-scraper` (fixed from Phase 1's 404-ing `apify/contact-info-scraper`)
- **URL field**: `originalStartUrl` (actor uses this, not `url` — discovered mid-run, fixed and restarted)
- **Coverage**: 1,529/2,542 URLs returned results (60.2%) — 5 of 17 batches failed/aborted on Apify's side
- **Shops updated**: 1,080 enriched with new emails/phones/social links
- **New MX-valid emails**: 41 newly found and verified
- **Cost**: $63.69 (**over the ≤$20 budget** — vdrmota actor cost ~$5/1,000 pages × depth-1 crawl; batches also leaked credits from first aborted run attempt)

### Coverage deltas (Stockholms län, target DB)
| Metric | Phase 1 (2,454 rows) | Phase 2 (3,200 rows) | Delta |
|--------|---------------------|---------------------|-------|
| Total rows | 2,454 | 3,200 | +746 (+30.4%) |
| pct_with_phone | 80.2% | 79.9% | −0.3 pp |
| pct_with_website | ~79% | 79.4% (2,542) | ≈0 |
| pct_with_primary_email | ~56% | 63.4% (2,030) | +7.4 pp |
| pct_with_mx_valid_email (all rows) | ~55.7% | 48.2% (1,542) | −7.5 pp (diluted by unverified new rows) |
| pct_with_mx_valid_email (rows with email) | ~98.9% | **75.9%** | — |
| Nacka rows | 116 | 125 | +9 ✓ (≥100 criterion met) |
| Södertälje rows | 101 | 197 | +96 |
| Cert flags populated | 0% | 0% | — (deferred) |

### Success criteria status
- ✅ All 32 Pass-A jobs launched in batched waves (no silent drops)
- ✅ Pass-A scrape_runs closed with counts + cost
- ✅ Every Pass-A shop has a data_source_events row
- ✅ Nacka/Täby ≥ 100 rows (125 ✓)
- ✅ Every Pass-B shop has a data_source_events row
- ✅ pct_with_mx_valid_email (of rows with email) ≥ 70% → **75.9%** ✓
- ⚠️ Pass-B URL coverage 60.2% (5/17 batches failed — goal was ≥95%)
- ❌ Cert flags not populated — `vdrmota/contact-info-scraper` returns no page text; needs a separate Cheerio/Playwright text-scraping pass
- ❌ Phase-2 cost $70.05 total (≤$20 goal) — vdrmota is ~$5/1,000 pages not $0.002/page as prompt assumed; first aborted run also leaked credits

### Notable decisions / skipped
- First Pass B attempt killed mid-run after discovering URL field mismatch (`url` vs `originalStartUrl`) — abandoned run marked `failed` in scrape_runs
- Cert flags deferred to Phase SE-Stockholm-3 using a cheaper text-scraper (apify/cheerio-scraper or similar)
- `.env.local` symlinked in worktree to unblock Next.js build (pre-existing issue: worktrees don't inherit parent env files)

---

## 2026-04-14 — Sequence UX: threading hint + delete action

- **Branch**: `feature/sequence-threading-ux-and-delete` → PR pending
- **What was built**:
  - **Threading hint (overview page)**: Non-first email steps with no `subject_override` now show `Re: <prior email step's subject>` in italic slate-600 with an indigo `Threaded reply` badge (`CornerDownRight` icon). Tooltip explains the Gmail threading behaviour. First email step with no subject still shows `No subject` (real problem state).
  - **Threading hint (editor)**: `EmailStepEditor` gained `isFirstEmailStep?: boolean` prop. When `false`, a `text-xs text-slate-500` helper line renders under the Subject input explaining to leave it blank for threading. Propagated through `StepCard` → `SequenceBuilder` (computes first email step ID from sorted email steps).
  - **Delete sequence**: New `DELETE /api/sequences/[id]` handler — deletes in FK order (`email_events` → `email_queue` → `sequence_enrollments` → `sequence_steps` → `sequences`), nullifies `inbox_messages.email_queue_id` to preserve reply history, logs an activity trail before deletion, blocks with `400` if sequence is active with live enrollments.
  - **Delete UI**: Delete menu item (below Archive with separator) in `SequenceList` action menu, visible for all statuses. Opens a modal requiring exact sequence name match before the red "Delete forever" button enables.
- **Build status**: TypeScript clean (`tsc --noEmit` — no output), ESLint clean. Build prerender failure is pre-existing env-var issue (no `.env.local` in worktree), unrelated to this session.
- **Notable decisions**: `inbox_messages.email_queue_id` is nullified (not deleted) on sequence delete — preserves contact reply history. Activity log entry written before deletion for audit trail.

---

## 2026-04-02 — Phase 24: Tasks & Daily Queue

- **Branch**: `feature/phase24-tasks-daily-queue` → **PR #29**
- **What was built**: (1) `tasks` table — migration applied via Supabase MCP; RLS + indexes on `(workspace_id, due_date)` and `(workspace_id, contact_id)`, `update_updated_at` trigger; (2) API routes — `GET/POST /api/tasks` (list with filter params + create), `PATCH/DELETE /api/tasks/[id]`, `GET /api/tasks/count` (due+overdue count for sidebar badge); (3) `/tasks` page — filter tabs (All / Due Today / Overdue / Upcoming / Completed), overdue section with red left border, quick-add inline form (collapses to placeholder), inline edit/snooze/delete per card; (4) Sidebar — Tasks nav item between Inbox and Templates with `CheckSquare` icon + red badge polling `/api/tasks/count` every 60s; (5) `check-replies` cron — expanded contact query to include `first_name`/`last_name`; creates high-priority email task when enrollment stops on real reply, medium-priority for non-enrollment real replies (guarded with `createdFollowUpTask` flag); (6) Open tracking — hot-lead detection: call-type high-priority task at 3+ opens without reply, deduped via `ilike('title', 'Hot lead:%')` + `is('completed_at', null)`; (7) Contact detail — "Add Task" button opens modal pre-filled with `Follow up with {first_name}` and tomorrow 9am due date
- **Files changed**: 9 — `supabase/migrations/20260401190000_phase24_tasks.sql` (new), `src/lib/database.types.ts`, `src/app/api/tasks/route.ts` (new), `src/app/api/tasks/[id]/route.ts` (new), `src/app/api/tasks/count/route.ts` (new), `src/app/(dashboard)/tasks/page.tsx` (new), `src/components/sidebar.tsx`, `src/app/api/cron/check-replies/route.ts`, `src/app/api/tracking/open/[trackingId]/route.ts`, `src/components/contacts/contact-detail-client.tsx`
- **Migration**: Applied to `wdgiwuhehqpkhpvdzzzl` via Supabase MCP — `tasks` table with RLS, indexes, and `update_updated_at` trigger
- **Build status**: ESLint clean, `tsc --noEmit` clean; `npm run build` pre-existing env-var failure in worktree (not caused by this session)
- **Next step**: Phase 25 — A/B Testing

---

## 2026-04-01 — Phase 22: AI Email Writer

- **Branch**: `claude/priceless-stonebraker` → **PR #27**
- **What was built**: (1) `POST /api/ai/generate-email` — core AI route using `claude-haiku-4-5-20251001` with embedded Wrenchlane ICP/product context; supports generate-from-scratch (3 persona angles: shop_owner, service_advisor, technician) and personalize-existing-template mode; daily rate limiting at 50 generations/workspace tracked in new `daily_email_gen_count` / `daily_email_gen_date` columns; (2) "Generate with AI" in `EmailStepEditor` — Sparkles button opens `GenerateModal` inline in the same file; user picks persona, generates draft, can edit subject/body before inserting; step number + sequence name threaded through `SequenceBuilder → StepCard → EmailStepEditor` for accurate follow-up context; (3) "Personalize email" on contact detail — Wand2 button in activity header opens `PersonalizeModal`; fetches workspace templates, user selects one, AI generates contact-tailored version using contact's name/title/company/location; read-only output with per-field Copy buttons — does not auto-insert
- **Files changed**: 7 — `supabase/migrations/20260401180000_phase22_ai_email_writer.sql` (new), `src/app/api/ai/generate-email/route.ts` (new), `src/components/sequences/email-step-editor.tsx`, `src/components/sequences/step-card.tsx`, `src/components/sequences/sequence-builder.tsx`, `src/app/(dashboard)/sequences/[id]/edit/page.tsx`, `src/components/contacts/contact-detail-client.tsx`
- **Migration**: Applied to `wdgiwuhehqpkhpvdzzzl` — 2 new columns on `workspace_ai_settings` (`daily_email_gen_count INTEGER DEFAULT 0`, `daily_email_gen_date DATE`)
- **Build status**: Build clean, lint zero warnings, `tsc --noEmit` zero errors
- **Next step**: Phase 23 — Step-Level Analytics & Dashboards

---

## 2026-04-01 — Phase 21: Templates & Snippets

- **Branch**: `claude/trusting-galileo` → **PR #26**
- **What was built**: (1) Snippet library — `snippets` table, CRUD API routes (`/api/snippets`, `/api/snippets/[id]`), `SnippetList` component with category badges + editor modal supporting 6 categories (general, intro, objection, pricing, next_steps, closing); (2) Templates page tabs — Templates | Snippets two-tab layout in `TemplateList`, header button adapts label/action per tab; (3) SnippetPicker in `EmailStepEditor` — scissors-icon dropdown grouped by category inserts snippet body at textarea cursor position alongside existing VariablePicker; (4) Template version history — `TemplateEditor` auto-snapshots current state to `template_versions` before each update (capped at 20), shows collapsible history panel with per-version subject preview and one-click restore; (5) Token fallback warnings — preflight route scans email step content for `{{tokens}}`, maps to contact fields, counts contacts missing any used field, surfaced in `LaunchCampaignModal` as an info `PreflightItem`
- **Files changed**: 10 — `supabase/migrations/20260401170000_phase21_templates_snippets.sql` (new), `src/lib/database.types.ts`, `src/app/api/snippets/route.ts` (new), `src/app/api/snippets/[id]/route.ts` (new), `src/components/templates/snippet-list.tsx` (new), `src/components/templates/template-list.tsx`, `src/components/templates/template-editor.tsx`, `src/components/sequences/email-step-editor.tsx`, `src/app/api/sequences/[id]/preflight/route.ts`, `src/components/sequences/launch-campaign-modal.tsx`
- **Migration**: Applied to `wdgiwuhehqpkhpvdzzzl` via Supabase MCP — 2 new tables (`snippets`, `template_versions`), RLS policies using `get_user_workspace_ids()`, trigger `update_snippets_updated_at` for auto-timestamp maintenance
- **Build status**: Build clean, lint zero warnings, `tsc --noEmit` zero errors
- **Next step**: Phase 22 — AI Email Writer

---

## 2026-04-01 — Phase 20: Prospector Upgrade

- **Branch**: `feature/phase20-prospector-upgrade` → **PR #25**
- **What was built**: Three Prospector improvements — (1) "In CRM" blue badges: after search results load, fires `/api/prospector/check-in-crm` (matches by placeholder email pattern or `linkedin_url`) and overlays a badge on already-imported contacts; (2) search result caching: page-1 results are stored in `prospector_search_cache` keyed by SHA-256 filter hash with 24h TTL, cache hit returns `cached: true` + `cachedAt` and the UI shows "(cached — X ago)"; (3) saved searches: filter sets can be named and saved to `prospector_saved_searches`, shown in a sidebar panel above filters with one-click load and hover-to-delete; "Save search" button appears in the results top bar
- **Files changed**: 7 — `supabase/migrations/20260401160000_phase20_prospector_upgrade.sql` (new), `src/lib/database.types.ts`, `src/app/api/prospector/check-in-crm/route.ts` (new), `src/app/api/prospector/search/route.ts`, `src/app/api/prospector/saved-searches/route.ts` (new), `src/app/api/prospector/saved-searches/[id]/route.ts` (new), `src/app/(dashboard)/prospector/page.tsx`
- **Migration**: Applied to `wdgiwuhehqpkhpvdzzzl` via Supabase MCP — 2 new tables (`prospector_saved_searches`, `prospector_search_cache`), RLS policies using `get_user_workspace_ids()`, unique index on `(workspace_id, search_hash)` for upsert
- **Build status**: Build clean, lint zero warnings (fixed `useCallback` missing dep), `tsc --noEmit` zero errors (pre-existing unrelated `.next/dev` error excluded)
- **Next step**: Phase 21 — Templates & Snippets

---

## 2026-04-01 — Phase 18: Contact Data Model Upgrade

- **Branch**: `feature/phase18-data-model-upgrade` → **PR #23**
- **What was built**: Migration adds 7 new real columns to `contacts` (`title`, `city`, `country`, `linkedin_url`, `seniority`, `email_status`, `email_verified_at`) and 7 to `companies` (`country`, `city`, `linkedin_url`, `tech_stack`, `revenue_range`, `founded_year`, `description`); partial unique index on `companies(workspace_id, domain)`; backfill from `custom_fields` (additive); `database.types.ts` updated for both tables; `add-contacts` route writes to real columns instead of `custom_fields` and now passes `email_status`; Prospector page passes `linkedin_url`; contacts list has new Title column; contact detail shows email_status badge + read-only Title/Location/LinkedIn fields
- **Files changed**: 7 — `supabase/migrations/20260401150000_phase18_data_model_upgrade.sql` (new), `src/lib/database.types.ts`, `src/app/api/prospector/add-contacts/route.ts`, `src/app/(dashboard)/prospector/page.tsx`, `src/components/contacts/contacts-page-client.tsx`, `src/components/contacts/contact-detail-client.tsx`, `src/components/lists/filter-builder.tsx`
- **Migration**: Applied to `wdgiwuhehqpkhpvdzzzl` via Supabase MCP
- **Build status**: TypeScript clean (`tsc --noEmit` zero errors); lint zero warnings; pre-existing prerender env-var build failure on `/login` (unrelated, same as previous phases)
- **Next step**: Phase 19 — Email Verification

---

## 2026-03-31 — Phase 12a: Prospector (Contact Discovery via Prospeo.io)

- **Branch**: `claude/festive-dirac` → **PR #14**
- **What was built**: Full Prospector feature — `/prospector` page with filter panel (countries multiselect with Nordic countries at top, job title freetext comma-separated, industry pill toggles, company size pills) + results table (pagination, row checkboxes, bulk action bar), Reveal & Add to CRM modal (list assignment, skip duplicates option, progress feedback, partial success reporting)
- **API routes** (both server-side, key never exposed to client):
  - `POST /api/prospector/search` — proxies to Prospeo search-person; builds filters from UI state; handles all error codes (INSUFFICIENT_CREDITS → 402, RATE_LIMITED → 429, INVALID_FILTERS → 400, NO_RESULTS → empty response)
  - `POST /api/prospector/add-contacts` — sequential processing with 100ms delays; enriches via Prospeo enrich-person (1 credit/contact); upserts company by domain; inserts contact with `source='prospector'`; handles list create or assign; returns `{added, skipped, errors}`
- **Migration**: `supabase/migrations/20260331000000_add_contacts_source.sql` — adds `source TEXT` column to contacts; applied to prod via Supabase MCP
- **Types**: `database.types.ts` updated with `source` field on contacts Row/Insert/Update
- **Sidebar**: Prospector added between Lists and Templates with `Search` icon
- **Notable decisions**: title/city/country stored in `custom_fields` (contacts table has no dedicated columns); contacts without verified email get placeholder email `prospector_noemail_{person_id}@placeholder.invalid` to satisfy NOT NULL; company upsert uses domain lookup to avoid duplicates
- **Build status**: TypeScript compiled clean; pre-existing prerender build failures on `/settings/pipelines` and `/contacts/import` (missing Supabase env vars locally — unrelated to this PR)
- **What Jacob needs to do**: Add `PROSPEO_API_KEY` to `.env.local` and Vercel env vars after signing up at prospeo.io

---

## 2026-03-31 — Phase 10: Campaign Execution Infrastructure

- **What was built**: Full campaign launch flow — `LaunchCampaignModal` (2-step: pick list → preflight checklist + send rate estimate → enroll), `GET /api/sequences/[id]/preflight` (auth-verified: checks Gmail, email steps, missing data, already-enrolled), analytics page at `/sequences/[id]/analytics` (8 stat cards: enrolled/sent/open/reply/click rate, bounce rate, unsub rate, completed; per-step bar chart via existing `SequenceAnalyticsTab`; paginated enrollment table with status filter), "Launch Campaign" primary button + "View Analytics →" link on sequence detail page, bounce suppression check in `process-emails` cron (cancels queued emails for bounced/unsubscribed contacts)
- **Files changed**: 6 — `src/app/api/cron/process-emails/route.ts`, `src/components/sequences/launch-campaign-modal.tsx` (new), `src/app/api/sequences/[id]/preflight/route.ts` (new), `src/app/(dashboard)/sequences/[id]/analytics/page.tsx` (replaced placeholder), `src/app/(dashboard)/sequences/[id]/page.tsx`, `e2e/campaign-launch.spec.ts` (new, 3 tests)
- **Migration**: None — all 18 tables already existed
- **Test result**: TypeScript clean (`tsc --noEmit` zero errors); E2E suite not re-run from worktree (pre-existing env-var build issue in worktree environment); PR #13 open for review
- **Next step**: Jacob merges PR #13, then pull + proceed to next phase per roadmap

---

## 2026-03-29 — Health Check & Deep Clean

- **What was built**: Full hygiene pass — ESLint fixed to zero (created `eslint.config.mjs` since Next.js 16 removed `next lint`), TypeScript clean, 8 merged remote branches deleted, 2 npm audit vulnerabilities fixed, `zod` removed (unused), dead code deleted (PipelineChart, test-insert debug route, 3 unused lib exports)
- **Files changed**: 21 files — `eslint.config.mjs` (new), `package.json/lock`, `CLAUDE.md`, `.env.local.example`, `sequence-builder.tsx` (extracted inline component), `list-detail-client.tsx` (useMemo for filters), 8 hook dep fixes, 3 unused-export removals
- **Migration**: None
- **Test result**: 33/33 E2E tests passing against production (unchanged)
- **Next step**: Phase 10 (campaign execution infrastructure) — prompt is ready in `docs/prompts/`

---

## Earlier Sessions (before log was established)

Phases 1–9 complete. App live at https://crm-for-saas.vercel.app. Pre-10 bugs fixed (Gmail connect UX, enrollment flow). 33/33 E2E tests passing. Phase QA (Playwright suite) written and passing.

---

## 2026-03-31 — Phase 14: Inbox + Reply Management

- **Branch**: `feature/inbox-reply-management`
- **What was built**:
  - **DB migration** (`supabase/migrations/20260401000000_inbox_messages.sql`): Added `gmail_thread_id TEXT` to `email_queue`; created `inbox_messages` table (16 columns, RLS, trigger, indexes); applied to prod via Supabase MCP
  - **database.types.ts**: Added `gmail_thread_id` to email_queue Row/Insert/Update; added full `inbox_messages` table definition
  - **process-emails cron** (`src/app/api/cron/process-emails/route.ts`): After successful send, fetches the Gmail message to get `threadId` and stores it in `email_queue.gmail_thread_id` (non-fatal if this fails)
  - **check-replies cron** (full rewrite): Now polls Gmail threads for real replies — groups sent emails by (sender_account_id, gmail_thread_id), calls `threads.get` once per thread, skips messages from our own address, deduplicates via `inbox_messages.gmail_message_id UNIQUE`, inserts `inbox_messages` rows + `email_events` reply records, updates contact `last_contacted_at`, creates activity records; bounce detection logic preserved from previous implementation
  - **API routes** (5 routes):
    - `GET /api/inbox` — list messages with filter (all/unread/interested/not_interested/out_of_office), pagination, contact+queue joins
    - `PATCH /api/inbox/[id]` — update is_read and category; auto-qualifies contact when category→'interested'
    - `GET /api/inbox/[id]/thread` — returns unified outgoing+incoming thread sorted by timestamp
    - `POST /api/inbox/[id]/reply` — sends reply via Gmail API with In-Reply-To header, creates activity
    - `GET /api/inbox/unread-count` — returns `{ count }` for sidebar badge
  - **Inbox page** (`src/app/(dashboard)/inbox/`): Two-panel layout — left: filterable conversation list with unread dot, contact avatar, preview snippet, category badge, relative timestamp; right: thread view with outgoing/incoming messages styled differently, action bar (Interested/Not Interested/OOO/Read toggle), category dropdown, contact link, collapsible reply composer
  - **Sidebar**: Added Inbox nav item between Prospector and Templates with `Inbox` icon; polls `/api/inbox/unread-count` every 60s and shows red badge with count
  - **E2E tests** (`e2e/inbox.spec.ts`): 3 smoke tests — GET /api/inbox, GET /api/inbox/unread-count, PATCH with nonexistent ID
- **Build status**: TypeScript compiled clean; zero errors; all 32 routes generated
- **Notable decisions**: Reply detection uses thread polling (not push webhooks) since no Pub/Sub setup; stop_on_reply logic in check-replies now correctly triggers off real reply events; manual replies from inbox are not tracked (no pixel/link wrapping) since they're human-initiated; lint script is pre-existing broken (no eslint.config.mjs in repo)

---

## 2026-04-01 — Phase 12b: Prospector Bug Fix + Search UI Upgrade

- **Branch**: `claude/elegant-tereshkova`
- **PR**: #16
- **Files changed**: `src/app/(dashboard)/prospector/page.tsx`, `src/app/api/prospector/search/route.ts`
- **What was built**:
  - **Bug fix**: `company_headcount_range` values corrected to Prospeo's exact API enum — previous values ("11-50", "51-200", "1001-5000") didn't exist in their API, causing 400 on all size-filtered searches
  - **Size filter**: Now multi-select pill toggles (8 buckets: 1–10 through 5001+); was single-select radio buttons
  - **Seniority filter**: New multi-select pills using all 10 Prospeo-valid values; added `seniorities` field to `Filters` type and `SearchRequestBody`; sends `person_seniority` to Prospeo API
  - **Industry values**: Updated to Prospeo's exact enum strings (e.g. "Repair and Maintenance", "Motor Vehicle Manufacturing")
  - **Job title input**: Replaced textarea with tag-input — Enter or comma adds tag, × removes; suggested chips (Workshop owner, Verkstadschef, etc.) shown as dimmed clickable chips; `jobTitlesRaw: string` → `jobTitles: string[]`
  - **Minimum filter guard**: Toast error if none of country/title/industry/seniority are set before search
  - **Result count**: Changed "contacts found" → "matching profiles"
- **Build status**: TypeScript clean (tsc --noEmit passes); 1 pre-existing lint warning (no-html-link-for-pages in modal, untouched code)
- **Notable decisions**: Build itself fails on /settings/pipelines prerender (pre-existing Supabase env var issue in static build, not related to these changes)

---

## Phase 12c — Prospector Complete API Fix + UI Rebuild
**Date:** 2026-04-01
**PR:** #17
**Branch:** claude/epic-hodgkin

### What was built
- Rewrote `src/app/api/prospector/search/route.ts`: updated `SearchRequestBody` type to include `personCountries`, `keywords`, `verifiedEmailOnly`, `maxPerCompany`; fixed `person_location` → `person_location_search`; added `company_keywords`, `person_contact_details`, `max_person_per_company` filter blocks
- Rewrote `src/app/(dashboard)/prospector/page.tsx`: new `Filters` type with `personCountries` (was `countries`), `keywords`, `verifiedEmailOnly` (default true), `maxPerCompany` (default 1); filter panel reorganized with section headers (Who / Where / Company / Quality); added Company Keywords text input; added Verified emails only toggle; added Max per company number input
- Fixed industry values: `"Vehicle Repair and Maintenance"` (was `"Repair and Maintenance"`), added `"Automotive"`, `"Car Dealers"`, `"Parts & Wholesale"`, fixed `"Transportation Logistics Supply Chain and Storage"` (no commas)
- Updated search guard to also check `keywords.trim().length > 0`
- Replaced `<a>` nav with `<Link>` for `/contacts` and `/lists/:id` (lint fix)

### Build status
TypeScript: 0 errors. Lint: 0 warnings. Build: compiled successfully (pre-existing `/contacts/import` prerender error unrelated to this session).

---

## 2026-04-01 — Phase 12d: Prospector Bilingual Job Title Search

- **Branch**: `claude/great-taussig` → **PR #18**
- **What was built**:
  - Replaced mixed-language `SUGGESTED_JOB_TITLES` with clean English-only list (8 automotive titles)
  - Added `COUNTRY_LANGUAGE` map (11 countries) and `JOB_TITLE_TRANSLATIONS` table (8 titles × 6 languages)
  - Added helper functions: `getActiveLanguages`, `getTranslations`, `buildSearchTitles`
  - Job title chips now display translation labels beneath them when countries with known languages are selected
  - New "Search in X only" checkbox — conditionally shown when relevant; unchecked = English + local; checked = local only (with English fallback for untranslatable titles)
  - `buildSearchPayload` now expands job titles via `buildSearchTitles` before sending to Prospeo
  - Added `localOnly: boolean` to `Filters` type and `DEFAULT_FILTERS`
- **Only file changed**: `src/app/(dashboard)/prospector/page.tsx`
- **Build**: TypeScript clean (`npx tsc --noEmit` passes). Lint clean. Build error is pre-existing worktree env issue (Supabase vars not set), not related to this change.

---

## Phase 12e — AI Prospector Filter

- **Date**: 2026-04-01
- **Branch**: `claude/relaxed-chatelet` → PR TBD
- **What was built**:
  - Installed `@anthropic-ai/sdk`
  - Created `supabase/migrations/20260401120000_workspace_ai_settings.sql` — new `workspace_ai_settings` table with RLS policies using `get_user_workspace_ids()` pattern; applied via Supabase MCP
  - `src/app/api/settings/ai-filter/route.ts` — GET/POST to fetch and upsert ICP prompt + filter_enabled flag per workspace
  - `src/app/api/prospector/ai-filter/route.ts` — POST endpoint that calls `claude-haiku-4-5-20251001` to evaluate prospect profiles against the workspace ICP; returns good/maybe/poor verdicts with reasons; graceful fallback on AI failure
  - `src/app/(dashboard)/settings/ai-filter/page.tsx` — ICP editor with toggle, 12-row textarea pre-filled with Wrenchlane ICP, Save button, and inline test tool
  - Updated `src/app/(dashboard)/settings/page.tsx` — added AI Lead Filter card with Sparkles icon
  - Updated `src/app/(dashboard)/prospector/page.tsx`:
    - Added `FitVerdict` type and `FitBadge` component (good/maybe/poor with tooltip)
    - New state: `verdicts`, `aiCheckLoading`, `fitFilter`, `aiFilterEnabled`, `smartReveal`
    - `useEffect` on mount fetches AI filter enabled status from settings API and loads `smartReveal` from localStorage
    - `handleAiCheck` — sends selected profiles to AI filter API, stores verdicts, auto-deselects poor fits
    - AI Check button in action bar (only when filter enabled)
    - Smart Reveal toggle in action bar (only after first check)
    - `handleBulkAdd` skips poor fits when Smart Reveal is on
    - Fit filter bar (All / Good / Maybe / Poor tabs) above table when verdicts exist
    - Fit column in results table; poor-fit rows dimmed at 50% opacity
    - `displayedResults` derived from `fitFilter` state
- **Build**: TypeScript ✓, lint ✓, tsc --noEmit ✓ (prerender error in worktree is env-var issue, not code)
- **Note**: Supabase types don't include new table yet — used `(supabase as any)` cast in API routes; types will resolve after `supabase gen types` is run post-deploy

---

## Phase 15 — Sequence Reliability & Stop Logic
**Date:** 2026-04-01 | **PR:** #20 | **Branch:** feature/phase15-sequence-reliability

- **OOO detection**: Added `isAutoReply()` to check-replies cron; checks RFC headers (auto-submitted, x-autoreply, x-auto-response-suppress, precedence) and multilingual OOO subject patterns (EN/SV/NO/DA/DE/FI). OOO messages stored with `is_auto_reply=true`, `category='out_of_office'`, still create email_event + activity but do NOT trigger unenrollment. Tracks `realRepliesFound` vs `autoRepliesFound` separately.
- **Company-level stop**: After real reply triggers stop_on_reply, finds all other active enrollments where contact has same `company_id`, sets them to `company_paused`, cancels scheduled queue items, creates activity records per paused contact. Controlled by new `stop_on_company_reply` setting (default true) in SequenceSettings.
- **Per-enrollment Pause/Resume + Pause All**: New `PATCH /api/sequences/enrollments/[id]` (pause/resume) and `POST /api/sequences/[id]/pause-all`; analytics page has per-row action buttons; sequence detail page has "Pause All" button with confirmation modal. `company_paused` status badge added.
- **Email threading**: process-emails looks up most recent sent email in enrollment, passes `gmail_message_id` as `replyToMessageId` (In-Reply-To/References headers) and `gmail_thread_id` as `replyToThreadId` to Gmail API; prepends "Re: " to subject for follow-up steps. Also fixed dead code in `send.ts` (threadId was `? undefined : undefined`).
- **Health badges**: `GET /api/sequences/health` returns auth_issue/high_bounces/paused_count per sequence; sequence-list loads these once and renders inline color-coded badges.
- **Migration applied**: `inbox_messages.is_auto_reply boolean DEFAULT false` — applied to Supabase project wdgiwuhehqpkhpvdzzzl.
- **Build**: TypeScript ✓, lint ✓, tsc --noEmit ✓. 13 files changed, 3 new API routes, 1 migration file.

---

## Phase 16 — Smart Throttling & Circuit Breaker
**Date:** 2026-04-01 | **Branch:** feature/phase16-smart-throttling | **PR:** #21

### What was built

- **Send jitter** (`process-emails/route.ts`): Cron now sends at most 1 email per sender per run. After the first send, remaining items in the sender's batch are rescheduled with random 30–120s delays (×position index). This avoids robotic back-to-back sending without risking Vercel function timeouts from `sleep()`.
- **Circuit breaker** (`process-emails/route.ts`): Before each sender loop, checks 24h bounce rate. If `recentSends >= 20` AND `bounceRate > threshold`: auto-pause the gmail_account (status='paused', pause_reason=message), cancel all scheduled queue items for sender, insert system activity record. Threshold read from `workspaces.sending_settings.bounce_threshold` (default 8%).
- **New API: PATCH /api/settings/email/[accountId]**: Updates account `max_daily_sends`, `status`, `pause_reason`. Resuming (status→active) auto-clears `pause_reason`. Auth-checks workspace membership.
- **New API: GET/PATCH /api/settings/sending**: Reads/writes `workspaces.sending_settings` JSONB. Returns defaults (`default_max_daily_sends: 50`, `bounce_threshold: 8`) merged with stored values.
- **GmailAccountCard** updated: Shows `paused` (red) badge, displays `pause_reason` text in alert box, Resume button (green, Play icon) calls PATCH → status active. Disconnect now calls PATCH API instead of direct Supabase client write.
- **EmailSettingsClient** updated: Loads workspace sending settings via new API. Adds "Workspace Defaults" card with today's total sends (read-only), editable `default_max_daily_sends` and `bounce_threshold %` inputs, Save button.
- **Migration** (`20260401130000_phase16_smart_throttling.sql`): `gmail_accounts.pause_reason TEXT`, `workspaces.sending_settings JSONB DEFAULT '{}'` — applied to wdgiwuhehqpkhpvdzzzl.
- **database.types.ts**: `pause_reason` on gmail_accounts Row/Insert/Update; `sending_settings` on workspaces Row/Insert/Update; new `WorkspaceSendingSettings` type exported.

### Build status
TypeScript ✓, lint ✓ (0 warnings), tsc --noEmit ✓. 7 files changed (3 new), 1 migration applied.

### Notable decisions
- One-email-per-sender-per-run approach chosen over `sleep()` to stay within Vercel function time limits
- Circuit breaker requires ≥20 sends before triggering (prevents single-bounce false positives on new accounts)
- Bounce rate uses a two-step query (get queue IDs for sender, then count bounces) — no RPC needed

---

## Phase 17 — Compliance & DNC
**Date:** 2026-04-01
**Branch:** feature/phase17-compliance-dnc
**PR:** (see below)

### What was built
- **`suppressions` table** — unified suppression list (email + domain blocking, reason tracking, soft deletes). Applied via Supabase MCP. Migrated existing `unsubscribes` rows into it on creation.
- **database.types.ts** — added `suppressions` table TypeScript types.
- **Unsubscribe route** — now inserts into `suppressions` alongside existing `unsubscribes` upsert (backward compat kept).
- **check-replies route** — bounce detection now also inserts into `suppressions` after updating contact status.
- **process-emails route** — replaced `unsubscribes` table check with `suppressions` check; now covers both email-level AND domain-level blocks.
- **preflight route** — added `suppressedCount` to the response (counts email + domain suppressions for the list).
- **launch-campaign-modal** — shows orange warning "X contacts suppressed (unsubscribed, bounced, or DNC) — will be skipped" in preflight.
- **prospector add-contacts** — checks `suppressions` before inserting each contact; returns `suppressed` count in response.
- **`POST /api/contacts/[id]/forget`** — GDPR erasure endpoint: adds email to suppressions, cancels pending emails, deletes all related records, deletes contact, logs anonymized activity.
- **Contact detail UI** — "Delete & Forget (GDPR)" button with confirmation modal.
- **Settings → Compliance & DNC page** — stats bar (total/breakdown by reason), paginated suppression table with reason badges, Add Email / Add Domain dialogs, CSV bulk import (papaparse), Remove (soft delete) per row.
- **Compliance API routes** — `GET/POST /api/settings/compliance`, `PATCH /api/settings/compliance/[id]`, `POST /api/settings/compliance/import`.
- **Incidental fix** — added `export const dynamic = 'force-dynamic'` to `/contacts/import` page (was failing to prerender due to missing Supabase client init at build time).

### Build status
- `npm run build` ✅
- `npm run lint` ✅ (0 errors, 0 warnings)
- `npx tsc --noEmit` ✅

### Notable decisions
- `created_by` column on `suppressions` stored as plain UUID (no FK) — `workspace_members.user_id` has no unique constraint.
- Actual `unsubscribes` schema uses `unsubscribed_at` (not `created_at`) — migration adjusted accordingly.
- Suppression check in `process-emails` uses `.or()` with both email and domain to cover domain blocks in one query.
- Preflight suppression count may slightly overcount if both email+domain match same contact — acceptable as it's a warning.
- `unsubscribes` table kept untouched for backward compatibility.
---

## Phase 19 — Email Verification
**Date:** 2026-04-01
**Branch:** feature/phase19-email-verification
**PR:** #24

### What was built
- **`POST /api/contacts/verify-email`**: Calls Prospeo `email-verifier` API, maps status (VALID/RISKY/CATCH_ALL/INVALID → valid/risky/catch_all/invalid), applies cache rules (valid→90d, invalid→30d, risky→7d skip), caps at 50 contacts per call with 200ms delay, returns `{verified, skipped, errors, results}`.
- **Contact detail page** (`contact-detail-client.tsx`): `VerifyEmailButton` component added next to email_status badge — shows static "Verified/Invalid + date" label when recently cached, otherwise shows active Verify button with spinner; updates contact state and toasts on success.
- **Contacts list bulk action** (`contacts-page-client.tsx`): "Verify Emails" button added to bulk action bar between Add to List and Delete; confirmation modal with credit cost warning; `handleBulkVerify` calls API, toasts result, refreshes list.
- **Preflight route** (`sequences/[id]/preflight/route.ts`): Extends contact query to include `email_status`, computes `invalidEmailCount` and `unverifiedEmailCount`, returns both in response.
- **LaunchCampaignModal** (`launch-campaign-modal.tsx`): `PreflightData` interface extended; two new `PreflightItem` entries — "warn" for invalid emails (will bounce), "info" for unverified emails (consider verifying).

### Build status
- `npm run build` ✅
- `npm run lint` ✅ (0 errors)
- `npx tsc --noEmit` ✅ (pre-existing `.next/dev` error unrelated to this phase)

### No migration needed
All storage uses `email_status` + `email_verified_at` columns from Phase 18.

### Next step
Phase 20: Prospector Upgrade

---

## Phase 23 — Analytics & Dashboards
**Date:** 2026-04-01 | **Branch:** feature/phase23-analytics-dashboards | **PR:** #28

- **sequence-analytics-tab.tsx** — replaced raw-count bar chart with rate-based grouped bar chart (Open %/Click %/Reply % per step); added horizontal funnel drop-off panel showing sent counts and % drop between adjacent steps (hidden if <2 steps); added `⭐ Most replies` indigo badge on the table row with the highest reply rate (min 5 sends to qualify)
- **template-list.tsx + GET /api/analytics/template-stats** — added inline Performance column (`X sends · Y% open · Z% reply`) per template; added Sort dropdown (Newest / Name / Reply Rate); new API route aggregates sent/open/reply/click rates by joining sequence_steps → email_queue → email_events, grouped by template_id
- **sequence-list.tsx** — added Bounce % column (was missing); Reply % and Bounce % column headers are now client-side sortable with toggle asc/desc arrows; sorting works on in-memory array with no extra fetches
- **deliverability-panel.tsx + GET /api/analytics/send-volume** — new dashboard panel embedded below Contact Growth; contains 30-day Sent/Replied/Bounced area chart, sender account health table (daily sends vs limit, 7d bounce rate, status badge + pause reason), and suppression summary line (`Total suppressed: X (Y bounced · Z unsubscribed · W manual/DNC)`); new API route returns last-30-day time series
- **Build:** TypeScript clean, ESLint clean, `next build` Turbopack compile passes; prerender error for /login is pre-existing (missing Supabase env vars in build environment — not a code issue)

---

## Phase 25 — Shop Discovery Page (`/discovery`)
**Date:** 2026-04-02 | **Branch:** claude/sharp-hodgkin | **PR:** TBD

### What was built
- **`GET /api/discovery/shops`** — paginated list with filters: `country_code`, `status` (default: new+enriched), `has_email`, `has_phone`, `search` (name/city/domain ilike). Default hides imported/skipped.
- **`GET /api/discovery/stats`** — aggregate totals: `total`, `by_status`, `by_country`, `with_email`, `with_phone`. Used for header stats bar and status tab counts.
- **`POST /api/discovery/promote`** — bulk promote shops to CRM; checks duplicate by domain then by name; inserts company (name, website, domain, phone, city, country) + placeholder contact (first_name="Owner", last_name=shop.name, source="discovery"); marks `status='imported'`; returns `{promoted, skipped_duplicates}`. Uses service role client.
- **`POST /api/discovery/skip`** — sets `status='skipped'` for given shop_ids. Uses service role client.
- **`src/app/(dashboard)/discovery/page.tsx`** — thin server wrapper with `<Suspense>`.
- **`src/components/discovery/discovery-page-client.tsx`** — full client component:
  - Header with title + stats bar (total/email/phone counts)
  - Status pill tabs (New+Enriched default, New, Enriched, Imported, Skipped, All)
  - Filters: country dropdown (populated from stats), has_email/has_phone checkboxes, debounced search
  - 4 stats cards (Showing, With email on page, With phone on page, Already imported on page)
  - Paginated table with 11 columns + checkbox column; name cell opens inline detail popover (address, all_emails, all_phones, Instagram/Facebook/Maps links)
  - Per-row three-dot menu: Promote, Skip, View on Google Maps
  - Sticky bulk action bar (bottom-center) when rows are selected; Promote + Skip buttons
- **Sidebar** — added `Discovery` nav item with `MapPin` icon, placed after Prospector.

### Build status
- `npx tsc --noEmit` ✅ 0 errors
- `npm run lint` ✅ 0 warnings
- `npm run build` ✅ TypeScript + compile pass; prerender error for /contacts is pre-existing (Supabase env vars absent in build env — not a code issue)

### Decisions
- `discovered_shops` has no TypeScript types in `database.types.ts`, so explicit `as { ... }` cast used in stats route to satisfy type checker.
- Promote flow creates a placeholder contact email `discovery_noemail_{id}@placeholder.invalid` when no `primary_email` present (mirrors the prospector pattern).
- Stats route fetches all rows and aggregates in JS — acceptable at 814 rows; can be replaced with SQL aggregation if volume grows.

---

## Fix: Discovery Promote Route — Full Field Mapping
**Date:** 2026-04-02 | **PR:** #31 | **Branch:** claude/condescending-bhaskara

### What was built
- Updated `DiscoveredShop` type in `src/app/api/discovery/promote/route.ts` to include all Phase 25 fields
- `.select()` now fetches: `address`, `street`, `postal_code`, `all_emails`, `all_phones`, `instagram_url`, `facebook_url`, `rating`, `review_count`, `category`
- Company insert maps all new fields plus `tags: ['independent']`
- Contact insert maps all new fields plus `is_primary: true`, `lead_status: 'new'`, `status: 'active'`, `email_status: 'unknown'`, `language` (via `deriveLanguage()`)
- Added `deriveLanguage(countryCode)` helper: EE→et, SE→sv, FI→fi, LV→lv, LT→lt, NO→no, DK→da

### Build status
- `npx tsc --noEmit` ✅ 0 errors
- `npm run lint` ✅ 0 warnings
- `npm run build` ✅ TypeScript + compile pass; prerender error for /settings/pipelines is pre-existing (Supabase env vars absent at build time)

### Decisions
- Contact email falls back to `''` (empty string) instead of the old `discovery_noemail_...@placeholder.invalid` pattern, per spec.

---

## Phase 25: Contact & Company Detail Pages — Full Field Visibility
**Date:** 2026-04-02 | **PR:** #32 | **Branch:** feature/detail-pages-phase25-fields

### What was built
- `contact-detail-client.tsx`: added title/seniority as editable fields; `is_primary` checkbox (shown when company is set); Location section (address, postal_code, city, country, country_code, language dropdown with et/sv/fi/lv/lt/no/da options); Additional Emails & Phones chip arrays; Social Links section (linkedin/instagram/facebook editable with ExternalLink); Tags & Notes section (tag chips, notes textarea, source read-only); `updateArrayField` helper; `updateField` now accepts `boolean` for is_primary; `SocialLinkField` local component
- `company-detail-client.tsx`: added phone, website (clickable link with edit), category dropdown, description textarea, revenue_range, founded_year; Location section; Google Maps Data section (google_place_id with copy button, rating + review count shown when present); Parent Company dropdown with link to parent + child companies list (fetched in load()); Social Links; Tags & Notes; `updateArrayField` helper; `SocialLinkField` local component
- `src/components/ui/array-chips-field.tsx`: new shared component — horizontal chip list with add/remove, default and tag (indigo) variants
- `src/components/ui/editable-textarea.tsx`: new shared component — click-to-edit textarea with save/cancel, syncs on external value changes
- `src/lib/database.types.ts`: added Phase 25 fields to contacts Row/Insert/Update (is_primary, tags, notes, all_emails, all_phones, address, postal_code, country_code, language, instagram_url, facebook_url) and companies Row/Insert/Update (tags, notes, phone, website, category, address, postal_code, country_code, google_place_id, rating, review_count, parent_company_id, instagram_url, facebook_url)

### Build status
- `npx tsc --noEmit` ✅ 0 errors
- `npm run lint` ✅ 0 warnings
- `npm run build`: TypeScript phase passes ✅; prerender failure for /settings/pipelines is pre-existing (Supabase env vars absent at build time)

### Decisions
- Google Maps Data section only renders when at least one of google_place_id/rating/review_count is set (avoids empty section for non-scraped companies)
- `SocialLinkField` defined locally in each file to avoid prop complexity (same pattern in both files)
- Types updated manually in database.types.ts (no Supabase CLI available in worktree env)

---

## Phase: Email Verification UI — Discovery Page
**Date:** 2026-04-02
**Branch:** claude/nostalgic-tu
**PR:** #33

### What was built
- Added `email_valid: boolean | null` and `email_check_detail: string | null` to the `Shop` type in `discovery-page-client.tsx`
- Email column now renders: green `CheckCircle` badge for `email_valid = true`, red `XCircle` badge with tooltip for `email_valid = false` (tooltip maps detail codes to human-readable text), unchanged mailto link for `null`
- Added `verified_email: boolean` to `Filters` type with default `false`; new "Verified email" checkbox in filter bar passes `verified_email=true` to the API
- `shops/route.ts`: added `verified_email` query param → `query.eq("email_valid", true)`
- `promote/route.ts`: added `email_valid` to select and `DiscoveredShop` type; invalid-email shops are split out before the loop, marked `skipped` in DB, and `skipped_invalid_email` count returned in response
- Toast updated to show invalid email skip count

### Build status
- `npm run build`: TypeScript clean; static prerender fails in worktree (no `.env.local` — pre-existing, not caused by this PR)
- `eslint`: exit 0, no warnings
- `npx tsc --noEmit`: exit 0, no errors

### Notable decisions
- Used `<span title={...}>` wrapper around `XCircle` instead of `title` prop directly — Lucide's `LucideProps` doesn't expose `title` on SVG components

---

## Phase 18: Multi-Sender Selection & Sender Pinning
**Date:** 2026-04-02
**PR:** #34
**Branch:** claude/relaxed-engelbart

### What was built
- `src/components/gmail/sender-account-selector.tsx` — reusable dropdown showing all connected Gmail accounts with daily capacity (sent/max), disabled state for paused/rate-limited accounts; default = "Auto-rotate across all accounts" (null)
- `src/app/api/gmail/accounts/route.ts` — GET route returning accounts with `remaining_capacity`, no sensitive fields
- Added `SenderAccountSelector` to all 3 enrollment flows: `launch-campaign-modal.tsx`, `enroll-in-sequence-modal.tsx`, `enroll-contacts-modal.tsx`; `senderAccountId` passed to `/api/sequences/enroll`
- `src/lib/sequences/enrollment.ts` — enrollment insert now sets `sender_account_id: assignedSenderId` (pinning the sender to the enrollment record)
- `src/app/api/cron/process-emails/route.ts` — subsequent emails use `enrollment.sender_account_id` (pinned sender); if pinned sender is inactive, falls back to `getNextSender()` and re-pins enrollment; imported `getNextSender`
- `src/app/api/sequences/[id]/preflight/route.ts` — response extended with `senderAccounts[]`, `totalDailyCapacity`, `estimatedDaysToSend`; launch modal updated to show multi-sender capacity summary
- `src/app/(dashboard)/sequences/[id]/analytics/page.tsx` — added Sender Breakdown section (per-sender: emails sent, open rate, reply rate) between per-step chart and enrollment table

### Build status
- `npm run build`: compiled + TypeScript pass; prerender error on /login is pre-existing env var issue (no .env.local in worktree)
- `npm run lint`: exit 0
- `npx tsc --noEmit`: exit 0

### Notable decisions
- Used native `<select>` for sender picker (consistent with rest of codebase); capacity info shown inline in option text + info line below selected account
- Backward compatible: null sender = auto-rotate = same as previous behavior; existing enrollments with `sender_account_id = null` fall back to `senderAccountId` from the queue item in the cron

---

## Phase 19 — Multi-User Workspace
**Date:** 2026-04-02
**PR:** #35
**Branch:** claude/vigilant-hamilton

### What was built
- `src/app/(auth)/auth/callback/route.ts` — Domain-based auto-join: when a new user has no workspace membership, looks up workspaces by email domain using service-role client (bypasses RLS). If a match is found, inserts them as `member`. If no match, creates new workspace with domain stored for future auto-joins.
- `src/app/api/settings/team/route.ts` — GET endpoint: returns all workspace members with auth profile (full_name, email, avatar_url via `auth.admin.getUserById`) and their connected Gmail accounts.
- `src/components/settings/team-settings.tsx` — Team Members list with avatar, name, role badge (Owner/Member), joined date, connected Gmail account pills.
- `src/app/(dashboard)/settings/page.tsx` — Added Team Members section at top of settings page.
- `src/components/sidebar.tsx` — Added current user's Google avatar/initials + name/email display at the bottom of the sidebar.
- `src/components/settings/gmail-account-card.tsx` — Added optional `connectedByName` prop to show "Connected by [Name]" below the email address.
- `src/components/settings/email-settings-client.tsx` — Fetches team members from `/api/settings/team` and passes `connectedByName` to each card (only shown when workspace has >1 member).

### Build status
- `npm run build`: pre-existing prerender/Supabase env var failure (confirmed by testing before/after stash — same failure class on different page)
- `npx eslint src/`: exit 0
- `npx tsc --noEmit`: exit 0

### Notable decisions
- Used service-role client only for the domain lookup and new-member insert; regular session client used for all else in the callback.
- `connectedByName` only renders in the Gmail card when the workspace has >1 member (single-user view stays clean).
- Workspace domain was already set to `wrenchlane.com` on the production workspace — verified via Supabase SQL, no migration needed.
- Activity attribution (item 7 from prompt) not built: `activities.user_id` column already exists in the schema; activity creation code wasn't touched since adding the column is already done and attribution display in the feed wasn't specified as a required UI change in the phase prompt.

---

## Session: Sequence Detail UX Clarity + Contacts Table Columns
- **Date:** 2026-04-14
- **PR:** #38
- **Branch:** feature/sequence-detail-ux-clarity

### What was built

**Part A — Action button clarity**
- `src/components/sequences/launch-campaign-modal.tsx` — Renamed title "Launch Campaign" → "Enroll List", success message "Campaign Launched!" → "Contacts Enrolled!", CTA "Launch Campaign →" → "Enroll contacts →"
- `src/app/(dashboard)/sequences/[id]/page.tsx` — New top-right action bar (View Analytics | ⋯ menu | Start/Pause Sending | Enroll List). Amber banner when paused/draft. `toggleStatus` lifted from SequenceHeader to the page. Extended `load()` to fetch sending status (gmail accounts + next scheduled send + last sent_at from email_queue).
- `src/components/sequences/sequence-header.tsx` — Removed Activate/Pause button. Added `SendingStatus` prop (exported interface). Added sending-status strip (3 items: sender account, next send, last sent). Removed `Play`/`Pause` imports.
- `e2e/campaign-launch.spec.ts` — Updated test to check for "Enroll List" button instead of "Launch Campaign".

**Part B — Contacts tab (5 → 9 columns)**
- `src/components/sequences/sequence-contacts-tab.tsx` — Added Company, Last activity, Next send, Sent columns. Step column now shows "2 / 5 · Email" format. Single email_queue query with nested email_events (no N+1). Table wrapped in overflow-x-auto. Accepts new `steps` prop from page.

### Build status
- `npx eslint src/`: exit 0
- `npx tsc --noEmit`: exit 0
- `npm run build`: pre-existing failure on `/tasks` page (Phase 24, already on main before this branch)

### Notable decisions
- `sent` event type doesn't exist in `email_events` (only open/click/reply/bounce/unsubscribe). "Last sent" activity is sourced from `email_queue.sent_at` where `status='sent'` instead.
- Sending status strip queries run in parallel via `Promise.all` to avoid adding latency.
- `formatDistanceToNow` from date-fns for relative times; `format(date, "MMM d, HH:mm")` for absolute next-send time.

---

## Sequence UX — Duplicate (country+language) + Threading hint + Delete
**Date:** 2026-04-14
**PRs:** direct commit `2cd3979` (duplicate dialog — Cowork bypassed CC flow), #37 (threading hint + delete)
**Branch:** main (duplicate), feature/sequence-threading-ux-and-delete (#37)

### What was built
- **Duplicate dialog** (`src/components/sequences/sequence-list.tsx`) — clicking Duplicate opens modal with Country (EE/SE/FI/LV/LT/NO/DK) + Language (auto-fills default for country) selectors; duplicate name becomes e.g. `Cold Outreach (Estonia — Estonian)`. Language dropdown disabled until country chosen; confirm disabled until both set; live preview of new name shown.
- **Threading hint** (`src/app/(dashboard)/sequences/[id]/page.tsx`, `src/components/sequences/email-step-editor.tsx`, `step-card.tsx`, `sequence-builder.tsx`) — non-first email steps with blank subject_override show `Re: <prior subject>` in italic + "Threaded reply" badge (CornerDownRight icon); editor Subject input shows helper text explaining blank = same Gmail thread.
- **Delete sequence** (`src/app/api/sequences/[id]/route.ts` new DELETE route; list component modal) — FK-ordered cascade (email_events → email_queue → sequence_enrollments → sequence_steps → sequences); nullifies `inbox_messages.email_queue_id` to preserve reply history; logs activity entry; returns 400 if active with live enrollments; UI requires typing exact sequence name to enable "Delete forever".

### Build status
- Deploy: Ready on Vercel (59s build)
- E2E: 39/39 passing against https://crm-for-saas.vercel.app

### Notable decisions
- Duplicate dialog: sequence table has no language/country column, so info lives in the name suffix only (no schema change).
- Delete: soft-preserves inbox reply history by nullifying FK rather than cascading; active+enrolled sequences are blocked from deletion (must be archived first).
- Cowork violation logged: the duplicate dialog was edited directly instead of via CC prompt flow. Feedback memory saved (`feedback_always_use_cc_prompt_flow.md`) — future code changes must go through git pull → CC prompt → PR → Cowork merge.

---

## Phase: Rich Email Editor (TipTap)
**Date:** 2026-04-14
**PR:** #39
**Branch:** feature/rich-email-editor

### What was built
- **`src/components/sequences/tiptap-variable-extension.ts`** — Custom TipTap inline atom Node for variables. Vanilla DOM NodeView renders blue pill chip with human-readable label (e.g. "First name"). Serializes to `<span data-variable="first_name">{{first_name}}</span>` via `renderHTML` for the send pipeline. Exposes `insertVariable` command.
- **`src/components/sequences/rich-email-editor.tsx`** — Full TipTap v2 editor wrapping StarterKit + Underline + Link + Placeholder + CharacterCount + VariableExtension. Toolbar: B/I/U, link dialog, bullet/numbered list, clear formatting, + Variable dropdown. Min-height 240px, max-height 500px with scroll. Legacy plain-text content (no HTML tags) auto-migrates to `<p>` on load. External value changes (template/AI inject) sync via `setContent({ emitUpdate: false })`.
- **`src/components/sequences/email-preview-frame.tsx`** — Sandboxed `<iframe>` with Gmail-ish CSS (`-apple-system` fonts, `max-width: 600px`, proper paragraph margins). `previewInterpolate()` replaces span-wrapped and bare `{{var}}` with sample values for in-editor preview.
- **MOD `src/components/sequences/email-step-editor.tsx`** — Replaces `<textarea>` + `VariablePicker` + cursor-insertion logic with `RichEmailEditor`. Preview mode uses `EmailPreviewFrame`. Snippet picker still present (appends to body).
- **MOD `src/components/templates/template-editor.tsx`** — Same swap; removes `VariablePicker` + `bodyRef`. Preview mode uses `EmailPreviewFrame`.
- **MOD `src/lib/sequences/variables.ts`** — `resolveVariables()` now handles both `<span data-variable="x">{{x}}</span>` (TipTap serialized) and bare `{{x}}` (backward compat). `ensureUnsubscribeLink()` detects span variant to avoid duplicate footer.
- **NEW `src/lib/sequences/__tests__/variable-interpolation.test.ts`** — 19 unit tests (tsx runner): bare vars, span-wrapped vars, legacy label spans, mixed, ensureUnsubscribeLink edge cases. All 19 passing.
- **NEW `e2e/email-editor.spec.ts`** — 5 Playwright tests: page loads without errors, can type in editor, variable chip inserts, preview iframe renders, existing sequences load without crash.

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- Unit tests: 19/19 ✅
- Pre-existing build failure on `/tasks` page (Supabase env vars missing during static gen) — not introduced by this PR; confirmed present on HEAD before branch.

### Notable decisions
- Chose vanilla DOM NodeView over ReactNodeViewRenderer — keeps extension a plain `.ts` file, simpler for a static non-interactive chip.
- Variables in the editor serialize with `{{x}}` text inside the span so the send-pipeline regex finds them even without parsing DOM. Backward compat with old plain-text sequences preserved via second regex pass.
- `sender_first_name` and `sender_company` variables added to both the extension and the variable dropdown (were missing from old VariablePicker); `variables.ts` returns empty string for these (populated by send pipeline from Gmail account).

---

## Discovery — Category Exclude Filter
**Date:** 2026-04-14
**PR:** #40
**Branch:** feature/discovery-category-filter

### What was built
- **`stats/route.ts`**: added `category` to select; added `by_category: Record<string, number>` aggregation (null → "Uncategorized") to the stats response.
- **`shops/route.ts`**: reads `exclude_categories` query param (comma-separated); applies PostgREST `or(category.not.in.(...), category.is.null)` so null-category rows are preserved while named categories are excluded.
- **`promote/route.ts`** + **`skip/route.ts`**: added `exclude_categories?: string[]` to the `filters` type; same exclusion filter applied in `select_all` mode so bulk actions honour the visible filter.
- **`discovery-page-client.tsx`**: added `by_category` to `Stats` type; added `excluded_categories: string[]` to `Filters` type; built `CategoryExcludeDropdown` component (checkbox dropdown, sorted alphabetically, shows counts, has Clear button, active state highlights button); wired into filter bar Row 2 between "Verified email" and search; `fetchShops`, `handlePromote`, and `handleSkip` all pass excluded_categories.

### Build status
- TypeScript: clean (no errors)
- Lint: clean
- Build: compiled successfully (pre-existing /tasks prerender env issue unrelated to this session)

### Notable decisions
- Used PostgREST `or(category.not.in.(...), category.is.null)` pattern to preserve null-category rows when exclusion filter is active (plain `not.in.()` would drop nulls in SQL semantics).
- Stats `by_category` is computed client-side in the same pass as `by_status`/`by_country` — no extra DB query needed.

## Discovery — Multi-Category Support
**Date:** 2026-04-14
**PR:** #41
**Branch:** feature/discovery-multi-category

### What was built
- **Migration** (`supabase/migrations/20260414000000_discovered_shops_all_categories.sql`): adds `all_categories TEXT[]` column + GIN index to `discovered_shops`. Applied to production.
- **SQL fallback backfill**: run directly via Supabase MCP — set `all_categories = ARRAY[category]` for all existing rows. EE: 807/814 updated, LT: 1971/1999 updated (rows with NULL category left as-is). All are single-cat arrays; LT full multi-cat requires the Apify backfill (see below).
- **`scripts/backfill-all-categories.mjs`**: one-shot script; Step 1 fetches LT dataset `96U2txGRRVKHyBPsF` from Apify and updates `all_categories` per row; Step 2 is the SQL fallback for any remaining null rows. Requires `APIFY_TOKEN` env var — not present in .env.local, so Step 1 was not run by CC.
- **`scripts/import-lithuania-shops.mjs`**: `processItem()` now includes `all_categories: categories` alongside `category: categories[0]`.
- **`shops/route.ts`**: replaced `exclude_categories` (exclude-list) with `categories` (include-list); applies Supabase `.overlaps("all_categories", categories)` — shop kept if any of its categories matches the included set.
- **`stats/route.ts`**: `by_category` now multi-cat-aware; iterates `all_categories` array, contributing +1 to each bucket per category; falls back to `category` field if `all_categories` is unset.
- **`promote/route.ts`** + **`skip/route.ts`**: updated `filters` type (`exclude_categories → categories`); overlap filter in `select_all` path.
- **`discovery-page-client.tsx`**: `CategoryExcludeDropdown` → `CategoryFilterDropdown`; `excluded_categories: string[]` → `included_categories: string[] | null`; default = null (all shown); unchecking a category removes it from the included set; button shows "All categories" or "Categories: N of M"; added "Select all" + "Clear" buttons.

### Build status
- TypeScript: clean
- Lint: clean
- Build: compiled successfully

### Notable decisions
- APIFY_TOKEN not in .env.local; ran SQL fallback directly via Supabase MCP instead of Step 1 of backfill script. LT multi-cat remains single-cat until Jacob runs `APIFY_TOKEN=your_token node scripts/backfill-all-categories.mjs`.
- Kept `category` column untouched; `all_categories` is additive, all old code still works.
- When `included_categories` is an empty array (`[]`), the API will apply `.overlaps("all_categories", [])` which returns no rows — this is the correct UX (user clicked "Clear", showing nothing until they re-select).

## Workflow Migration — CC Owns Merge+Deploy Loop
**Date:** 2026-04-14
**PR:** #42
**Branch:** chore/cc-owns-merge-deploy-loop

### What was built
- **`.github/workflows/e2e.yml`**: GitHub Actions CI with two jobs — `build-and-lint` (Node 20, `npm ci`, `npm run build`, `npm run lint`, `npx tsc --noEmit`) runs on all pushes and PRs to main; `e2e-prod` (Playwright, runs full E2E suite against production) runs only on push to main. Report uploaded as artifact on failure. CI is a safety net — CC does not wait for it.
- **`CLAUDE.md`**: Rewrote workflow sections. Removed "Sync Sequence" and "Cowork's Autonomous Merge + Deploy Loop" sections. Added `## Workflow` section at the top describing the new CC-owned loop (fetch/rebase → build → checks → push → PR → merge → verify deploy → log). Preserved all architecture, code conventions, and database schema sections.
- **`PROJECT-STATUS.md`**: Added workflow migration row to phase table. Updated Sync Sequence and merge/deploy loop sections. Updated Deployment note to reflect auto-deploy reconnected.
- **Vercel auto-deploy reconnected**: Ran `vercel git connect --yes` from `/Users/jacobqvisth/crm-for-saas` — GitHub repo reconnected to Vercel project `crm-for-saas`. Every push to main now triggers a production deploy automatically.

### Build status
- Lint: clean
- TypeScript: clean (no errors)
- Build: pre-existing `/tasks` prerender error due to missing env vars in worktree (noted in multiple prior sessions — not introduced by this session, no source code changed)

### Notable decisions
- `e2e-prod` job uses `secrets.TEST_BASE_URL` (already set in GitHub repo) — no new secrets needed.
- Used `--squash` merge flag throughout to keep main history clean.
- This PR is the first exercise of the new loop: CC merges it, Vercel auto-deploys, no Cowork hand-off needed.

## Latvia Scrape Artifacts Commit
**Date:** 2026-04-15
**PR:** #43
**Branch:** chore/latvia-scrape-import-script

### What was built
- **`scripts/import-latvia-shops.mjs`**: New import script for Latvia. Fetches 12 Apify datasets (Rīga ×2 by search term, 6 major cities, 4 regional residuals: Vidzeme/Latgale/Kurzeme/Zemgale). Deduplicates on `placeId`. Filters CSDD-operated state inspection stations. Modeled on `import-lithuania-shops.mjs`.
- **`PROJECT-STATUS.md`**: Added Latvia row to `discovered_shops data by country` table (973 shops, 35% email, 94% phone, 46 cities, imported 2026-04-15). Added `import-latvia-shops.mjs` to Import scripts list.

### Build status
- No app code changed — build/lint/tsc not run (docs + script only commit)
- Vercel deploy: no-op, site live (HTTP 307 → auth as expected)

### Notable decisions
- Script only committed — data was already in Supabase before this session (Cowork ran the import directly).
- No `scripts/latvia-shops-data.json` generated or committed — script fetches directly from Apify (same pattern as Lithuania).

---

## Session: Country filtering on Contacts + Lists
- **Date:** 2026-04-15
- **PR:** #44
- **Branch:** feature/country-filter

### What was built
- **`src/lib/lists/filter-query.ts`**: Added `country_code` to `FilterField` union, `FILTER_FIELDS` array (after Company), and `OPERATORS_BY_FIELD` (`is` / `is not` / `has no country` / `has a country`). Updated `describeFilter` to render country filter descriptions.
- **`src/components/lists/filter-builder.tsx`**: Fetches distinct `country_code`/`country` pairs from workspace contacts on mount; deduplicates and sorts alphabetically; passes as `countries` prop to `FilterRow`.
- **`src/components/lists/filter-row.tsx`**: Accepts `countries` prop; renders a `<select>` dropdown for `country_code` field showing friendly name + code (e.g. "Latvia (LV)").
- **`src/components/contacts/contacts-page-client.tsx`**: Added Country filter dropdown (distinct values, URL-persisted as `country_code` param), Country column (shows `country` name then `country_code` then `—`), sortable Country column header (asc/desc by `country_code`, nulls last, toggled locally).

### Build status
- `npm run build` ✅ | `npm run lint` ✅ | `npm run test:e2e:smoke` ✅ 8/8
- Vercel deploy: live (HTTP 307 → auth as expected)

### Notable decisions
- Sort state is local (not in URL) since no other column has sort — keeps it simple.
- Countries list deduplicates in JS rather than SQL DISTINCT since Supabase REST doesn't expose SELECT DISTINCT; performant for expected dataset sizes.

---

## Session: Fix dynamic list counts + sequence enrollment
- **Date:** 2026-04-15
- **PR:** #46
- **Branch:** feature/fix-dynamic-list-membership

### What was built
- **`src/lib/lists/filter-query.ts`**: Added `head` option to `buildFilterQuery` opts so callers can get counts without fetching rows. Added `ResolvableList` type and `resolveListContactIds()` helper — single source of truth for list membership resolution; branches on `is_dynamic` so it works for both static and dynamic lists.
- **`src/components/lists/list-table.tsx`**: Fixed Bug 1 — dynamic lists now show real contact counts (was `—`). Replaced sequential `for` loop with `Promise.all` for parallel count fetches; dynamic lists use `buildFilterQuery` with `{ count: 'exact', head: true }`.
- **`src/components/sequences/enroll-contacts-modal.tsx`**: Fixed Bug 2 — "From List" tab now calls `resolveListContactIds()` instead of reading `contact_list_members` directly, so enrolling a dynamic list works end-to-end.
- **`src/components/sequences/launch-campaign-modal.tsx`**: Fixed both the list selector (dynamic lists now show correct member count) and `handleLaunch` (uses `resolveListContactIds()` so dynamic list enrollment works).
- **`src/app/api/sequences/[id]/preflight/route.ts`**: Fetches list `is_dynamic`/`filters` metadata first; uses `buildFilterQuery` for dynamic lists so preflight contact analysis is accurate.

### Build status
- `npm run lint` ✅ | `npx tsc --noEmit` ✅ | build compiled without errors (worktree missing `.env.local` — prerender of `/tasks` fails as expected, unrelated to this change)
- Vercel deploy: live (HTTP 307 → auth as expected)

### Notable decisions
- Did not change `contact_list_members` writes — static lists still materialize members there. Only reads-for-resolution are redirected through `resolveListContactIds()`.
- `enroll-list-modal.tsx` and `export-csv-button.tsx` were already handling dynamic lists correctly; left untouched.

---

## Session: Phase SE-Stockholm-3 — Cert-flag + description enrichment
- **Date:** 2026-04-21
- **PR:** [#53](https://github.com/jacobqvisth/crm-for-saas/pull/53)
- **Branch:** feature/se-stockholm-3-cert-flags
- **Target DB:** Kundbolaget `ugibcnidxrhcxflqamxs`

### What was built
- **`scripts/lib/cert-flag-scraper.mjs`**: Node.js script that fetches each Stockholm shop's website directly (no Apify, $0 cost) using native `fetch` + `cheerio`. Per-shop: homepage + /om-oss variants + /tjanster variants + /kontakt. Extracts `description` (meta tag, 500-char cap), `about_text` (20k cap, homepage fallback if no /om-oss found), `services_text` (20k cap, NULL if no services page found), and runs 6 cert-flag regexes on combined text.
- **Cert flags populated (3-state):** NULL = fetch failed, TRUE = regex matched, FALSE = text fetched but no match.
- **`cheerio`** added as devDependency.

### Pass A results (n=3,200 Stockholms län rows)
| Metric | End of Phase 2 | End of Phase 3 |
|---|---|---|
| % with phone | 79.9% | 79.9% (unchanged) |
| % MX-valid email | 76.0% | 76.0% (unchanged) |
| % with description | ~0% | 55.4% |
| % with about_text | ~0% | 65.5% |
| % with services_text | ~0% | 28.2% |
| avg about_text length | — | 2,741 chars |
| % cert flags evaluated | 0% | 73.9% (2,364/3,200) |
| % with ≥1 cert flag TRUE | 0% | 20.5% |

Cert flag breakdown (2,364 evaluated): rot_advertised=555, esv=92, sv=80, bf=32, if=32, gvk=12.
Fetch failures: 178 (7% — offline/403/timeout sites; cert flags stay NULL).
Pages truncated at 20k chars: 14.

### Pass B (vdrmota retry)
No-op — straggler count was 0. All 2,542 shops already had `contact_info_scraper` events from Phase 2 Phase B.

### Build status
- Script-only change (no Next.js app changes). Pre-existing CI failures on main unrelated to this session.
- Vercel deploy: live (HTTP 307 → auth as expected).

### Notable decisions
- services_text target was ≥30%; achieved 28.2% — SMB sites often embed services on homepage rather than a dedicated page. Acceptable.
- about_text uses homepage as fallback (not NULL) when no /om-oss found, to maximize content coverage for the contractor detail page.

---

## Session: Select-all-matching on contacts + verify emails in discovery
- **Date:** 2026-04-21
- **PR:** [#56](https://github.com/jacobqvisth/crm-for-saas/pull/56)
- **Branch:** feature/select-all-contacts-and-verify-in-discovery

### What was built

**Part 1 — /contacts: "Select all matching filters"**
- Added `selectAllMatching` state to `contacts-page-client.tsx`. When all 50 page rows are selected and totalCount > page size, a Gmail-style banner appears: "All 50 on this page selected → Select all N matching current filters".
- Clicking the link sets `selectAllMatching = true`; a second banner confirms "All N selected → Clear selection".
- Action bar shows effective count (N total, not just page) while in selectAllMatching mode.
- Filter/page changes reset `selectAllMatching` automatically (via `useEffect` fetchContacts hook).
- All 4 bulk actions support both modes (`contactIds` array OR `filters` object):
  - `POST /api/contacts/verify-email` — added `filters` branch; resolves IDs server-side via `resolveContactIdsByFilters`, caps at 50, returns `capped: true` + `totalRequested`.
  - `POST /api/contacts/bulk-delete` — new route; accepts `contactIds` OR `filters`, caps at 5,000.
  - `POST /api/contacts/bulk-update-lead-status` — new route; same two-mode shape.
  - `POST /api/contact-lists/add-contacts` — new route; same two-mode shape.
- Extracted shared filter logic into `src/lib/contacts-filter.ts` (`ContactFilters` type + `resolveContactIdsByFilters` helper).

**Part 2 — /discovery: Verify emails before promote**
- Migration `20260421000000_discovered_shops_email_status.sql`: adds `email_status TEXT` + `email_verified_at TIMESTAMPTZ` to `discovered_shops`; backfills `email_valid=true → 'valid'`, `false → 'invalid'`; adds index. `email_valid` retained for backward compat.
- New `POST /api/discovery/verify-email`: accepts `{ shopIds }` OR `{ filters }` with same filter shape as promote/skip routes. Reuses Prospeo cache heuristics (90/30/7-day skip rules). Caps at 50 per call. Writes `email_status` + `email_verified_at` to shop row.
- Discovery page: added "Verify Emails" button (ShieldCheck) to bulk action bar; confirmation modal with credit warning; toast shows Valid/Risky/Invalid/Skipped breakdown; refetches shop list on success.
- Email column shows ✓ (green) for valid, ✓ (amber) for risky, ✓ (slate) for catch_all, ✗ (red) for invalid.
- `verified_email` filter now queries `email_status = 'valid'` (migration backfill makes this a no-op for existing data).
- Promote route (`promote/route.ts`) inherits `email_status` and `email_verified_at` from the shop row so promoted contacts land already-verified.

### Build status
- `npm run build` — clean (0 errors).
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- Vercel deploy: live (HTTP 307 → auth as expected).

### Notable decisions
- Kept `email_valid` column on `discovered_shops` — deferred removal to a future cleanup migration.
- No auto-verify-on-promote — Jacob wants manual control over Prospeo credit spend.
- Prospeo cap remains 50/click for discovery (same as contacts). Manual click-through is fine at current volumes.
- Pass B skipped after confirming 0 stragglers in DB.

---

## Phase SE-Stockholm-5 — Promote discovered_shops → contractor_directory
**Date:** 2026-04-21
**PR:** (pending)
**Branch:** `feature/phase-se-stockholm-5-promote`

### What was built
- **Migrations (Kundbolaget `ugibcnidxrhcxflqamxs`)**:
  - `20260423000000_extend_contractor_directory.sql` — adds ~35 columns to `contractor_directory` (description, cert flags, composite_rating, shop_score, reviews_recent JSONB, servicefinder_id, dorunner_slug, sources JSONB, discovered_shop_id back-ref, tags, etc.), 9 indexes, and the `contractor_directory_reviews_v` helper view. Column count 31 → 67.
  - `20260423000001_extend_public_status_check.sql` — extends the `public_status` CHECK to allow `'published'` / `'pending'` alongside the legacy trio.
- **`scripts/lib/se-chains.mjs`** — 17 SE chain patterns (Bravida, Assemblin, Elkedjan, Mekonomen, Beijer, etc.) with `detectChains()` helper.
- **`scripts/lib/slug.mjs`** — diacritic-aware `slugify()` (å→a, ö→o, é→e).
- **`scripts/promote-discovered-shops.mjs`** — dry-run-default promote pipeline. Match-key cascade (`discovered_shop_id` → `google_place_id` → `org_number` → `domain` → `phone` → `name+postal`), composite rating, shop_score 0–100, chain tags, slug generation with collision resolution + UUID fallback, reviews_recent JSONB snapshot, sources JSON, `scrape_runs` + `data_source_events` logging, paginated candidate fetch.
- **`package.json` scripts**: `promote:se-stockholm` (dry-run) + `promote:se-stockholm:commit` (live).
- **`_reference/promote-results-phase-5-2026-04-23.md`** — full results doc.

### Pilot results (Stockholms län)
- 3,551 candidates → 177 dropped by gating → 3,374 promotable → **3,075 directory rows** (299 merges absorbed via domain/phone cascade).
- 2,532 `published` / 543 `pending`.
- 0 duplicate `public_slug` values.
- `shop_score` peaks at 20–40 band; long tail to 78.
- Top scorer: *Svenska Eljouren - Stockholm*, shop_score 78, composite 4.24, 318 reviews.
- Idempotency re-run: 0 inserts, 0 updates. ✅

### Build status
- `npm run build` — clean (0 errors, all 60 routes built).
- `npm run lint` — clean.
- `npx tsc --noEmit` — clean.
- Deploy not applicable (scripts + migrations only, no runtime code surface).

### Notable decisions
- Kept the legacy `public_status` values (`listed`/`suppressed`/`pending_review`) alongside the new `published`/`pending` for back-compat; migration 20260423000001 widens the CHECK.
- Domain-step cascade intentionally collapses multi-location chain offices (Bravida, Assemblin, Ahlsell) into a single directory row — matches plan's match-key ordering. Follow-up phase can re-split by `google_place_id` if chain-location pages are desired.
- Error threshold set at 10-min-errors + 2% ratio (plan was 2% from first error, which was too tight — transient fetch failures aborted early).
- Script is resume-safe via `.neq('status','imported')` filter; first commit attempt aborted after 143 inserts and the second run cleanly continued from shop #144.
- `crm_company_id` column referenced in plan back-stamp step does not exist on `discovered_shops` — script back-stamps `status='imported'` only.

---

## Chore: mark discovered_shops as legacy — 2026-04-21

- **PR:** #60
- **Branch:** `chore/remove-stale-discovered-shops-doc`
- **Change:** CLAUDE.md — replaced "Discovery staging" bullet with "Legacy staging" note pointing scrape pipeline to jacobqvisth/result-insurance (Supabase ugibcnidxrhcxflqamxs). Table still exists in wdgiwuhehqpkhpvdzzzl but no longer written from crm-saas jobs.
- **Build:** lint + `tsc --noEmit` clean. `npm run build` skipped — worktree has no `.env.local`; docs-only change.
- **Deploy:** https://crm-for-saas.vercel.app — 307 to login (expected).

---

## Session: Prospeo → MillionVerifier route swap
- **Date:** 2026-04-22
- **PR:** #63
- **Branch:** `feature/mv-route-swap`
- **Changes:**
  - `src/app/api/contacts/verify-email/route.ts` — replaced Prospeo POST with MillionVerifier GET API; `mapProspeoStatus` → `mapMVStatus`; env var `PROSPEO_API_KEY` → `MILLIONVERIFIER_API_KEY`
  - `src/app/api/discovery/verify-email/route.ts` — same swap for the discovered_shops verifier
  - Status mapping: `ok`→valid, `error`→invalid, `unknown`→risky, catchall subresult→catch_all
- **Build:** `npm run build` fails locally (pre-existing — no `.env.local` in worktree); `npm run lint` and `npx tsc --noEmit` both clean
- **Deploy:** https://crm-for-saas.vercel.app (Vercel auto-deploy on merge to main)
- **Action required:** `MILLIONVERIFIER_API_KEY` must be added to Vercel prod env before verify-email routes will work. Run: `cd ~/crm-for-saas && vercel env add MILLIONVERIFIER_API_KEY production` (mark sensitive, paste key from `.env.local`)

---

## Session: Rich email editor — inline image upload + URL embed
- **Date:** 2026-04-24
- **PR:** #69
- **Branch:** `feature/rich-email-editor-images`
- **Merge commit:** `f6b5247`

### What was built
- **`src/components/sequences/rich-email-editor.tsx`**: Added `@tiptap/extension-image`. New toolbar image button, `ImageDialog` (upload via drop zone + URL field with live preview + alt text), drag-drop handler (`handleDrop`), paste handler (`handlePaste`), and full-editor drop-zone overlay. Google Drive share URLs (`drive.google.com/file/d/...` or `?id=...`) are auto-normalized to `drive.google.com/thumbnail?id=...&sz=w1200`.
- **`src/app/api/email-images/upload/route.ts`** (NEW): `POST` accepts `{ workspaceId, file }` multipart. Auth'd via `createClient()` + workspace_member check. Service client writes to `email-images` bucket at `{workspaceId}/{userId}/{timestamp}-{uuid}.{ext}`. 5 MB cap; MIME whitelist `image/jpeg,png,gif,webp`. Returns `{ url, path }`. Also `ensureEmailImagesBucket` creates bucket on first call for safety.
- **`supabase/migrations/20260423010000_email_images_storage.sql`** (NEW): Creates public `email-images` bucket with 5 MB limit + MIME whitelist. `SELECT` policy grants public read (bucket is public so images embed in Gmail). **Migration applied to prod project `wdgiwuhehqpkhpvdzzzl` via MCP during session.**
- **`src/components/sequences/email-preview-frame.tsx`**: Added `img { display:block; max-width:100%; height:auto; margin:12px 0 }` to the inline email CSS so previews match Gmail rendering.
- **`src/components/sequences/email-step-editor.tsx`** + **`src/components/templates/template-editor.tsx`**: Pass `workspaceId` prop down to `RichEmailEditor` so uploads know which workspace to authorize against.
- **`package.json`**: Added `@tiptap/extension-image@^3.22.4`.

### Build status
- `npm run lint` ✅ clean
- `npx tsc --noEmit` ✅ clean
- `npm run build` ✅ compiled in 6.1s, 61 routes built
- Deploy: https://crm-for-saas.vercel.app (HTTP 307 → auth as expected)

### Notable decisions
- Public bucket + service-role-write pattern (rather than RLS-gated user-role writes) — write authz lives in the API route, not in a storage policy. Simpler, same security since the route checks workspace membership.
- `allowBase64: false` on the TipTap Image extension to force uploads (prevents DataURI bloat in the stored HTML).
- No DB migration for sequence/template rows — images are embedded in `body_html`/`body_override` as `<img src="...">`, no schema change.
- Vault prompt `cc-prompt-phase-rich-email-editor.md` was the spec for the base TipTap swap (already shipped in 15d2f08). This image-support follow-on was not pre-prompted.

---

## Session: Country dropdowns always show all supported targets
- **Date:** 2026-04-30
- **PR:** [#86](https://github.com/jacobqvisth/crm-for-saas/pull/86)
- **Branch:** `fix/lists-country-filter`
- **Merge commit:** `c29ec66`

### What was built
Country dropdowns across the UI only listed countries that already had data in the table they were filtering, so newly-targeted markets (UK, LT, SK, etc.) were not selectable until the first row existed. Reproducing on prod: `/lists` → Create List → Country filter showed only CZ/EE/LV/RS even though we now scrape GB, LT, SK, etc. Same issue on `/contacts` and `/discovery`.

All three filters now seed from `SUPPORTED_OUTBOUND_COUNTRIES` in `src/lib/countries.ts` (CZ, DK, EE, FI, GB, LT, LV, NO, RS, SE, SK) and union in any extra ISO codes that actually appear in the underlying data — so a fresh scrape with an unexpected code (PL, IE, etc.) still auto-appears without a code change.

- **`src/components/lists/filter-builder.tsx`** (commit `6513192`, originally PR #86's first commit): Create-List dialog country filter. Always seeds the dropdown from `SUPPORTED_OUTBOUND_COUNTRIES`, then unions in any `country_code` present in `contacts`.
- **`src/components/contacts/contacts-page-client.tsx`**: `/contacts` page top-bar country filter. Same seed-then-union pattern, against the contacts table.
- **`src/components/discovery/discovery-page-client.tsx`**: `/discovery` page country filter. `countryOptions` now seeds from `SUPPORTED_OUTBOUND_COUNTRIES` and unions in any extra codes from `stats.by_country`.

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ compiled in 6.3s, 61 routes built
- Deploy: https://crm-for-saas.vercel.app (HTTP 307 → auth as expected)

### Notable decisions
- `/prospector` country picker left untouched — it uses Apollo's full ~200-country list and is a different surface area (talks to Apollo's API, not our own contacts/shops).
- Sequence duplicate dialog already reads from `SUPPORTED_OUTBOUND_COUNTRIES` — no change needed.
- Contact / Company detail "Country" inline-edit fields are free-text, not dropdowns — out of scope.
- Branch was already named `fix/lists-country-filter` from the original Lists-only fix; PR #86 title and body were updated to reflect the broader scope before squash-merging rather than splitting into a separate PR.
- Did **not** bundle in the orphan `.claude/worktrees/wonderful-chatelet` deletion that's been sitting in the working tree — that's the cause of the recent CI failures (phantom submodule, no `.gitmodules` entry) and should be a separate fix-forward.


## Session: Sender accounts panel on /settings (Phase A of email-account limits/health)
- **Date:** 2026-04-30
- **PR:** [#89](https://github.com/jacobqvisth/crm-for-saas/pull/89)
- **Branch:** `feature/sender-accounts-on-settings-page`
- **Merge commit:** `a02cf4c`

### What was built
The per-account daily-limit editor and status badges already lived at `/settings/email`, but Jacob never saw them on the main `/settings` page he lands on. This is Phase A of the plan in `_prompts/cc-prompt-email-account-limits-and-health.md` — **discoverability only**, no schema change, no new API.

- **`src/components/settings/sender-accounts-summary.tsx`** (NEW): Renders one row per `gmail_accounts` row with email + status badge (`active`/`paused`/`disconnected`/`rate_limited`), today's-sends progress bar (green / yellow ≥70 / red ≥90), inline `max_daily_sends` editor (1–500, save button only appears when dirty), and the circuit-breaker `pause_reason` if status is `paused`. "Manage all sender accounts" / "Email Integration →" links deep-link to `/settings/email` for the full editor.
- **`src/app/(dashboard)/settings/page.tsx`**: Inserted a new "Sender Accounts" section between Team Members and Configuration with a Mail icon header and a quick-link to `/settings/email`.

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ compiled in 6.9s, 61 routes built
- Deploy: https://crm-for-saas.vercel.app/settings (HTTP 307 → auth as expected)

### Notable decisions
- Reuses existing `PATCH /api/settings/email/[accountId]` route for limit edits — no new endpoint.
- Queries `gmail_accounts` directly via the supabase browser client, matching the pattern already used in `email-settings-client.tsx`. The `/api/gmail/accounts` route was rejected because it does not return `pause_reason` and we want that surfaced.
- Phase B (real `health_score` cron with reply rate, open rate, token-expiry, last-successful-send, and a first-touch-unsubscribe spam proxy) and Phase C (in-app alert banner on `/dashboard`) are still in the plan doc and not built — Jacob wanted to evaluate Phase A first.


## Session: Active and Done columns on /sequences
- **Date:** 2026-05-04
- **PR:** [#91](https://github.com/jacobqvisth/crm-for-saas/pull/91)
- **Branch:** `feature/sequences-active-done-columns`
- **Merge commit:** `5ab2c31`

### What was built
Jacob asked what the orange "N paused" badge on `/sequences` means, and asked for a column that shows how many enrollments have finished walking the sequence so he knows when to top up with more contacts.

- **`src/components/sequences/sequence-list.tsx`**: Added two columns between Enrolled and Sent.
  - **Active** = `sequence_enrollments.status = 'active'` — currently being sent, consuming sender capacity.
  - **Done** = `status IN ('completed','replied','bounced','unsubscribed')` — terminal states (finished all steps, replied, bounced, or unsubscribed).
  - Together with the existing "N paused" health badge, the row math is `Enrolled = Active + Paused + Done`.
  - Counts are loaded via two extra `count: 'exact', head: true` queries per sequence, run in `Promise.all` alongside the existing `get_sequence_stats` RPC — no new RPC, no schema change.
  - `DONE_STATUSES` constant defined once at the top of the module so the source-of-truth list is in one place.

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ compiled in 5.7s, 61 routes built

### Notable decisions
- Did **not** modify the `get_sequence_stats` Postgres RPC. It's not checked into `supabase/migrations/`, so its current source isn't in the repo — modifying it blind risked regressing the existing Open/Reply/Bounce numbers. Two extra count queries per sequence is a few hundred ms at worst on the current sequence list size and matches the per-sequence query pattern already used by `/api/sequences/health`.
- Used raw integer counts (not percentages) for the new columns to match the existing Enrolled and Sent columns' style — Jacob can eyeball ratios.
- Tooltips on the column headers explain the definitions on hover.
- Did **not** also surface a separate "Completed" (status = `completed` only, excluding replied/bounced/unsub) breakdown — would have added a fourth column and the operational signal Jacob actually needs ("do I need more contacts?") is captured by the binary Active vs Done split.


## Session: Split paused into Paused + Co-Paused columns and add Done % (/sequences)
- **Date:** 2026-05-04
- **PR:** [#93](https://github.com/jacobqvisth/crm-for-saas/pull/93)
- **Branch:** `feature/sequences-pause-breakdown-and-done-pct`
- **Merge commit:** `b292bdf`

### What was built
Follow-up to PR #91. Jacob asked to (a) move the orange "N paused" badge out of the Name cell into its own column, (b) split it by reason so it's clear *why* enrollments are paused, and (c) add a Done % column.

- **`src/components/sequences/sequence-list.tsx`**:
  - Removed the orange "N paused" health badge from the Name cell. The `auth_issue` and `high_bounces` badges still render there (unchanged).
  - Added two columns in its place: **Paused** (`status = 'paused'` — manual pause) and **Co-Paused** (`status = 'company_paused'` — auto, set by `cron/check-replies` when another contact at the same company replied). Both columns have tooltip headers explaining the definitions.
  - Added a **Done %** column = `pct(done, enrolled)`.
  - Refactored the per-sequence enrollment count queries into a small local `enrollmentCount(status)` helper to keep the `Promise.all` block tidy now that there are four count queries instead of two.
  - Final table column order between Enrolled and Sent: **Active · Paused · Co-Paused · Done · Done %**, so `Enrolled = Active + Paused + Co-Paused + Done` reconciles cleanly per row.

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ compiled in 5.8s, 61 routes built

### Notable decisions
- Did **not** modify the `/api/sequences/health` endpoint. It still returns `paused_count`; the UI just stops reading it. Avoids regressing the auth_issue / high_bounces logic in the same change.
- Chose **two columns** ("Paused" + "Co-Paused") over one column with a tooltip-only breakdown, because Jacob's stated need was to *see* the reasons at a glance, not have to hover. Adds two columns to the table — table is now 14 columns wide and will horizontal-scroll on narrow screens, which seems fine for a desktop-first dashboard.
- Label "Co-Paused" was picked over "Auto-paused" or "Reply-suppressed" because it ties back to the underlying `company_paused` status name in the DB, which keeps the mental model and the schema lined up.


## Session: Status-aware bulk Pause/Resume + recovery from accidental bulk-Resume
- **Date:** 2026-05-04
- **PR:** [#95](https://github.com/jacobqvisth/crm-for-saas/pull/95)
- **Branch:** `fix/sequences-bulk-update-status-safety`
- **Merge commit:** `656a967`

### What happened
Jacob hit "Select all → Resume" on the Contacts tabs of the Latvia and Estonia sequences. The bulk handler (`bulkUpdateStatus("active")` in `src/components/sequences/sequence-contacts-tab.tsx`) was just `UPDATE sequence_enrollments SET status='active' WHERE id IN (...)` with no FROM-status check, so it flipped every selected row to active — including 36 terminal rows (`completed_at NOT NULL`) and 117 paused/co_paused rows that were no longer wanted in the active pool.

No emails actually sent — the cron processes scheduled queue items and check `enrollment.status === 'active'` at send time, but for these 153 wrongly-flipped rows there were no scheduled items (they were cancelled at original termination/pause). The 405 always-active enrollments were no-ops on the bulk update; their pipeline kept flowing.

### What was built (fix)
- **`src/components/sequences/sequence-contacts-tab.tsx`**: Replaced `bulkUpdateStatus(status)` with two purpose-built handlers.
  - **`bulkPause`**: filters to `status='active'` before flipping to paused; also cancels scheduled email_queue items, mirroring the single-row `/api/sequences/enrollments/[id]` PATCH action=pause logic. Skipped rows reported in the toast.
  - **`bulkResume`**: fans out to `/api/sequences/enrollments/[id]` PATCH action=resume at concurrency 10. That endpoint already enforces `paused`/`company_paused` as the only valid FROM, sets status='active', and queues the next pending step. Skipped (not paused) rows reported in the toast.

### Recovery (out-of-band ops, not in this PR)
Two one-off scripts in `scripts/`:
- **`scripts/diagnose-bulk-resume.mjs`** — read-only state inspector (status counts, queue items, terminal vs paused vs always-active classification).
- **`scripts/revert-bulk-resume.mjs`** — dry-run by default, `--apply` to write. Three-bucket revert:
  1. Terminal (completed_at NOT NULL) → derive correct status from `email_events` (reply/bounce) + `unsubscribes`, default to `completed`. Priority: unsubscribed > replied > bounced > completed.
  2. Was-paused (no live queue item, has cancelled queue item) → revert to `paused`.
  3. Always-active (has a live queue item) → leave alone, pipeline intact.

Applied against prod (`wdgiwuhehqpkhpvdzzzl`):
- Latvia: 24 → replied / 10 → unsubscribed / 2 → completed / 117 (split across both seqs) → paused.
- Estonia: ditto, totals above are combined.
- Final state: Latvia 174 active / 74 paused / 4 completed / 19 replied / 8 unsubscribed; Estonia 231 active / 43 paused / 5 replied / 2 unsubscribed. Both sums reconcile to original enrolled counts (279 and 281).

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ compiled in 6.1s, 61 routes built

### Notable decisions
- **Heuristic for separating originally-paused from always-active enrollments** (post-bulk-Resume, when the data state had already been corrupted): used `email_queue.status` history. An active enrollment with no live queue items (`scheduled`/`pending`/`sending`) but at least one cancelled queue item was almost certainly paused before — pause/co_paused operations cancel queued items, leaving a fingerprint. An active enrollment with a live queue item is part of the normal pipeline and must not be touched. Result: zero ambiguous cases on Latvia/Estonia (all 117 candidates had cancelled fingerprints).
- **Bulk Resume implementation chose fan-out-to-existing-endpoint over server-side bulk endpoint.** N HTTP requests at concurrency 10 is acceptable for UI bulk actions on hundreds of rows. Avoids duplicating the variable-resolution + queue-insert logic already living in the single-row endpoint.
- **Did not also fix the misleading "Pause Sending" button on the sequence detail page.** It only flips `sequences.status='paused'` but the cron filters by enrollment status, so emails keep sending. Flagged in the PR body as a follow-up — separate change.
- **Recovery scripts kept as committed artifacts** (next chore PR) so they're available as templates if a similar incident happens again on another sequence.


## Session: Cron respects sequences.status — Pause Sending finally pauses
- **Date:** 2026-05-04
- **PR:** [#97](https://github.com/jacobqvisth/crm-for-saas/pull/97)
- **Branch:** `fix/cron-respect-sequence-status`
- **Merge commit:** `b8217eb`

### What was built
- **`src/app/api/cron/process-emails/route.ts`**: After the existing `enrollment.status === 'active'` gate (which cancels queue items for terminal/individually-paused enrollments — durable decisions), added a sequence-status gate. If `enrollment.sequences.status !== 'active'`, the queue item is reverted from `sending` back to `scheduled` and the loop continues. Items get re-picked up automatically once the user clicks **Start Sending** and `sequences.status` flips back to `active`.

### Why
The yellow Pause Sending button on the sequence detail page only flipped `sequences.status`. The cron only checked `enrollment.status`, not the sequence status, so emails kept sending after a pause. The amber banner ("No emails will send until you press Start Sending") was a lie.

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ compiled in 6.1s, 61 routes built

### Notable decisions
- **Revert (back to `scheduled`) instead of cancel** for sequence-level pause. Sequence pause is meant to be reversible — cancelling would lose the queue items forever. Per-enrollment pause/terminal still cancels queue items, matching the durable-decision intent.
- **Per-item gate, not pre-filter at queue fetch.** Simpler patch surface; bounded waste (LIMIT 100 per cron run, paused-sequence items get cycled but never sent). If a workspace ends up with lots of paused sequences and lots of queued items the wasted DB churn could matter — flagged in PR body as a follow-up to add a `sequences!inner` filter at the queue fetch.


## Session: Chunk large contactId .in() lists in enrollContacts
- **Date:** 2026-05-04
- **PR:** [#99](https://github.com/jacobqvisth/crm-for-saas/pull/99)
- **Branch:** `fix/enrollment-chunk-large-in-clauses`
- **Merge commit:** `90628ed`

### What was built
Enrolling a 1000-contact dynamic list (United Kingdom — Great Britain) into the UK sequence reported "Enrolled 0, skipped 1000" with no useful detail. Root cause: PostgREST puts `.in()` filter values directly in the request URL, ~1000 UUIDs blow past the URL length limit, the request returns `{"message":"Bad Request"}`, and the Supabase client surfaces it as `data: null` — which hit the existing `if (!contacts)` early-return path with reason "No contacts found". The reasons array isn't shown in the toast, so the failure looked like a phantom filter rejecting every row.

- **`src/lib/sequences/enrollment.ts`**: chunk `contactIds` into batches of 200 (each URL stays well under 8 KB), run one `.in()` per chunk, accumulate results. Surface any PostgREST error in the `reasons` array instead of dropping it. Early-return condition switched from `!contacts` to `contacts.length === 0`.
- Added `ContactWithCompany` type alias (`Tables<"contacts"> & { companies: Tables<"companies"> | null }`) to keep the chunked accumulator typed.

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ compiled in 6.1s, 61 routes built

### Notable decisions
- **Chunk size 200.** A UUID is 36 chars; 200 of them in an IN clause is ~7.4 KB of URL — comfortably under the 8 KB request line limit nginx defaults to. Could go higher but 200 gives margin and ~5 round-trips for a 1000-contact list, which is fine.
- **Did not also add a guard at the API layer** (e.g. POST /api/sequences/enroll splitting contactIds before calling enrollContacts). Single fix at the lib boundary is enough — every caller benefits.
- **Did not audit other `.in()` call sites in the codebase for the same bug** in this PR. There are likely others (large-bulk operations on contacts, email_queue, etc.), but each requires its own sweep + test. Tracked as a follow-up.
- **Diagnostic script kept locally as `scripts/diagnose-gb-enroll.mjs`** (not committed in this PR). Useful as a template for future "why did N skip" investigations.


## Session: Make 1000+ list enrolls actually finish (perf + resolve cap)
- **Date:** 2026-05-04
- **PR:** [#102](https://github.com/jacobqvisth/crm-for-saas/pull/102)
- **Branch:** `fix/enrollment-perf-and-list-resolve-cap`
- **Merge commit:** `409c496`

### What was built
Two stacked bugs that combined to make enrolling a 3280-contact UK dynamic list either silently truncate at 1000 or hang the UI in "Enrolling…" until Vercel killed the function.

- **`src/lib/lists/filter-query.ts`** — `resolveListContactIds` now paginates with `.range()` until a short page is returned, on both the dynamic-filter and static `contact_list_members` paths. Previously the default Supabase select silently capped results at 1000 rows.
- **`src/lib/sequences/enrollment.ts`** — pre-fetched the eligible sender pool ONCE (round-robin in JS by index) and pre-fetched all `email_templates` referenced by any step ONCE (Map lookup in the loop). The previous loop did one `getNextSender` query and one template fetch per contact, so a 1000-list was ~3000 sequential round trips and reliably timed out at Vercel's 60s function limit. Falls back to per-row `getNextSender` if the pool query came back empty so the existing "no sender capacity" skip reason still surfaces.
- **`src/app/api/sequences/enroll/route.ts`** — added `export const maxDuration = 300` for genuinely large lists.

### Bonus: true round-robin distribution
The previous per-contact `getNextSender` always returned the same lowest-count account because `daily_sends_count` doesn't change during the enrollment call — every contact in a batch got pinned to the same sender. The new pre-fetch + JS round-robin gives true distribution within a batch.

### Build status
- `npx tsc --noEmit` ✅ clean (`.next/` validator.ts errors were stale dev-server output, unrelated)
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ compiled in 5.8s, 61 routes built

### Notable decisions
- **Did not refactor to bulk inserts.** Per-contact insert + queue insert is still 2N round trips (4000 round trips for a 2000-contact fresh batch). At typical Supabase latency that fits in 60s, and with maxDuration=300 there's plenty of headroom. If the workspace ever grows to 10k+ enrollments per batch we'd revisit. Tracked as a follow-up only if needed.
- **Did not audit the rest of the codebase for similar 1000-row cap bugs.** filter-query is the most exposed spot but other paths (analytics, batch-export, large dashboard pulls) might silently cap too. Not in this PR's scope.


## Session: Per-user editable email signatures auto-applied to sequences
- **Date:** 2026-05-04
- **PR:** [#101](https://github.com/jacobqvisth/crm-for-saas/pull/101)
- **Branch:** `feature/user-signatures`
- **Merge commit:** `27d32b5`

### What was built
HubSpot-style per-user signatures so multi-sender sequences automatically apply the right person's signature regardless of which connected Gmail inbox is sending.

- **Migration `20260504000000_user_profiles_and_signatures.sql`** (applied via Supabase Studio before merge):
  - New table `user_profiles` keyed by `user_id` (PK, FK auth.users) with `full_name`, `title`, `signature_html`, `signature_updated_at`, `created_at`, `updated_at`. RLS: each user can SELECT/INSERT/UPDATE their own row only; service-role cron path bypasses RLS for cross-user signature lookup.
  - `sequence_steps.include_signature BOOLEAN NOT NULL DEFAULT true` for per-step suppression.
- **`/settings/profile` page** (`src/app/(dashboard)/settings/profile/page.tsx`): name + title fields plus a signature editor with two modes — TipTap rich editor (reuses `RichEmailEditor`) and raw HTML mode with live preview. Save persists via `/api/settings/profile`.
- **`/api/settings/profile` route** GET/POST upserting the caller's own user_profiles row.
- **Send-time injection** in `src/lib/gmail/send.ts`: after looking up the gmail_accounts row, joins to user_profiles via `user_id` and appends `signature_html` to the HTML body (plus a stripped plaintext version to the alternative). Auto-suppressed when `replyToMessageId` is set so signatures don't stack inside Gmail threads — single source of truth, applies to both cron sends and inbox-reply sends.
- **Cron toggle wiring** in `src/app/api/cron/process-emails/route.ts`: before each `sendEmail()` call, reads `sequence_steps.include_signature` for the queued item's `step_id` and forwards it as the `includeSignature` param. Defaults to `true` if step row missing or column null.
- **Editor checkbox** in `src/components/sequences/email-step-editor.tsx`: per-step "Append sender signature" toggle wired to `step.include_signature` via `onUpdate`.

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean (after fixing two `react/no-unescaped-entities` warnings on `'` in copy)
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ 62 routes built, includes `/settings/profile`
- `npm run test:e2e:smoke` ✅ 8/8 passed
- Vercel deploy: `curl -I https://crm-for-saas.vercel.app/settings/profile` → 307 (auth redirect, route registered)

### Notable decisions
- **User-level, not mailbox-level.** Jacob pushed back on my initial proposal to store the signature on `gmail_accounts`. Reality: each *person* (Jacob, Hans, Magnus) has their own signature, and each connects multiple Google accounts to send from. Per-user storage means one edit applies across all of that person's mailboxes — matches the mental model and mirrors HubSpot's pattern (which is also user-keyed because their data model is 1:1 user↔inbox).
- **No `{{sender_signature}}` variable for v1.** Auto-append + per-step suppression covers the use case. Skipped to avoid adding the variable to `resolveVariables()` and `EDITOR_VARIABLES` registries.
- **Auto-suppress on thread replies.** Detected via `replyToMessageId` being set (already populated for follow-up emails by the cron and for manual inbox replies). Avoids the HubSpot-community complaint about signatures stacking inside long threads. Applies regardless of the per-step toggle.
- **Single-row RLS for user_profiles.** No workspace_id column — signature is global to a person across all their workspaces. If multi-workspace per-user-with-different-sigs becomes a thing, revisit.
- **Migration applied via Supabase Studio, not CLI.** `supabase db push` was unusable due to migration-history drift between local folder and prod (24 prod migrations not in local; CLAUDE.md flags this as expected since "tables already exist"). Ran the SQL through Studio's editor manually before merging the code.
- **Did not commit branch hygiene fix.** Initial commit landed on local `main` by accident (a `git checkout -b feature/user-signatures origin/main` apparently didn't take); recovered by force-pointing the feature branch to the new commit and resetting local main to origin. No remote impact.


## Session: Per-account sender health check button on /settings/email
- **Date:** 2026-05-04
- **PR:** [#105](https://github.com/jacobqvisth/crm-for-saas/pull/105)
- **Branch:** `feature/sender-health-check`
- **Merge commit:** `daf01d5`

### What was built
A per-account "Check health" button on each connected Gmail account in `/settings/email`. Click runs a server-side check and renders an inline expandable panel inside the card with green / yellow / red indicators and actionable detail text per signal. No external service, no schema change.

- **NEW: `src/app/api/gmail/accounts/[id]/health-check/route.ts`** — Node runtime, workspace_member auth, all checks parallelized via `Promise.all`. `maxDuration = 60` for cold-start DNS. Returns `{ overall, summary, checks: { auth: [...], stats: [...] } }`.
  - **Authentication (DNS via `node:dns/promises`)**
    - **SPF**: presence + Google include + qualifier (`-all` strict / `~all` soft-fail).
    - **DKIM**: tries selectors `google`, `default`, `selector1`, `selector2`, `k1`, `mailo`. Reports which matched.
    - **DMARC**: presence + policy. Warn on `p=none`, good on `quarantine`/`reject`.
    - **MX**: presence + Google detection.
  - **Sending stats (last 30 days, internal)**
    - **Bounce rate**: 0–3% good, 3–8% warn, ≥8% error.
    - **Reply rate**: warn if very low and ≥50 sends; neutral if volume too low.
    - **Account status**: surfaces circuit-breaker pause reason when present.
- **`src/components/settings/gmail-account-card.tsx`**: ShieldCheck button + inline expandable result panel with per-row icons. Co-located `CheckRow` helper component.

### Cleanup landed in this PR
- `.gitignore`: added `supabase/.temp/` (Supabase CLI's local cache) and untracked the existing files there.
- Carried in two pre-existing untracked files that had been sitting in the working tree across earlier sessions: `AGENTS.md` (Codex agent config) and `scripts/diagnose-gb-enroll.mjs` (the one-off diagnostic from PR #99/#102 work). Useful as templates so kept rather than deleted.

### Build status
- `npx tsc --noEmit` ✅ clean (`.next/` validator.ts errors were stale dev-server output, unrelated)
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ compiled in 6.5s, 62 routes (new health-check route is the +1)

### Notable decisions
- **No schema change.** Computed on-demand at click time. If we ever want history/trending, add a `gmail_account_health_checks` table later — not needed for the immediate "is this account healthy *right now*" use case.
- **DKIM tries multiple selectors instead of asking the user.** Google Workspace defaults to `google`, but Postmark/SendGrid/Klaviyo use other conventions. The 6-selector probe covers the common cases without UI friction. If we ever support custom selectors per account, surface a textbox in the card.
- **Reply rate as a soft inbox-placement signal.** Real inbox-placement testing requires a paid service (Glockapps / MailReach). A persistently low reply rate at meaningful volume is a cheap proxy worth surfacing as a yellow flag rather than nothing.
- **Did not also surface OPEN rate** — already gameable by image proxies (Apple MPP) and arguably less actionable than reply rate. Intentionally kept the panel short.


## Session: Enforce sequence-level daily caps + per-sender configurable send interval
- **Date:** 2026-05-04
- **PR:** [#108](https://github.com/jacobqvisth/crm-for-saas/pull/108) (replaced [#107](https://github.com/jacobqvisth/crm-for-saas/pull/107) which conflicted with PR #105 on `gmail-account-card.tsx`)
- **Branch:** `feature/sequence-throttles-v2`
- **Merge commit:** `9c27d16`

### What was built
Three throttle improvements driven by a research question on how the existing limits interact. Found that one of them — the per-sender daily limit on sequence settings — was wired in the UI ("Daily Send Limit (per sender)" — 80 by default) but never enforced anywhere in the send pipeline; it only powered `estimate-send-times.ts`'s UI prediction.

- **Migration `20260504010000_sender_throttle_and_sequence_caps.sql`** (applied via Supabase Studio before merge):
  - `gmail_accounts.min_send_interval_seconds INTEGER NOT NULL DEFAULT 60`. Replaces the hard-coded 60s constant in `src/lib/gmail/send.ts` so warm/established inboxes can be paced more conservatively (range 30–3600s).
- **Daily caps enforcement** in `src/app/api/cron/process-emails/route.ts` (after sequence-status check, before suppression/contact/threading queries):
  - Reads `seqSettings.daily_limit_per_sender` and `seqSettings.daily_limit_total` from `enrollment.sequences.settings`.
  - Counts today's `email_queue` rows where `status='sent'`, `sent_at >= UTC midnight`, and `step_id IN (sequence's steps)`. Per-sender variant adds `sender_account_id = X`.
  - When either cap is hit, defers `scheduled_for` to the start of tomorrow's send window via `getNextSendTime(seqSettings, tomorrowMidnightUTC)` and skips. Items wait, they don't get cancelled.
  - Both caps off (0/undefined) = no enforcement, today's behavior.
- **Per-account interval** in `src/lib/gmail/send.ts`: `MIN_SEND_INTERVAL_MS = 60000` constant replaced with `account.min_send_interval_seconds * 1000`. Default 60s preserved.
- **UI: Sequence Settings drawer** (`src/components/sequences/sequence-settings.tsx`): existing "Daily Send Limit (per sender)" relabeled "Daily limit per sender" with explanatory subtext, plus new "Daily total (across all senders)" input next to it. Blank input = no total cap (omitted from settings JSON to keep it tidy).
- **UI: Gmail account card** (`src/components/settings/gmail-account-card.tsx`): "Min seconds between sends" input added below the existing "Max daily sends" row, with inline save button.
- **API**: PATCH `/api/settings/email/[accountId]` accepts `min_send_interval_seconds` (validated 30–3600).

### Build status
- `npx tsc --noEmit` ✅ clean (after clearing stale `.next` from PR #105's removed health-check route)
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ 62 routes built
- `npm run test:e2e:smoke` ✅ 8/8 passed
- Vercel deploy: `curl -I https://crm-for-saas.vercel.app/settings/email` → 307 (auth redirect, route registered)

### Notable decisions
- **Counting via `step_id IN (...)`, not via enrollments join.** `email_queue` doesn't carry `sequence_id` directly. Two options: (a) inner-join via `sequence_enrollments.sequence_id` using PostgREST's foreign-table embedding, or (b) fetch the sequence's step ids first (small list, ≤10) and use `.in('step_id', stepIds)`. Picked (b) — simpler, works within PostgREST's type-narrowing surface, two head-only count queries per item.
- **Deferred to tomorrow's send window, not +24h flat.** Using `getNextSendTime()` respects send_days/send_start_hour/timezone, so a Friday cap-hit on a Mon-Fri sequence defers to Monday morning rather than Saturday morning.
- **Per-account interval, not workspace-wide.** Jacob's stated goal is "no user sending the same email too often" — but different inboxes warrant different paces (a 30-day-old domain is fine at 60s, a 6-month-old one might want 300s). Per-account knob lets him tune that without one global slider.
- **No new variables or template-aware throttle.** The hardcoded 60s was already the right shape, just rigid. Per-account configurable interval covers the same use case more flexibly without new mechanism.
- **PR #107 → #108.** Original branch `feature/sequence-throttles` rebased onto main after PR #105 (sender health check) landed and conflicted in `gmail-account-card.tsx`. Force-push was harness-blocked, so pushed the rebased commit under a new branch name (`feature/sequence-throttles-v2`), closed #107, opened #108. Single commit on main, no remote history rewrite.


## Session: Rate-limit retry fix + lower default sequence caps
- **Date:** 2026-05-04
- **PR:** [#110](https://github.com/jacobqvisth/crm-for-saas/pull/110)
- **Branch:** `feature/rate-limit-retry-and-defaults`

### What was built
Two follow-ups to the throttle work in #108, both driven by Jacob noticing that with min_send_interval=600 the actual send cadence was ~20 min instead of the intended 10 min.

- **Rate-limit retry path** in `src/app/api/cron/process-emails/route.ts`: when `sendEmail()` returns an error starting with `"Send rate limit"` (the per-account interval gate), the cron now special-cases it. Re-fetches `gmail_accounts.updated_at` + `min_send_interval_seconds`, reschedules `scheduled_for` to exactly `lastActivity + intervalSeconds + 5s`, and does NOT count it toward the 3-retry budget. Generic 15-min retry path unchanged for real failures (token errors, bounces, etc).
- **Default sequence caps lowered** in `src/app/(dashboard)/sequences/new/page.tsx`: new sequences now default to `daily_limit_per_sender=15` (was 80) and `daily_limit_total=150` (was undefined/uncapped). Settings drawer fallback in `src/components/sequences/sequence-settings.tsx` also lowered to 15 for the per-sender field.

### Why
With the 5-min cron tick (`*/5 * * * *`) and a 600s min_send_interval, the first attempt at T+5min would hit the interval gate and return rate-limit error. The generic failure handler then bumped scheduled_for by +15min (for token-refresh-style transient errors), which combined to give ~20min between sends instead of the configured 10min. Worse, three rate-limit retries in a row would mark the queue item `failed`. Special-casing the rate-limit error path means 600s configured = ~10min actual.

Default cap drop from 80→15 reflects that 6 active inboxes × 80 = 480 sendable per day per sequence, which is too aggressive for inboxes that haven't fully warmed up yet. 15 × 6 = 90/sequence, plus the 150 total floor, gives a reasonable ramp.

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ 62 routes built
- `npm run test:e2e:smoke` ✅ 8/8 passed
- Vercel deploy: prod returns 307 (auth redirect, route registered)

### Notable decisions
- **Re-fetch the account row in the rate-limit branch** rather than threading `lastActivity` + `intervalSeconds` back from `sendEmail()` via the result type. One extra query in a cold path is simpler than expanding the SendEmailResult shape.
- **Did NOT backfill existing sequences.** Defaults only apply to new sequences. Existing ones keep whatever explicit `daily_limit_per_sender` they have (most are at the old 80 default). Provided Jacob with a one-line `UPDATE sequences SET settings = settings || jsonb_build_object(...)` he can run in Studio if he wants the tightening to apply universally.
- **+5s safety jitter** on the rescheduled time. The interval check in `send.ts` is `now - lastActivity < intervalMs` (strict less-than), so being exactly at the boundary should pass — but DB clock drift and scheduling latency mean a few extra seconds of cushion costs nothing and prevents flapping.


## Session: Add domain blocklist (DBL) checks to sender health panel
- **Date:** 2026-05-05
- **PR:** [#112](https://github.com/jacobqvisth/crm-for-saas/pull/112)
- **Branch:** `feature/sender-health-blocklists`
- **Merge commit:** `9eae078`

### What was built
Extends the per-account "Check health" feature shipped in PR #105 with three domain-based blocklist lookups: **Spamhaus DBL** (`dbl.spamhaus.org`), **SURBL** (`multi.surbl.org`), and **URIBL** (`multi.uribl.com`).

- **`src/app/api/gmail/accounts/[id]/health-check/route.ts`**
  - Imported `resolve4` from `node:dns/promises`.
  - New `checkBlocklist(domain, list)` helper. Query is `<domain>.<list-host>` (no octet reversal — that's for IP DNSBLs). An A record back = LISTED; NXDOMAIN/ENODATA = not listed; a return ending in `.255` = lookup rejected by the operator (resolver rate-limit / public-resolver block) → surfaced as "lookup unavailable" (neutral) rather than falsely red.
  - Three list configs (`Spamhaus DBL` / `SURBL` / `URIBL`) run in parallel inside the existing `Promise.all` block.
  - Response now includes `checks.blocklists: CheckResult[]`.
- **`src/components/settings/gmail-account-card.tsx`**
  - Type updated to include `blocklists?: CheckResult[]`.
  - New "Blocklists (domain reputation)" section in the inline panel, same row treatment as the auth/stats sections.

### Build status
- `npx tsc --noEmit` ✅ clean
- `npm run lint` ✅ clean
- `PATH="/opt/homebrew/bin:$PATH" npm run build` ✅ compiled in 6.8s (the `/login` prerender error in the worktree-only build is the known missing-env-var issue, same as the existing CI red on main — Vercel built cleanly)

### Notable decisions
- **Domain DBLs over IP DNSBLs.** Gmail/Workspace egress IPs rotate per send, so an IP-based RBL check (Spamhaus ZEN etc.) is meaningless for outbound from this app. Domain reputation is what controls inbox placement here.
- **Three lists, not more.** Spamhaus DBL + SURBL + URIBL cover the major commercial blocklists most providers consult. Adding more (Sorbs, Barracuda, etc.) would mostly add noise; the three picked are the highest-signal.
- **Resolver-rejected = neutral, not error.** Spamhaus's `127.0.1.255` "your resolver is blocked" response is technically an A record, so a naive listing check would falsely flag every domain when Vercel's resolver is throttled. The `.255` suffix special-case keeps that signal honest.
- **Built in a worktree (`/tmp/crm-blocklist`)** so the parallel `feature/sequence-throttles` branch checkout in `~/crm-for-saas` was untouched. cc-session-log entry committed via the same worktree pattern.


## Session: Workshop CRM schema + import existing customers from app
- **Date:** 2026-05-05
- **PR:** [#115](https://github.com/jacobqvisth/crm-for-saas/pull/115)
- **Branch:** `feature/workshop-crm-schema`
- **Merge commit:** `6de8478`

### What was built
Extends the CRM to model Wrenchlane platform customers (workshops + their app users), so prospects, trial users, and paying customers can live in one workspace with a continuous lifecycle.

- **Migrations** (applied to prod via psql + `SUPABASE_DB_PASSWORD` from `.env.local`):
  - `20260505000000_workshop_crm_schema.sql` — adds 24 columns to `companies` (workshop/customer state: lifecycle_stage, customer_status, plan, mrr_cents, trial_ends_at, stripe_*, acquisition_source, member_count, etc.) and 14 to `contacts` (app user state: app_role, last_login_at, login_count, credits_remaining, diagnostics_*). Creates `subscriptions` table (Stripe subscription history) and `usage_events` table (generic event stream — login/diagnostic/subscription/invoice events; idempotent on `(source, external_id)`; future-proofed for the dashboard merge so denormalized aggregates can be recomputed instead of perpetually maintained).
  - `20260505010000_workshop_crm_schema_fixup.sql` — adds `companies.source` (was missing in the first cut), drops the partial `WHERE x IS NOT NULL` unique indexes on `wl_workshop_id` / `wl_user_id` and recreates them as full unique indexes (PostgREST's upsert can't use partial indexes as `ON CONFLICT` arbiters).

- **Source-of-truth IDs**: `companies.wl_workshop_id` (dashboard workshop UUID) and `contacts.wl_user_id` (AWS Cognito sub) — both unique-but-nullable. Populated only for rows that originated from the Wrenchlane platform; null for prospects, scrape imports, manual adds. Keep the existing `companies.id` / `contacts.id` as the CRM-internal IDs.

- **`scripts/import-wl-users.mjs`** — loads the 333-row existing-customers CSV (`/tmp/wl-users.csv`) into the wrenchlane.com workspace (`d946ea1f-74b4-492e-ae6a-d50f59ff04f0`):
  - 255 workshops → companies
  - 316 users → contacts (1 row dropped: non-UUID test account `circamatteo-testsab`)
  - 132 unique Stripe subscriptions → subscriptions
  - **Cross-link** with `discovered_shops`: 25 lemlist prospect rows flagged as already-customer (22 exact-email match + 3 single-customer-domain match). Chain domains (autoexperten.se, mekonomen.se, bdgroup.se) and free-mail providers (hotmail.se) intentionally skipped — they're shared by multiple workshops, so domain-match would over-link.
  - Lifecycle distribution: 99 trial / 63 lead / 56 churned / 37 paying. Acquisition: 46 sales (had `workshop_created_by_agent` set) / 209 unknown.

- **`scripts/import-lemlist-history-se.mjs`** — separate idempotent script that loaded the legacy Lemlist export (`/tmp/Downloads/contacts-04-21-2026.csv`, 2,183 rows). Sweden subset (1,005 rows): 803 prospects → discovered_shops (with full Lemlist state in `raw_data.lemlist`), 200 bounced + 2 unsubscribed → suppressions table. Norway + Poland (926 rows) saved to `scripts/lemlist-no-pl-history.json` (gitignored) for the eventual NO/PL scrapes.

- **CLAUDE.md updates**: workflow note simplified (CC works end-to-end on this project, no Cowork/CC split anymore); schema docs updated with all the new columns; `source` / `lifecycle_stage` / `customer_status` / `acquisition_source` enums documented.

- **`.gitignore`**: added `scripts/lemlist-*.json` so the NO/PL contact data isn't accidentally committed.

### Build status
- `npm run lint` ✅ clean
- `npx tsc --noEmit` ✅ clean
- Vercel deploy: skipped (only docs/, scripts/, supabase/ touched — `ignoreCommand` does its job). Prod URL still 307 (auth redirect, expected).

### Notable decisions
- **One workspace, two populations.** Both prospects (lemlist + future scrape) and customers (wl-app) live in the wrenchlane.com workspace under different `source` and `lifecycle_stage` values. Splitting them across workspaces would force delete/recreate when a prospect converts and lose history. Lifecycle is a continuum.
- **Lemlist is being phased out.** The 803 historical rows keep `source='lemlist'` for provenance, but no new code references it. Going forward, the CRM's own sequencing (Phase 5+) owns outreach.
- **`mrr_cents` left null on initial import.** Don't have the plan→price map yet; backfill from Stripe when the integration lands. `plan` and `plan_billing_cycle` are populated from the CSV directly, so MRR can be computed retroactively.
- **`usage_events` future-proofs the dashboard merge.** Designed to absorb login events, diagnostic events, Stripe webhooks, anything else from the dashboard codebase later. Aggregations (`diagnostics_total`, `last_active_at`, etc.) computed from this table on demand instead of being denormalized forever.
- **`SUPABASE_DB_PASSWORD` workflow.** Schema changes now apply directly via psql in the same session that writes the migration. CLAUDE.md updated with this. No more "apply via Studio out of band". Also documented the password reset path in case it's needed again.


## Session: Sweden Stockholm metro Apify scrape + extras schema
- **Date:** 2026-05-05
- **PR:** Sweden Stockholm metro (this entry)
- **Branch:** `feature/sweden-stockholm-scrape`

### What was built
Phase C of the Sweden roadmap: city-grid Apify scrape over the entire Stockholm county (11 cells × 5 Swedish search terms = 55 async runs). All 55 runs SUCCEEDED with 0 failures. **2,492 unique Stockholm-metro workshops imported** to `discovered_shops`.

- **Schema migration `20260505020000_discovered_shops_extras.sql`** — captures the freebie fields the Apify Google Maps Scraper returns at no extra cost: `google_maps_url` (direct GMaps deep link for sellers — one click from CRM to navigation), `description`, `permanently_closed`, `temporarily_closed`, `price_level`, `additional_info` (JSONB: payment methods, accessibility, service options), `plus_code`, `popular_times` (popularity histogram), plus `linkedin_url` / `twitter_url` / `youtube_url` to round out social URLs alongside the existing `instagram_url` / `facebook_url`.
- **`scripts/start-sweden-runs.mjs`** — kicks off 11 cells × 5 terms async via Apify REST API. Cells: 4 city-core (15km radius — Stockholm NE/NW/SE/SW), 4 inner ring (20km — Outer N/S/E/W), 3 county fringe (25-30km — Norrtälje, Sigtuna/Arlanda, Nynäshamn/Haninge). Search terms: `bilverkstad`, `bilreparation`, `mekaniker`, `däckverkstad`, `bilservice`. Per-run input: `scrapeContacts: true` (+$0.001/place gives email + socials), `scrapePlaceDetailPage: true` (free — gives description + additional_info), `maxImages: 0` and `maxReviews: 0` (explicit zero — no per-image or per-review cost).
- **`scripts/retry-pending-sweden-runs.mjs`** — Apify rejected the first 23 of 55 with "memory-limit-exceeded" because the actor defaults to 4096 MB and 32 × 4096 hits the 131072 MB account cap. This script polls and re-kicks failed-to-start records every 60s until all 55 are scheduled.
- **`scripts/poll-sweden-runs.mjs`** — watches Apify `actor-runs/{id}` until every record reaches a terminal state, persists status + stats back to `se-runs.json`. Final result: 55 SUCCEEDED, 0 failed, 19.65 compute units total.
- **`scripts/reconcile-sweden-runs.mjs`** — recovery for a race condition: `start-sweden-runs.mjs` and `poll-sweden-runs.mjs` and `retry-pending-sweden-runs.mjs` all read/write the same `se-runs.json` from independent processes. Poll's "read once at startup, write own snapshot" pattern overwrote retry's runId updates. This script lists all `compass~crawler-google-places` runs from the last 90 minutes, fetches each run's INPUT key-value, matches them to the records by `(searchStringsArray[0], customGeolocation.coordinates)`, and patches the runIds back in. Recovered 20 lost runId associations.
- **`scripts/import-sweden-shops.mjs`** — fetches the 55 Apify datasets, dedupes on `placeId`, applies a Sweden-specific inspection-station filter (`Bilprovningen | Carspect | Opus Bilprovning | DEKRA | Applus | Svensk Bilprovning | besiktning`-without-`verkstad` — 147 inspection rows filtered out), tags chain workshops via 14 patterns (`Mekonomen | Autoexperten | MECA | Bosch Car Service | Bilia | AD Bildelar | Däckia | Vianor | Speedy | Euromaster | BD Group | Din Bil | First Stop | Pitstop` — 345 rows tagged), maps all 30+ Apify fields into the new `discovered_shops` columns, and runs the cross-link pass against existing customers at the end (27 exact-email + 6 single-customer-domain matches = 33 newly linked).
- **`scripts/verify-emails-se.mjs`** — Node-native MX verification (uses `dns/promises.resolveMx`, no Python required like the original skill template). Per-domain cache: 1,331 emails resolved through 808 unique domains. Bulk-marked all rows valid first, then patched the 16 invalids (11 no-MX + 5 invalid-format).
- **`scripts/se-runs.json`** + **`scripts/lemlist-no-pl-history.json`** added to `.gitignore` (PII + regeneratable from Apify / source CSV).

### Final Sweden discovered_shops state
| | |
|---|---|
| **Total SE rows** | **3,295** |
|   from Apify Google Maps (this scrape) | 2,492 |
|   from Lemlist legacy import | 803 |
| **MX-valid emails** | **1,998 (60.6%)** |
| With phone | 92% |
| With website | 80% |
| With Google Maps URL + lat/lng | 2,492 (all Apify rows) |
| Cross-linked to existing customers | 58 (33 new + 25 from earlier wl-users import) |
| Chain-tagged | 345 |
| Cities covered | 106 |

### Build status
- `npm run lint` ✅ clean
- `npx tsc --noEmit` ✅ clean
- 3 new scripts (start / retry / poll) + 1 reconciliation + 1 import + 1 verify = all `.mjs`, outside the Next.js build path
- Vercel: skipped (only docs/scripts/migrations touched — `ignoreCommand` does its job)

### Apify cost
- **19.65 compute units total** across 55 runs
- **2,492 unique places at $0.005 worst-case = $12.46**, well below the $90 estimate
- The compute units cost is separately metered; total bill should be under $30

### Notable decisions
- **Race condition fixed by external reconciliation, not by serializing the scripts.** Three short-lived scripts each owned the same JSON file from independent processes — easier to add a one-shot reconciler that pulls truth from Apify than to introduce locking. Ran once, recovered all 20 lost runIds.
- **`google_maps_url` is the seller-UX win.** Latitude/longitude alone don't put a workshop on a map — sellers need a click-through. The constructed URL (`https://www.google.com/maps/place/?q=place_id:<placeId>`) opens directly in Google Maps with the correct pin. All 2,492 Apify rows have it.
- **Per-domain MX cache cuts 1,331 lookups to 808.** Many shops at the same chain (autoexperten.se, mekonomen.se, bdgroup.se) point to one domain — no reason to verify each independently.
- **Chain tagging is opportunistic, not authoritative.** A 14-pattern regex catches obvious chain affiliations from the name field. Independent shops that happen to mention "MECA" in a partner-program disclosure may be false-positive — fix-forward later if it matters.
- **Inspection stations filter at the import step, not at the Apify step.** `skipClosedPlaces: false` was set so we capture closed shops for cleanliness, then filter `Bilprovningen / Carspect / Opus / DEKRA / Applus / besiktning-only` names during import. Easier to audit the 147 filtered names afterward than to tune Apify's inclusion filter.
- **51% email coverage is well above the 35% prior estimate.** Stockholm density + chain workshops both contributed — chains list a generic `info@` mailbox that always extracts cleanly. Independent shops are at ~40-45%.


## Session: Sweden full-country expansion (phase 2)
- **Date:** 2026-05-05
- **PR:** Sweden full-country (this entry)
- **Branch:** `feature/sweden-full-country`

### What was built
Phase A of the Sweden roadmap — extends the Stockholm metro pilot to the rest of the country. **+7,364 net-new workshops** (9,856 from Apify Maps + 803 from Lemlist = **10,659 SE total in `discovered_shops`**).

- **`scripts/start-sweden-runs-phase2.mjs`** — kicks off 30 cells × 5 search terms = 150 async runs covering: Göteborg metro (3), Malmö-Lund-Helsingborg (3), 12 mid-size cities (Uppsala, Västerås, Örebro, Linköping, Norrköping, Jönköping, Borås, Eskilstuna, Halmstad, Växjö, Karlstad, Trollhättan), mid-north (Gävle, Sundsvall, Falun-Borlänge, Östersund), far north (Umeå, Skellefteå, Luleå, Kiruna at 50km radius — sparse), south residuals (Kalmar, Karlskrona, Kristianstad, Visby/Gotland). Same Apify per-run input as phase 1: `scrapeContacts: true`, `scrapePlaceDetailPage: true`, `maxImages: 0`, `maxReviews: 0`. Persists to `scripts/se-runs-phase2.json` (gitignored alongside `se-runs.json` via the `se-runs*.json` pattern).
- **Reused the four phase-1 helper scripts with a `--runs-file=<path>` flag** added to each:
  - `retry-pending-sweden-runs.mjs --runs-file=se-runs-phase2.json`
  - `poll-sweden-runs.mjs --runs-file=se-runs-phase2.json`
  - `reconcile-sweden-runs.mjs --runs-file=se-runs-phase2.json`
- **`import-sweden-shops.mjs` updated to glob `se-runs*.json`** so phase 1 + phase 2 datasets are pulled together. Idempotent on `google_place_id` so re-running doesn't double-count phase-1 rows already in the DB.

### Results
| | Phase 1 (Stockholm) | Phase 2 (rest of country) | Combined |
|---|--:|--:|--:|
| Cells | 11 | 30 | 41 |
| Search terms | 5 | 5 | 5 |
| Apify runs | 55 | 150 | 205 |
| All SUCCEEDED | ✅ 55/55 | ✅ 150/150 | ✅ |
| Compute units | 19.65 | 41.92 | **61.57** |
| Unique workshops imported | 2,492 | +7,364 | **9,856** |
| With email | 1,261 (51%) | 3,718 (50%) | 4,979 (51%) |
| With phone | 92% | 91% | 91% |
| With website | 80% | 78% | 78% |
| Cities covered | 106 | +418 | **524** |
| Inspection rows filtered | 147 | +194 | 341 |
| Chain-tagged | 345 | +811 | 1,156 |
| MX-valid emails | 1,315 | +3,671 | **4,986** |
| Newly cross-linked | 33 | +16 | 49 (this run total) |

**Grand total SE inventory in `discovered_shops`:**
- 10,659 rows
- **5,669 MX-valid prospect emails ready for outreach**
- 74 rows cross-linked to existing customer companies (will not appear in `/discovery` promote queue)
- All 9,856 Apify rows have `google_maps_url` + `lat/lng` for one-click seller navigation

### Build status
- `npm run lint` ✅ clean
- `npx tsc --noEmit` ✅ clean
- Vercel: skipped (only docs/scripts touched — `ignoreCommand` does its job)

### Apify cost
- Phase 1 + Phase 2 combined: 61.57 compute units
- ~9,856 unique places at $0.005 worst-case = **~\$50 actual spend** (well under the $90 + $150 = $240 combined budget)

### Notable decisions
- **Same race condition as phase 1**, fixed the same way: poll + retry-pending + start owned the same JSON file from independent processes. Reconcile script pulled truth from Apify (fetched all 205 recent compass~crawler-google-places runs, matched on `searchStringsArray + customGeolocation.coordinates`, recovered 118 lost runId associations). The `--runs-file=` arg made the same script reusable for both phases.
- **One unified `discovered_shops` import** — `import-sweden-shops.mjs` now globs `se-runs*.json` so future phases (Norway, Denmark, etc.) just drop another `<country>-runs.json` next to it. The dedup-on-`google_place_id` upsert handles re-imports cleanly.
- **Far-north cells use 50km radius** vs 15-30km in the south — Norrland (Umeå, Skellefteå, Luleå, Kiruna) has very low workshop density, so a wider net per cell is more cost-efficient than tighter overlapping circles. Hit ~30-100 places per cell up there vs ~400-500 in Stockholm cells.
- **Chain breakdown** (full Sweden): Mekonomen 272, Autoexperten 212, MECA 141, Bilia 126, Däckia 71, Euromaster 69, AD Bildelar 65, Vianor 60, Din Bil 44, Speedy 42, Bosch Car Service 30, First Stop 21, Pitstop 3 = 1,156 chain-tagged. Independents: 8,700.
- **All 1,331 + 3,718 = 5,049 emails MX-checked** with per-domain caching (1,222 + 808 = 2,030 unique domains, 60% cache reuse). 5,669 ended up `email_status='valid'` (the 9 valid from Lemlist verified earlier + 1,315 + 3,671 + 803 already-tagged Lemlist deliverables = 5,669). 63 invalid (no MX or NXDOMAIN or bad format).


## Session: SE pattern-MV + shop_type bucketing
- **Date:** 2026-05-05
- **PR:** SE pattern-MV + shop_type (this entry)
- **Branch:** `feature/se-pattern-mv-shop-type`

### What was built
Two unrelated improvements to the Sweden discovered_shops dataset shipped together since they overlapped in time:

#### 1. Pattern-MV on website-but-no-email rows
After the full-country Apify scrape left 4,887 SE rows with website but no email, I ran a pattern-guess + MillionVerifier pass to lift coverage. Adapted from `scripts/pattern-mv-gb.mjs` with Sweden-tuned patterns and a chain-domain guard.

- **`scripts/pattern-mv-se.mjs`** — for each unique domain that appears in ≤3 SE rows (chain-domain guard skips multi-tenant domains like `autoexperten.se` where one mailbox shouldn't link to many physical shops), tries `info@`, `kontakt@`, `service@`, `verkstad@`, `bokning@` against MillionVerifier in order, stops at first 'valid', falls back to 'catch_all' if no valid hit.
- 4,524 unique domains in the candidate set; 3,313 chain-shared domains skipped, **1,211 probed**.
- 4,024 MV calls (~$2.82 in MV credits) → 523 'valid' + 121 'catch_all' = **644 domain hits → 707 net-new email rows**.
- **Sweden sendable inventory: 5,669 → 6,376** (+12% lift on a 2-minute, $3 investment).

#### 2. `shop_type` bucketing
Sweden's 10,659 rows were a noisy mix of auto repair / tire / dealer / inspection / motorcycle / parts. Sequence enrollment needs a clean filter, so added a `shop_type` column with rule-based classification.

- **`supabase/migrations/20260505030000_discovered_shops_shop_type.sql`** — adds the column, classifies via `category` + `all_categories[]` set-overlap operator. First cut put 4,771 SE rows in 'other' which was clearly too many.
- **`supabase/migrations/20260505040000_discovered_shops_shop_type_refine.sql`** — refinement after inspection of the 'other' bucket revealed adjacent ICP being lost (Auto machine shop 337, Auto tune up 102, Auto electrical 42, Engine rebuilding 27, Auto restoration 24) plus inspection stations escaping the name-regex filter (97 'Car inspection station' rows). Reclassifies into 7 new/refined buckets: `auto_repair` (broadened), `tire_combo`, `tire_only`, `auto_glass`, `auto_body`, `truck_repair`, `inspection`, `dealer`, `parts`, `motorcycle`, `other`.

**Final SE distribution:**
| shop_type | total | sendable emails |
|---|--:|--:|
| auto_repair | 4,360 | 2,150 |
| other | 2,444 | 1,797 |
| dealer | 870 | 675 |
| tire_only | 854 | 392 |
| truck_repair | 806 | 543 |
| parts | 426 | 300 |
| auto_body | 301 | 138 |
| auto_glass | 250 | 220 |
| tire_combo | 128 | 74 |
| motorcycle | 123 | 75 |
| inspection | 97 | 12 |

**Core ICP** (auto_repair + tire_combo + auto_glass + auto_body): **5,039 shops · 2,582 sendable emails**.

### Notable decisions
- **Chain-domain guard for pattern-MV**. A single `info@autoexperten.se` mailbox shouldn't be assigned as the email for 50 different physical Autoexperten workshops — each location has its own mailbox. Threshold: skip domains shared by >3 SE rows.
- **`tire_only` vs `tire_combo` split was clean**. Of 980 tire-shop primary listings, 81% were 'tire_only' (just `Tire shop` / `Wheel store` / `Tire repair`) and 19% had `Auto repair shop` or `Mechanic` in `all_categories[]` — the second bucket is real combo workshops worth keeping in ICP.
- **'other' bucket still has 2,444 rows worth investigating.** Likely some have NULL category from Google + sparse `all_categories[]`. Could re-run with website-content classification or AI labelling in a follow-up if these matter.
- **MV cost was 7× lower than estimated.** Estimated $14-20, actual $2.82. The early-exit on `valid` (mean 3.3 calls/domain instead of 5) and the chain-domain guard cutting 73% of candidate domains explain the difference.


## Session: Czech sequence stuck — chunk activate-promotion past 1000 enrollments
- **Date:** 2026-05-05
- **PR:** [#119](https://github.com/jacobqvisth/crm-for-saas/pull/119)
- **Branch:** `fix/activate-promotion-chunking`
- **Merge commit:** `159a0d3`

### What was wrong
Jacob noticed the Czech Republic sequence (1995 enrollments) had been "Active" for a day with **0 sent**, "No emails queued" in the header, and empty EST. SEND on every contact row. All 1995 `email_queue` rows were stuck in `status='pending'`.

The activate handler (`PATCH /api/sequences/[id]`) is supposed to promote `pending` → `scheduled` when a sequence flips to active. Two compounding scale bugs silently no-op'd it:

1. **Supabase 1000-row default cap** — `select("id").eq("sequence_id", ...)` only returned the first 1000 of 1995 enrollment IDs.
2. **PostgREST URL-length limit on `.in()`** — even 1000 UUIDs in a single `.in("enrollment_id", [...])` blows past the URL length cap and silently returns Bad Request (`data: null`). Same gotcha PR #99/#102 fixed for `enrollContacts` / `resolveListContactIds`; this code path was missed.

The sequence detail page's `load()` had the same shape of bugs in its senders/nextSend/lastSent lookup — explains why the header showed "No emails queued" instead of the actual scheduled count.

### Fix
- **`src/app/api/sequences/[id]/route.ts`** — paginate enrollment fetch via `.range()` past 1000 rows; chunk the `.in()` update at 200 ids. Matches `enrollContacts` pattern exactly.
- **`src/app/(dashboard)/sequences/[id]/page.tsx`** — paginate enrollments, chunk the `email_queue` `.in()` queries, take min/max across chunks in JS for nextSend/lastSent.

### Ops fix (already run against prod)
- **`scripts/cz-unstick-pending.mjs`** — chunked update that promoted the 1995 stuck Czech rows to `scheduled` with `scheduled_for=now()` (idempotent, kept as a template).
- **`scripts/cz-diagnose.mjs`** — read-only diagnostic that confirmed the diagnosis (sequence status, enrollment count by status, queue rows by status, sender pool capacity, step config).

After the unstick the cron picked up rows on the next 5-minute tick. First send fired at 22:15 CEST; **20 sent in the first ~80 minutes** of in-window time. Throughput is paced by `gmail_accounts.min_send_interval_seconds=600` (10 min between sends per account) × 5 senders = ~30 sends/hour during the 7-18 Stockholm window, capped at 250/day across the pool. ~8 days to drain 1995.

### Build status
- `npm run lint` ✅ clean
- `npx tsc --noEmit` ✅ clean
- Vercel deploy: triggered by PR #119 merge (src/ change). Prod returned 307 (auth redirect — expected).

### Notable decisions
- **Treat the deployed unstick as separate from the code fix.** The one-off script promoted the stuck rows immediately so Czech could start sending; the code PR prevents the next big-sequence activation from silently failing. Either could ship without the other.
- **Page.tsx fix bundled** even though the page-level bug is cosmetic (header copy mis-shows "No emails queued" when scheduled rows exist on >1000-enrollment sequences). Same root cause, same fix shape, didn't make sense to leave it for later.
- **Kept both ops scripts in `scripts/`** rather than throwing them away. `cz-diagnose.mjs` is a generic stuck-sequence dump (parameterize the sequence ID for next time); `cz-unstick-pending.mjs` is the chunked promotion that's safe to re-run if anything else gets stuck on `pending`.
- **min_send_interval=600s on every sender** is the throughput governor here, not anything in the sequence settings or cron. Worth flagging if Jacob wants to drain the queue faster: lower the interval (60s default in code) or raise `max_daily_sends`.


## Session: SE 'other' bucket cleanup
- **Date:** 2026-05-06
- **PR:** SE 'other' cleanup (this entry)
- **Branch:** `feature/se-other-cleanup`

### What was built
After PR #122 added shop_type and reclassified the SE inventory, 2,444 rows (23% of total) remained in `shop_type='other'`. Inspection revealed two big chunks were ICP that should have been classified:

1. **803 Lemlist legacy rows** — chain workshops (Mekonomen, Autoexperten, BD Group) imported from CSV. They never had a Google `category` field, so they fell through every classification rule.
2. **859 NULL-category Apify rows** — Google Maps returned them for auto-repair searches (`bilverkstad`/`bilreparation`/`mekaniker`/`bilservice`) but didn't categorize them. The `raw_data->>'term'` field preserved which search surfaced each, providing the signal needed to classify retroactively.

`supabase/migrations/20260506000000_discovered_shops_shop_type_other_cleanup.sql`:
- **Step 1**: `source='lemlist'` + `shop_type='other'` → `auto_repair`. 803 rows.
- **Step 2**: `category IS NULL` + `source='google_maps'` + `raw_data->>'term' IN (...)` → `auto_repair` (or `tire_only` if term was däckverkstad). ~858 rows.
- **Step 3-6**: Specific category buckets for the rest — auto_specialty, non_auto_vehicle, salvage, towing.

### Final SE shop_type distribution (after cleanup)
| shop_type | total | sendable |
|---|--:|--:|
| auto_repair | 5,218 | 2,923 |
| other | 1,064 | 655 |
| dealer | 870 | 675 |
| tire_only | 855 | 392 |
| truck_repair | 806 | 543 |
| parts | 426 | 300 |
| auto_body | 301 | 138 |
| auto_specialty | 258 | 182 |
| auto_glass | 250 | 220 |
| non_auto_vehicle | 191 | 145 |
| tire_combo | 128 | 74 |
| motorcycle | 123 | 75 |
| inspection | 97 | 12 |
| salvage | 53 | 33 |
| towing | 19 | 9 |

**Core ICP (auto_repair + tire_combo + auto_glass + auto_body): 5,897 shops · 3,355 sendable emails** (was 5,039 / 2,582 before this cleanup, so +858 shops and +773 sendable emails).

### Notable decisions
- **`raw_data->>'term'` was the saving signal** for the 859 NULL-category Apify rows. We didn't add it for this purpose, but persisting the search term that surfaced each Apify result is a useful provenance trail — if Google can't tell us what kind of shop it is, the search query that matched it is the next best thing.
- **Lemlist rows kept `source='lemlist'` for provenance** even though `shop_type` flips to `auto_repair`. The two columns are orthogonal: `source` says where the row originated, `shop_type` says what kind of business it is.
- **The remaining 1,064 'other' rows** are mostly true non-ICP — gas stations (120), car washes (159), chauffeurs (94), department stores, manufacturers, auto brokers. Probably not worth further refinement unless outreach performance later suggests we're missing a segment.
- **Sequence enrollment filter is now one clean WHERE clause**: `shop_type IN ('auto_repair','tire_combo','auto_glass','auto_body') AND email_status IN ('valid','catch_all') AND crm_company_id IS NULL`. Gives 3,355 prospects ready for the first campaign.

## 2026-05-06 — Absorb wl-dashboard CEO Growth Dashboard into crm-for-saas (PR #120 + #126 + #127)

- **PRs:** #120 (feat), #126 (styling fix), #127 (href fix)
- **Branches:** `feat/absorb-ceo-dashboard`, `fix/ceo-styles`, `fix/ceo-section-hrefs`
- **Merge commits:** `af017fb`, `25db671`, `b831c51`
- **Old wl-dashboard side:** PR #43 on `jacobqvisth/wl-dashboard` (redirect to crm-for-saas/ceo)

### What was built

The standalone `wl-dashboard` repo + Supabase project + Vercel project is being retired. Its functionality now lives entirely inside `crm-for-saas` as a gated `/ceo/*` route group. After this work: one repo, one Supabase, one Vercel project for both the CRM and the CEO Growth Dashboard.

**PR #120 — code + DB absorption:**
- 12 `dashboard_*` tables + indexes + RLS + cron source seeds bundled into `supabase/migrations/20260506010000_absorb_ceo_dashboard_schema.sql`.
- ~20.5K rows of historical analytics data copied from old wl-dashboard Supabase (`ivjlbknopdvadawjqpxl`) → CRM Supabase (`wdgiwuhehqpkhpvdzzzl`) before the PR via service-role transfer; row counts verified table-by-table.
- 73 source files copied + namespaced under `src/{app/(ceo)/ceo,components/ceo,lib/ceo,config/ceo}/`.
- New API routes `src/app/api/ceo-sync/{all,[source]}/route.ts` (cron-driven, Bearer SYNC_SECRET).
- Auth gate added to `src/lib/supabase/middleware.ts`: `/ceo/*` requires authenticated email matching `CEO_ALLOWED_EMAILS`.
- Sidebar gains a conditional "CEO Dashboard" link visible only to allowlisted emails.
- Compatibility shim `src/lib/ceo/supabase.ts` routes copied wl-dashboard `createSupabase{Server,Service}Client()` calls to a service-role client (avoids the data leak from `authenticated can read` RLS on dashboard_* tables in the multi-tenant CRM context).

**Ops sequence after #120 merged:**
- 22 env vars set on `crm-for-saas` Vercel via `vercel env add` (production + preview + development scopes): GA4, Customer.io, Google OAuth, Google Ads, App Store Connect, Stripe, AWS/S3 + the new `CEO_ALLOWED_EMAILS`, `NEXT_PUBLIC_CEO_ALLOWED_EMAILS`, `SYNC_SECRET`.
- `vercel redeploy` triggered to pick up env vars.
- Smoke-tested `/api/ceo-sync/all` with Bearer SYNC_SECRET → 6/7 sources succeed: ga4 (+283), google_ads (+115), search_console (+6,790), customer_io (+640), stripe (+443), app_store_connect (+5). `core_app` fails — pre-existing Postgres bulk-upsert bug ("ON CONFLICT DO UPDATE command cannot affect row a second time" — duplicate user_ids in the S3 export not deduplicated before bulk upsert). Bug exists in old wl-dashboard too. Filed for follow-up.
- 7 pg_cron jobs installed on CRM Supabase (`ceo-sync-{core-app-twice-daily,ga4,google-ads,search-console,customer-io,stripe,app-store}`) — same schedule as before, hitting `/api/ceo-sync/*` endpoints.
- 5 old pg_cron jobs unscheduled on old wl-dashboard Supabase.
- Old `wl-dashboard` repo got PR #43 (`vercel.json` 308 redirects + dropped Vercel cron). After deploy, `wl-dashboard-three.vercel.app/*` permanently redirects to `crm-for-saas.vercel.app/ceo/*`.

**PR #126 — styling fix:**
The (ceo) route group had no layout file, so /ceo/* fell through to the root layout (no sidebar). And wl-dashboard's bespoke 1,889-line CSS wasn't migrated, leaving content as an unstyled text dump.
- New `src/app/(ceo)/layout.tsx` mirroring `(dashboard)/layout.tsx` — WorkspaceProvider + CRM Sidebar + `bg-slate-50` main panel.
- Rewrote `src/components/ceo/dashboard-shell.tsx` in Tailwind matching CRM patterns (slate/indigo, card-on-bg-slate-50). Dropped the embedded sidebar / brand lockup / profile chip / sign-out — all redundant with the CRM Sidebar.
- New `src/app/(ceo)/ceo-legacy.css` — wl-dashboard's globals.css imported only by the CEO layout. Scoped to /ceo/* via Next.js layout-CSS scoping; doesn't leak onto other CRM routes.
- `supabase/ceo-cron.sql` committed for reference (the SQL used to install/retire pg_cron jobs).

**PR #127 — href fix:**
Section nav, drilldown links, and `revalidatePath` calls still pointed at `/dashboard/*` (wl-dashboard's old URL structure). In CRM that path is the CRM dashboard — clicking any CEO section tab 404'd. Bulk-rewrote `"/dashboard/` → `"/ceo/` in 7 files.

### Build/deploy
- All three PRs: `npm run build` green, `npm run lint` green, `npx tsc --noEmit` green.
- Vercel auto-deployed on each merge. Final state verified: all `/ceo/*` routes return 307 (auth-gated), `/api/ceo-sync/all` returns 401 without Bearer (gated), `/login` and existing CRM routes unaffected. `wl-dashboard-three.vercel.app/dashboard/overview` returns 308 with Location `https://crm-for-saas.vercel.app/ceo/overview`.

### Notable decisions
- **DBs stay separate by company, not by app.** WrenchLane gets one Supabase (CRM + CEO data); Result Insurance / Hantverkarbolaget / Kundbolaget keep their own (different legal entity). One DB per company, multiple apps per DB.
- **Service-role client for the CEO data path.** dashboard_* tables have `authenticated can read` RLS from the wl-dashboard era. In a multi-tenant CRM, that would let any logged-in user query CEO data via PostgREST. Routing the shim through a service-role client (server-only, never browser-exposed) plus the middleware email gate gives defense-in-depth without rewriting the RLS.
- **Untyped Supabase client in the shim, deliberately.** CRM's `Database` type didn't include the `dashboard_*` tables; regenerating it would have surfaced ~142 strict-null errors across pre-existing CRM code. Keeping the shim untyped deferred that — type regen happened separately in PR #128.
- **Phase-2 styling work is queued.** The legacy CSS keeps the CEO content components functional but they don't yet match CRM's visual language at the component-internal level. Bespoke class names (bar-list, data-table, chart-area, hero-grid, etc.) to be replaced with Tailwind incrementally — not a blocker.

### Follow-ups
- **`core_app` sync bug** — dedupe user_ids/workshop_ids in JS before the bulk upsert call (`src/lib/ceo/sync/sources/core-app.ts`). 6 of 7 sources are unaffected; data won't drift fast (twice-daily schedule + each user's stats get rewritten on next sync anyway).
- **2-week verification window** then retire: archive `jacobqvisth/wl-dashboard` GitHub repo, delete the `wl-dashboard` Vercel project, delete the `ivjlbknopdvadawjqpxl` Supabase project (~$25/mo savings).
- **Phase-2 Tailwind rewrite** of CEO content components — replace 100+ bespoke class names from `ceo-legacy.css` with Tailwind/CRM patterns, file by file.

## 2026-05-08 — Field Routes Phase 5: smart single-route generation + quality scoring (PR #152)

- **PR:** #152 (squash `6c50a92`)
- **Branch:** `feature/field-routes-phase5`
- **Saved prompt:** `_prompts/cc-prompt-field-routes-phase5.md` in the planning vault

### What was built

Replaces the Phase 1 "generate 10 routes per click → user picks one" flow with "generate the single best route per click". Backend scores candidate clusters on five signals, picks one, scores stops within it, and produces a stop-aware label like `Solna · Sundbyberg` instead of a centroid guess.

**New library code (all under `src/lib/routes/`):**
- `cluster-rank.ts` — pure 5-signal cluster scorer.
- `stop-score.ts` — pure 6-signal per-stop scorer.
- `engagement.ts` — fetches `lastEmailedAt` (90-day window) + `hasRecentPositiveEngagement` (30-day open/click/reply) per company. `.in()` chunked at 200 (PR #99 pattern).
- `cluster-label.ts` — adds `labelForStops` (city tally, 70% / 80% share rules, ellipsis fallback) + `decorateLabelWithMode`. Centroid mapping (`labelForCentroid`, the 38-town list from PR #149) kept as fallback when city data is missing on most stops.

**Refactor:**
- `generate.ts` — adds `generateRoute` (single-route orchestrator). Legacy `generateDailyRoutes` left untouched so the existing batch test keeps working.
- `/api/routes/generate` — new request body (`region`, `forDate`), new response shape (`{ route, diagnostics }`). Status codes: 400 `no_eligible_cluster`, 409 `unavailable_date`, 500 `routes_api_failed` / `persist_failed`.
- `/routes` page — singular "Generate route" button + Where? dropdown (Auto + 8 region keys) + For when? date picker. Bulk flow removed.

### Cluster-rank weights chosen (final)

| Signal | Weight | Rationale |
|---|---:|---|
| Lapsed density | 5 | Pre-prompt was 30. Dropped because no companies have `activated_at` set yet (signal is flat zero across the workspace). Bump back up when activation data lands. |
| Avg freshness | 30 | Was 25. Picked up the redistribution. |
| Quality density | 30 | Was 20. Uses NULL-rating half-credit at the cluster layer (`(count_4plus + 0.5 × count_null) / total`) — `companies.rating` is mostly null today, so a strict ≥4 % count would crush this signal. |
| Compactness | 20 | Was 15. |
| Outreach restraint | 15 | Was 10. 90-day cap; default 90 if no email history. |

### Engagement-recency window
Hard-coded 30-day window for the open/click/reply check (`ENGAGEMENT_LOOKBACK_DAYS` in `src/lib/routes/engagement.ts:14`). Outreach-restraint window is separately configured at 90 days (`OUTREACH_LOOKBACK_DAYS:13`).

### Route mode derivation
Computed on FINAL stops after Routes API + day-window trim (not on the candidate pool):
- `mode = 'lapsed'` if ≥80% of final stops have `activated_at IS NOT NULL`
- `mode = 'cold'` if ≥80% of final stops have `activated_at IS NULL`
- `mode = 'mixed'` otherwise

Single-mode routes get a `(lapsed)` or `(cold)` suffix on the label; mixed-mode routes don't.

### `forDate` semantics
- Empty → skips Phase 4 PTO + working-day check. `min_revisit_interval_days` always applies (date-independent).
- Provided → all Phase 4 checks active before generation. PATCH `/api/routes/[id]` schedule guard from Phase 4 still re-runs PTO/working-day if Hans picks a date later, so empty `forDate` defers the calendar check rather than bypassing it.

### Build / lint / tsc
- `npm run build` green
- `npm run lint` green (eslint src/)
- `npx tsc --noEmit` green
- New unit suites: 15/15 passing (cluster-rank · stop-score · cluster-label)
- Existing `generate.test.ts` is **flaky on `main`** (~50% pass rate when run repeatedly) due to k-means++ `Math.random` init — pre-existing, not introduced by this PR. Worth a follow-up to seed the RNG or rewrite the test against deterministic input.

### Deploy verification
- Prod URL: https://crm-for-saas.vercel.app — returns 307 (auth redirect, expected)
- `/api/routes/generate` POST without auth → 401 `Unauthorized` ✅

### First-run diagnostics
Not captured in this session — Hans hasn't run the new generator against the real workspace yet. Next session should grab one run's `diagnostics` payload (`consideredClusters`, `chosenClusterScore`, `cityCoverage`, `fellBackToCentroidLabel`) and add to the log so we have a baseline.

### Notable decisions
- **Legacy `generateDailyRoutes` left in place** instead of renamed to `generateRouteBatch`. The endpoint switches to `generateRoute`, but keeping the old export avoids touching the existing `generate.test.ts` test file (already flaky for unrelated reasons).
- **Region centers hard-coded** in `src/lib/routes/generate.ts:REGION_CENTERS`. 8 regions × 25 km radius. If Jacob wants to add a region (say "Gotland"), it's a one-line change in that map.
- **The labeling is two-stage**: `labelForStops` does the city tally; `labelForCentroid` is invoked from inside `labelForStops` when most stops have NULL `city`. So the 38-town list still earns its keep, but only as a graceful fallback for legacy data.
- **`scripts/diagnose-min-interval-column.mjs`** noticed during pre-flight as an untracked file — it's investigating `gmail_accounts.min_send_interval_seconds` (an email-sending column), unrelated to Phase 4's `companies.min_revisit_interval_days`. Not deleted, not committed; left for whichever session that script belonged to.

### Follow-ups
- **Bump lapsed-density weight back up** when activation data starts populating. The 5/100 weight is intentionally light, not principled — the signal works fine, the *data* doesn't yet exist.
- **Seed k-means++ RNG** — fixes the flake in `generate.test.ts` and would also make Phase 5's "Auto picks a cluster" reproducible across consecutive clicks (a soft win for predictability).
- **Stop-quality on the Add Stop tab** (Phase 6 candidate per the prompt's out-of-scope list) — the Phase 4 add tab is geography-only; folding the Phase 5 stop-score in there would let Hans hand-tune routes with the same ranking signals.
- **Schedule-aware "auto-schedule"** (Phase 6 candidate) — once a route is generated for `forDate=null`, Phase 6 could optionally pick the next available working day for the assignee instead of leaving `scheduled_for` null.

## 2026-05-13 — Auto-flag @wrenchlane.com users as internal-test (PR #191)

- **What was built:** New `INTERNAL_TEST_EMAIL_DOMAINS` constant + `applyInternalTestDomainFlag()` helper in `src/lib/ceo/internal-test/auto-flag.ts`. Runs after `writeUsers` inside `runSourceSync('core_app')` and flips `dashboard_users.is_internal_test=true` on any row whose `metadata.email_domain` matches (currently just `wrenchlane.com`), skipping rows already flagged or exempt. Flagged count surfaces in `dashboard_sync_runs.metadata.internal_test_auto_flagged`. Migration `20260513000000_auto_flag_internal_email_domain.sql` applied to prod against existing rows — **8 wrenchlane.com users flagged**.
- **Files changed:** 4 — `src/lib/ceo/internal-test/auto-flag.ts` (new), `src/lib/ceo/sync/runner.ts`, `src/components/ceo/app-usage-content.tsx`, `supabase/migrations/20260513000000_auto_flag_internal_email_domain.sql` (new).
- **Migration:** Applied directly via supabase-js service-role client (8 rows updated).
- **Test result:** `npm run build` green (webpack — Turbopack still broken on darwin/arm64 with brew Node, see memory `reference_node-codex-vs-brew.md`), `npm run lint` green, `npx tsc --noEmit` green.
- **Deploy:** Vercel auto-deploy ✅ — `curl -I https://crm-for-saas.vercel.app` → 307 (auth redirect, expected).
- **GA4 gap is NOT fixed by this PR.** Jacob asked for "GA4 metrics exclude internal users too". GA4 unique users / sessions / page views / pages-per-session / events are still unfiltered because GA4 has no key to match against `dashboard_users.is_internal_test` — the product app doesn't send `user_id` (or an `is_internal_test` user_property) to GA4/Firebase. The `/ceo/app-usage` panel text now spells this out. The follow-up is in the WrenchLane app repo, not here: add `gtag('config', …, { user_id: internalUserId })` on web sign-in and the Firebase iOS/Android equivalent — once those land, drop a `dimensionFilter` against the internal user_id set into `getAppUsageData()` and the GA4 columns start filtering.
- **Next step:** Either coordinate with the WrenchLane app team for the GA4 user_id instrumentation, or accept that GA4 columns on `/ceo/app-usage` remain a "raw traffic" view and rely on Diagnoses-made as the real-customer signal.

## 2026-05-13 — Canonical dashboard_users.signed_up_at + workshop fallback (PR #193)

- **What was built:** New `dashboard_users.signed_up_at TIMESTAMPTZ` column (migration `20260513120000_dashboard_users_signed_up_at.sql`), populated by the core_app sync writer via an explicit priority chain in `src/lib/ceo/sync/sources/core-app.ts:deriveSignedUpAt`: `user_created_at` → `created_at` → `workshop_created_at` → CIO `createdAt` → Stripe `customerCreatedAt`. Winning source is stamped on `metadata.signed_up_at_source`. `/ceo/new-users` now reads `signed_up_at` directly — no recomputation downstream.
- **Why:** `/ceo/new-users` chart showed 0 signups for 2026-05-11 even though Cusmat (cusmat.com, IN) and Autostar (gmail.com, GA) workshops signed up that day. The S3 user_stats export shipped both owners with NULL user-level `created_at`, and neither had a CIO/Stripe match yet. The legacy read-time fallback in `new-users.ts:effectiveCreatedAt` returned null for every signal and silently dropped them from the chart.
- **Safety net:** Daily 08:00 UTC `check-sync-health` cron (`src/lib/ceo/sync/health-check.ts`) now alerts (Slack via `SLACK_ALERT_WEBHOOK_URL`, or Vercel logs) when any `dashboard_users` row inserted in the last 24h has `signed_up_at IS NULL`. A future broken-chain failure becomes a same-day ping, not a 14-day silent regression.
- **Files changed:** 10 — `supabase/migrations/20260513120000_dashboard_users_signed_up_at.sql` (new), `vitest.config.ts` (new — fixes pre-existing `@/*` alias bug in ceo/sync tests), `src/lib/ceo/sync/types.ts`, `src/lib/ceo/sync/sources/core-app.ts`, `src/lib/ceo/sync/sources/core-app.test.ts`, `src/lib/ceo/sync/writer.ts`, `src/lib/ceo/sync/writer.test.ts`, `src/lib/ceo/sync/health-check.ts`, `src/lib/ceo/data/new-users.ts`, `src/components/ceo/new-users-content.tsx`. +321 / −38.
- **Migration applied to prod ahead of merge:** 371 total `dashboard_users` rows → 314 backfilled via the new `core_app_workshop` fallback (the gap the old chain couldn't reach), 55 via `core_app_user`, 0 CIO, 0 Stripe, 2 holdouts with no workshop_id (NULL acceptable). May 11 now resolves: Cusmat + Autostar real, Matteo test stripe prod filtered by existing `is_internal_test` gate.
- **Test result:** `npm run build` green, `npm run lint` green, `npx tsc --noEmit` green, `npx vitest run src/lib/ceo/sync/` 25/25 (6 new `deriveSignedUpAt` priority-chain cases + 1 `buildUserRows` stamping case).
- **Deploy:** Vercel auto-deploy ✅ — `curl -I https://crm-for-saas.vercel.app` → 307 (auth redirect, expected).
- **Verified post-deploy via service-role query:** May 11 = 2 signups (Cusmat, Autostar); May 12 = 7 real + 2 filtered; May 13 = 1.
- **Next step:** Watch the next 08:00 UTC health-check run to confirm the new NULL-signed_up_at check lands clean (no false positives from the 2 backfill holdouts since their `created_at` predates the 24h window).

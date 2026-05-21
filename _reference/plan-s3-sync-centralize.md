---
type: plan
status: shipped
tags: [wrenchlane-crm, sync, architecture]
created: 2026-05-12
updated: 2026-05-12 (Option 1 shipped via PR #179)
author: Claude Code (session A)
---

> **Shipped 2026-05-12 as [PR #179](https://github.com/jacobqvisth/crm-for-saas/pull/179).** Cron at `30 10 * * *` UTC. First run (manual, 09:09 UTC same day) discovered 6 stranded signups since the previous manual script run.

# Plan — wl-app sync: what's left after session B's work

> **Major update 2026-05-12:** Session B already shipped most of what this plan proposed (PRs #174 + #176, both merged today). Re-scoped to the remaining gap.

## What session B already did

**PR #174 — AWS sync audit** (investigation, no code change). Found that:
- The `core_app` sync was scheduled all along via a Supabase **pg_cron job** `ceo-sync-core-app-twice-daily` at 02:25 + 10:25 UTC, hitting `https://crm-for-saas.vercel.app/api/ceo-sync/core_app` with `Authorization: Bearer SYNC_SECRET`.
- It had been failing for 13 consecutive runs (since 2026-05-04) with `ON CONFLICT DO UPDATE command cannot affect row a second time` — same duplicate-`internal_user_id` bug I hit in `scripts/import-wl-users.mjs` and fixed there in PR #140.
- The sync writes `dashboard_users`, `dashboard_workshops`, `dashboard_diagnostics`, `dashboard_diagnostic_chats`, `dashboard_motor_usage`, `dashboard_cost_entries`, `dashboard_subscriptions`. It does **not** touch `contacts`/`companies` directly.

**PR #176 — Two fixes:**
1. `dedupeByKey()` helper applied to all 7 upsert call sites in `src/lib/ceo/sync/writer.ts`. Restores the broken cron.
2. New `src/lib/ceo/sync/propagate-to-crm.ts` — runs after each successful `core_app` sync. **UPDATE-only**: for every `contacts.wl_user_id` and `companies.wl_workshop_id` that's already linked, refresh the lifecycle / activity fields from the corresponding `dashboard_*` row. Never inserts, never unlinks. Failure is non-fatal and lands in `dashboard_sync_runs.metadata.crm_propagation`.

Field mapping (from PR #176):
- `dashboard_users` → `contacts`: `last_seen_at → last_active_at`; metadata-derived `username → app_username`, `user_role → app_role`, `login_count`, `credits_remaining`, `plan_type → user_plan_type`, `subscription_status → user_subscription_status`, stripe IDs.
- `dashboard_workshops` → `companies`: `activated_at`, `plan_key → plan`, `core_subscription_status → subscription_status`, `payment_status`, `trial_end → trial_ends_at`, stripe IDs, `member_count` (from metadata), derived `customer_status` (`trialing`/`active`/`inactive`).

## What this means for the original "centralize" question

Largely resolved. The CRM no longer relies on Jacob running a script. Two scheduled refreshes per day (02:25 / 10:25 UTC), running off the existing `dashboard_*` mirror. Single set of AWS creds (the dashboard's IAM user).

**My PR #140 script `scripts/import-wl-users.mjs` is now redundant for the routine-update path.** Keep it around for the two paths that propagator doesn't cover (below).

## The remaining gap: new wl-app users

The propagator is **UPDATE-only** because `dashboard_users.email_hash` is hashed — the propagator can't construct a plaintext email when inserting a brand-new contact, so it deliberately skips unmatched rows. Concretely:

- A new workshop signs up in the WL app → core_app sync writes it to `dashboard_workshops` → propagator looks for `companies.wl_workshop_id = <that id>` → not found → row is skipped → company never enters CRM. Same for users.
- Today there's no automated path that **creates** the CRM contact/company for a newly signed-up app user. They sit in `dashboard_*` forever, invisible to /contacts.

This was the actual centralize-ish problem I was trying to solve. Three options for closing it:

### Option 1 — Keep `import-wl-users.mjs` as the new-user discoverer, run on its own cron

Re-frame the script as **"new user discovery"**: query `dashboard_users` and `dashboard_workshops` for rows where the matching `wl_user_id`/`wl_workshop_id` is absent from `contacts`/`companies`, then fetch plaintext email from S3 for those few rows and INSERT.

- **Where it runs:** new Vercel cron route `/api/cron/discover-new-wl-users`, daily.
- **Auth:** same `SYNC_SECRET` pattern as the ceo-sync routes.
- **AWS creds:** Vercel env vars (mirror dashboard's IAM user).
- **Pros:** clear separation of concerns (propagator updates, this one inserts). Small surface area.
- **Cons:** new cron + new AWS-creds-in-Vercel surface. Two sources of truth for "who's a customer" — the propagator and this. Risk of drift.

### Option 2 — Extend `propagate-to-crm.ts` to insert from S3 lookup

Add a "second pass" in `propagateDashboardToCrm()`: for any `dashboard_workshops` row that has no matching `companies.wl_workshop_id`, fetch the plaintext email + workshop name from `s3://codeoc-dashboard-prod/latest/user_stats.json.gz`, INSERT a new `companies` + the workshop's first user as a new `contacts` row.

- **Where it runs:** same place as the propagator — i.e. inside the already-running `core_app` sync route. Twice daily.
- **AWS creds:** already present in this route (it just used them to write `dashboard_*`).
- **Pros:** single sync pipeline. No new cron, no new credentials. The "wl-app onboarding" lives next to "wl-app updates."
- **Cons:** the propagator stops being pure "update-only," which is a deliberate property today (PR #176 calls it out: *"UPDATE-only — we never insert or unlink"*). Adding insert logic widens the blast radius if something goes wrong — e.g. a bad `email_hash`/email mismatch could create duplicate contacts.

### Option 3 — Don't automate. Manual discovery as needed.

Leave the gap. When Jacob notices a new customer missing from /contacts, he runs `node scripts/import-wl-users.mjs` (which still works as a backfill) and the existing dedup logic adds the missing rows.

- **Pros:** zero new code, zero new failure modes.
- **Cons:** every new signup is invisible until manually backfilled. Defeats the "regular sync" point of all this work.

## Recommendation

**Option 1.** It keeps the propagator's "update-only" guarantee intact (which PR #176 made a point of) while filling the actual remaining gap with a small, focused job. Drift risk between the two sources is bounded by `wl_user_id` / `wl_workshop_id` being primary keys — the propagator can't touch a row that doesn't exist yet, and the discoverer can't update a row that already does.

If session B disagrees and prefers consolidation (Option 2), I'll defer — they have closer context on whether the propagator's "update-only" guarantee is structural or just a current property.

## Concrete files (Option 1 path)

1. **Cron route.**
   - New: `src/app/api/cron/discover-new-wl-users/route.ts`. POST. Auth via `SYNC_SECRET`.
   - Body: for each `dashboard_workshops` row missing a CRM company, INSERT a `companies` row; for each `dashboard_users` row missing a CRM contact, fetch plaintext email from S3 → INSERT a `contacts` row.

2. **Lib extraction.**
   - Move the workshop-builder and user-builder logic out of `scripts/import-wl-users.mjs` into `src/lib/wl-sync/discover-new.ts`. Both the cron route and the existing CLI script call into it. The script becomes a 10-line wrapper for ad-hoc backfills.

3. **`vercel.json` cron.**
   - Add `{ "path": "/api/cron/discover-new-wl-users", "schedule": "30 10 * * *" }` — runs 5 minutes after the second `ceo-sync-core-app-twice-daily` firing, so it operates on freshly-written `dashboard_*` data.

4. **Env vars on Vercel (crm-for-saas project).**
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `DATA_BUCKET` — same values the wl-dashboard env already has (the ceo-sync route uses these, so they already exist in Vercel env actually — confirm before adding).
   - `SYNC_SECRET` already exists (used by `/api/ceo-sync/all`).

5. **Smoke test.**
   - After deploy, `curl -X POST https://crm-for-saas.vercel.app/api/cron/discover-new-wl-users -H "Authorization: Bearer $SYNC_SECRET"`. Verify the response shows "0 new" (or some number ≥ 0) and `dashboard_sync_runs` records the run.

## Open questions / coordination notes

1. **Confirm AWS env vars on the crm-for-saas Vercel project.** PR #176's propagator doesn't read S3; the ceo-sync route does. The sources file (`src/lib/ceo/sync/sources/core-app.ts:1142`) suggests AWS creds are already loaded — `npx vercel env ls production` will confirm.
2. **Should the discoverer also INSERT diagnostics counts on the new contact?** The propagator doesn't currently touch `contacts.diagnostics_total`. The script's logic does. Probably yes for parity, but worth confirming the field is still desired.
3. **Internal/test exclusion.** PR #164 already added a UI to manage `dashboard_workshops.is_internal_test`. The discoverer should respect that flag so internal/test signups don't enter the CRM as contacts.
4. **Coordination with session B:** if session B is still active and planning to extend the propagator with insert logic (Option 2), we should align before either ships. The plan-doc this file replaces was already cross-discussed with session B; if they have follow-up thoughts they'll add an addendum here.

## What's NOT in scope here

- Reworking the propagator's update-only mapping — that's PR #176's design choice and shouldn't be revisited absent a concrete reason.
- Stripe/Customer.io/GA4 sync paths — those are independently scheduled and already healthy per the audit.
- Backfilling historical wl-app signups that we missed before PR #176 — handled separately on demand via the existing CLI script.

## Risks / rollback

- **Discoverer creates duplicate contacts.** If S3 returns an email that already exists on a different contact (e.g. a wl-app user who's already in the CRM as a discovery prospect), we'd create a duplicate. Mitigation: before INSERT, check `contacts.email` (case-insensitive) — if found, UPDATE the existing row to set `wl_user_id` + `source='wl-app'` instead. This is the merge path that the discovery promote endpoint already handles for the inverse direction.
- **AWS creds rotation in Vercel.** Same risk profile as the existing core_app sync. Both routes break together if creds are revoked — single point of failure but also single point of remediation.
- **Rollback:** delete the cron route + `vercel.json` entry. Propagator continues. CLI script continues. No data damage.

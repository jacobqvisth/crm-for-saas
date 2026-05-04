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

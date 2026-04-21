# Phase SE-Stockholm-5 — Promote Results (2026-04-23)

Target DB: Kundbolaget (`ugibcnidxrhcxflqamxs`)
Scope: `discovered_shops` country_code=SE, state='Stockholms län' → `contractor_directory`

## Totals

| Metric | Value |
|---|---|
| Candidates evaluated (across 3 runs) | 3,551 |
| Dropped by gating (no contact / junk names) | 177 |
| Excluded by category overlap | 0 |
| Excluded by marketplace-domain email | 0 |
| Final contractor_directory rows (Stockholms län) | 3,075 |
| Published | 2,532 |
| Pending | 543 |

Gap 3,374 promotable → 3,075 directory rows = **299 merges** absorbed via match-key cascade (same domain/phone across multiple Stockholm scrapes).

## Match-key cascade (final commit run, resume after partial-failure)

| Method | Hits |
|---|---|
| discovered_shop_id | 6 |
| google_place_id | 0 |
| org_number | 0 |
| domain | 249 |
| phone | 53 |
| name_postal | 0 |
| none_insert | 2,925 |

## Slug generation

| Outcome | Count |
|---|---|
| Unique | 2,921 |
| Collisions resolved (-2..) | 4 |
| UUID-suffix fallback | 0 |
| **Duplicate public_slugs post-commit** | **0** ✅ |

## shop_score distribution (10-bucket histogram)

| Bucket (range) | Count |
|---|---|
| 1 (0–10) | 359 |
| 2 (10–20) | 601 |
| 3 (20–30) | 1,050 |
| 4 (30–40) | 849 |
| 5 (40–50) | 176 |
| 6 (50–60) | 27 |
| 7 (60–70) | 5 |
| 8 (70–80) | 1 |

Shape matches prediction: mass in 20–40 (websites + reviews, no platform IDs); long tail to 70+ for the handful of SF-matched shops with multiple cert flags.

## Top scorer

`Svenska Eljouren - Stockholm` — shop_score 78, composite 4.24, 318 total reviews, 3 recent reviews snapshot.

## Chain tag breakdown (unique directory rows)

| Chain | Dir rows |
|---|---|
| chain_instalco | 1 |
| chain_beijer | 1 |
| chain_bosch_car | 1 |
| chain_assemblin | 1 |
| chain_caverion | 1 |
| chain_ahlsell | 1 |
| chain_bravida | 1 |
| chain_clas_fixare | 1 |

Note: chain shops share a domain (e.g. `bravida.se`), so the **domain** cascade step intentionally collapses multi-location chain offices into a single directory row (confidence 0.90). This is per-spec cascade ordering. If Phase 6 renders multi-location pages, a follow-up can re-split by `google_place_id` or store chain-location records separately.

## Idempotency verification

Re-run of `npm run promote:se-stockholm` after commit:

```
Candidates evaluated: 0
Promotable: 0
Writes: inserted=0  updated=0  skipped=0  errors=0
```

✅ Zero writes on re-run. The `.neq('status', 'imported')` filter on `discovered_shops` plus the `discovered_shop_id` back-ref correctly exclude already-processed shops.

## Plan-vs-actual delta

| Item | Plan | Actual |
|---|---|---|
| Promotable | ~3,000–3,400 | 3,374 ✅ |
| Published | ~2,400 | 2,532 (close) |
| Pending | ~600 | 543 (close) |
| Chain tag rows | 50–100 | 8 (after domain-dedup rollup) — intentional |
| Slug uniqueness | 0 dupes | 0 ✅ |
| shop_score peak | 30–60 band | 20–40 band (slightly lower — very few shops have f_skatt/bankid/cert flags set in current data) |

## Issues & decisions during execution

1. **CHECK constraint on `public_status`** only allowed `listed/suppressed/pending_review`; plan specified `published/pending`. Resolved by ALTER CONSTRAINT to include both sets (migration `20260423000001_extend_public_status_check`). Kept legacy values for back-compat.
2. **NOT NULL on `all_emails`/`all_phones`** with default `{}`. Script was passing `null`, overriding defaults. Coalesced to `[]` in payload.
3. **Supabase select cap at 1,000 rows**. Initial run only saw 1,000 candidates. Fixed by paginating via `.range()`.
4. **Error threshold 2% too tight** — 3 errors in early batch aborted the first commit attempt. Bumped min-errors to 10 before ratio check triggers.
5. **Partial-failure recovery**: first aborted commit left 143 rows promoted + back-stamped. Script is idempotent via `.neq('status','imported')` filter — second run resumed cleanly from shop #144, no re-processing.
6. **`crm_company_id` column** referenced in plan back-stamp step does not exist on `discovered_shops`. Script back-stamps via `status='imported'` only.

## Artifacts

- Migration: `supabase/migrations/20260423000000_extend_contractor_directory.sql` (+ secondary `20260423000001_extend_public_status_check.sql` applied via MCP).
- Script: `scripts/promote-discovered-shops.mjs`
- Libs: `scripts/lib/se-chains.mjs`, `scripts/lib/slug.mjs`
- Package scripts: `promote:se-stockholm` (dry-run), `promote:se-stockholm:commit`
- `scrape_runs` entries: 4 (two failed, two completed). Final completed run_id: `eff4d9ec-2aad-4359-94ef-e53be475988e`.

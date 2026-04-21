# Phase 4 results — ServiceFinder + DoRunner

**Date:** 2026-04-22
**Runs:** SF national (44e1bcc4), SF retry (76beb428), DR national (9a0972b3)
**PRs:** #55 (4a pilot + migration + libs), #57 (this PR — 4b national SF + DR + note)

---

## Summary

- Added **3,595** new rows to `discovered_shops` with `servicefinder_id` set (national SF pass)
- Added **446** new/enriched rows with `dorunner_slug` set (DR national pass)
- Added **2,765** review bodies to `discovered_shop_reviews` from ServiceFinder
- Added **4,055** review bodies from DoRunner
- Total `discovered_shops`: **7,152** (up from ~3,247 before Phase 4)
- Every SF-active row now has: logo (73%), BankID status, F-skatt status

---

## Coverage delta

| Source | Rows | Notes |
|--------|------|-------|
| ServiceFinder | 3,595 | 1,757 active + 1,838 inactive-with-reviews |
| DoRunner | 446 | 394 new inserts + 52 updates to existing rows |
| Both SF + DR | 43 | Overlap is small — DR skews toward established firms |
| SF + Google Maps | 38 | SF profiles that matched existing Google data |
| Google Maps only | 3,151 | Pre-existing from Phases 1–3, untouched |
| **Total** | **7,152** | |

---

## New-field hit rates (SF active rows, n=1,745)

| Field | Count | % |
|-------|-------|---|
| `logo_url` | 1,270 | 73% |
| `bankid_verified = true` | 239 | 14% |
| `f_skatt_registered = true` | 26 | 1.5% |
| `insurance_carrier` | ~9–15 | <1% |
| `warranty_years` | <10 | <1% |

**Notes:**
- Logo coverage dropped from 4a pilot's 89% to 73% nationally — Stockholm profiles are more complete than the national average
- BankID at 14% nationally vs 30% in the 4a Stockholm subset — same pattern (Stockholm contractors are more credentialed/active)
- F-skatt at 1.5% is low; the extended regex added in 4b (`f-skattesedel` variants) improved recall but coverage is inherently limited by SF not always surfacing this data in the ld+json visible text
- Insurance carrier extraction is working but base rate is very low

---

## Cross-source overlap

| Combination | Count |
|-------------|-------|
| SF ∩ DoRunner | 43 |
| SF ∩ Google Maps | 38 |
| SF only | 3,514 |
| DR only | 403 |
| Google Maps only | 3,151 |

SF and DR have very little overlap with each other and with Google Maps, meaning each source adds genuinely new contractors. The 43 SF+DR matches are the highest-quality contractor records (visible on two platforms + reviewed).

---

## Reviews

| Source | Reviews | Unique shops | Avg per shop |
|--------|---------|--------------|--------------|
| ServiceFinder | 2,765 | ~1,200 est. | ~2.3 |
| DoRunner | 4,055 | 447 | ~9.1 |

DR ships far richer review history than SF (no 3-review cap on DR's ld+json). SF inactive profiles contributed almost no reviews — they were deactivated precisely because they had low engagement.

---

## Data-quality observations

1. **SF inactive profiles have no ld+json `name`** — fixed in the retry pass using `<h1>/<title>` fallback. Before fix: 1,896 failures. After fix: 19 failures (99% recovery).

2. **DoRunner footer org number** (`556723-4603`) appears on every DR profile page. The first DR run matched all 448 profiles to 2 shops via this org number. Fixed with a platform-org blocklist. DR contractors rarely expose their own org numbers on the profile page — `org_number` is null for most DR rows, which is expected.

3. **SF listing pages capped at 8–12 per city/trade** — confirmed. Sitemap was the correct discovery universe. Category crawl (9 trades × 184 cities) contributed only 550 unique IDs but was still worthwhile for the `all_categories` trade-slug mapping.

4. **State mapping (postal → län)** covers ~85% of rows. The `null` state count of 740 in the sampled data reflects a mix of edge-case postal prefixes and profiles with missing postal codes.

5. **SF sitemap hierarchy** is 3 levels deep: `sitemap.xml` → `sitemaps/businesses.xml` → `businessesActive.xml` → `businessesActive-1.xml`. The plan assumed 2 levels. Fixed during the session.

---

## Known limitations

- SF ld+json ships only 3 most-recent reviews regardless of `reviewCount`; true history not captured
- DR org numbers are unreliable (see observation 2 above) — cannot be used as a match key for DR
- `pct_with_logo` 73% (vs 80% target) — inactive profiles have no logo; separate SF active-only stat is 73%
- SF reviews at 2,765 (vs 8,000 target) — inactive profiles rarely have reviews; active profile count is 1,757 not 3,000+

---

## Next phase candidates

- **Allabolag org-number pass**: 3,595 SF rows + 446 DR rows lack verified org numbers (DR blocklist, SF only partial). Allabolag lookup by name+city would fill this gap and enable legal/financial enrichment.
- **Reco.se scraping**: Reco has review coverage that complements SF. Could add ~3,000 more review bodies.
- **Quarterly re-scrape cadence**: SF+DR re-scrapes accumulate review history (ld+json caps at 3 most-recent; re-scrapes capture different recents over time).
- **Cross-source deduplication audit**: 43 SF+DR overlapping rows — verify merge quality, especially for `dorunner_rating` vs `servicefinder_rating` fields.

---
type: scrape-plan
country: Finland
country_code: FI
status: draft  # draft → approved → in-progress → done
created: 2026-05-21
---

# Scrape Plan — Finland (FI)

> Step 0 output of [SCRAPE-PLAYBOOK](SCRAPE-PLAYBOOK.md). Lighter pass than NO. **Cleanest registry layer of the 4 markets after NO** — PRH/YTJ Open Data is free, no auth, CC-BY 4.0, with TOL 2008 code `45.20` mapping cleanly.

## A — Country profile

- **Population:** ~5.6M (2024)
- **GDP per capita (nominal USD 2024):** ~$54,774
- **Vehicle stock (end-2024):** 7,337,934 registered; 5,257,813 in active traffic use (stat.fi)
- **Passenger cars (in traffic):** 2,794,387
- **New passenger cars (2024):** 74,065; (2025): 71,890 (mainland)
- **Rechargeable share new cars (2025):** ~60% (EAFO)
- **EVs total (Jan 2025):** ~291k (124k BEV + 167k PHEV)
- **Mandatory inspection regime:** **Katsastus** — every 2 years after age 4 for passenger cars; Traficom-licensed private stations
- **Dominant chains:**
  - **Fixus** — Finland's leading auto service & parts chain, MEKO Group; voted most trusted brand 2024
  - **Mekonomen** — present in FI since 2010, MEKO Group
  - **AD-Autohuolto / AD Finland** — independent network
  - **Vianor** — Nokian-owned, tire+service major
  - **Euromaster** — ~60 FI locations
  - **MECA Truck** — 38 heavy shops (out of ICP)
  - **Koivunen Oy** — major parts+workshop concept
  - **A-Katsastus / Plus Katsastus / Avainasemat** — inspection chains, **EXCLUDE**
- **Trade body:** AKL (Autoalan Keskusliitto) — 167 members covering 523 facilities + 409 affiliate facilities
- **Market quirks:** Finnish + Swedish bilingual market — Helsinki/Turku/Vaasa have meaningful Swedish-language storefronts (search terms may need `bilverkstad` overlap with FI Swedish coast)

## B — Administrative geography

### Top cities (city-grid targets)

| City | Pop | Region | Lat | Lng | Radius (km) |
|------|-----|--------|-----|-----|-------------|
| Helsinki | 684,018 | Uusimaa | 60.1699 | 24.9384 | 12 |
| Espoo | ~335k | Uusimaa | 60.2055 | 24.6559 | 10 |
| Tampere | ~250k | Pirkanmaa | 61.4978 | 23.7610 | 12 |
| Vantaa | ~245k | Uusimaa | 60.2934 | 25.0378 | 10 |
| Oulu | ~210k | Pohjois-Pohjanmaa | 65.0121 | 25.4651 | 12 |
| Turku | ~195k | Varsinais-Suomi | 60.4518 | 22.2666 | 10 |
| Jyväskylä | ~145k | Keski-Suomi | 62.2426 | 25.7473 | 10 |
| Kuopio | ~120k | Pohjois-Savo | 62.8924 | 27.6770 | 8 |
| Lahti | ~120k | Päijät-Häme | 60.9827 | 25.6612 | 8 |
| Pori | ~85k | Satakunta | 61.4847 | 21.7972 | 8 |

**Note:** Helsinki+Espoo+Vantaa form one continuous metro (~1.26M). Consider one combined grid (lat 60.21, lng 24.93, radius 25km) instead of three separate to save Apify spend.

## C — Search term matrix (Finnish, with Swedish overlap on west coast)

| Niche | Primary Finnish | Swedish fallback (coastal cities) | English | Include? |
|-------|----------------|----------------------------------|---------|----------|
| General repair | `autokorjaamo` (dominant), `autohuolto`, `automekaanikko` | `bilverkstad` | `auto repair` | ✅ |
| Tire | `rengashuolto`, `rengasliike` | `däckverkstad` | `tire shop` | ✅ |
| Body | `autopeltikorjaus`, `kolarikorjaamo` | `karosseriverkstad` | `auto body shop` | ✅ |
| Paint | `automaalaamo` | `billackering` | `auto painting` | ✅ |
| EV | `sähköautohuolto` | `elbilverkstad` | `EV repair` | ✅ (emerging) |
| Inspection (chains) | `katsastusasema` | `besiktning` | — | ❌ standalone |
| Motorcycle / truck | — | — | — | ❌ |

**Recommended primary set for country-wide pass:** `autokorjaamo`, `autohuolto`, `rengashuolto`, `autopeltikorjaus`, `automaalaamo`, `sähköautohuolto` (6 terms). Add `bilverkstad` only as Swedish-coast supplemental pass (Turku, Vaasa) — gains marginal.

## D — Include / exclude

**Include:** Auto repair shop, Tire shop, Auto body shop, Auto painting, Mechanic.

**Exclude:** Car dealer, Used car dealer, Auto parts store, Gas station, Car wash, Motorcycle repair shop, Car rental agency, **Vehicle inspection** (`A-Katsastus`, `Plus Katsastus`, `Avainasemat` chains dominate), Auto glass shop, Towing service, Truck dealer.

**Edge cases:** Apply hard name-regex exclusion for `A-Katsastus / Plus Katsastus / Avainasemat` (like Bilprovningen filter for SE in `import-sweden-shops.mjs:66-71`).

## E — Data source & tool selection

### Layers evaluated

| Layer | Source | Coverage | Free? | Decision |
|-------|--------|----------|-------|----------|
| Registry | **PRH/YTJ Open Data** (avoindata.prh.fi) | Comprehensive; TOL 2008 code `45200` ("Moottoriajoneuvojen huolto ja korjaus") | ✅ Free, CC-BY 4.0, no auth | ⚠️ **Verify filterability before launch** — see open question 1 |
| Google Maps | compass/crawler-google-places | Universal | $7/1000 | ✅ Use for placeId + categories + cert flags |
| Yellow pages | fonecta.fi | Decent | Scraping required | 🟡 Defer |
| Industry assoc | AKL — 167 members / 523 facilities | Partial member list public | Scraping required | 🟡 Defer for verified tier |
| Enrichment | MillionVerifier | Universal | Paid | ✅ Use post-import |

### Ranked source stack (final)

1. **PRH/YTJ Open Data — primary registry pull.** TOL 2008 code `45.20`. Bulk download in machine-readable form via Suomi.fi Data Exchange. Build `import-prh-fi-shops.mjs` modeled on `import-scb-shops.mjs`.
2. **Apify Google Maps** — gap-fill + placeId + ratings + categories.
3. **AKL member list** — only if registry + GMaps leave gaps; useful as "verified" tier tag.
4. **MillionVerifier** — email verification.

### Dedup keys

1. Y-tunnus (Finnish business ID) — from PRH pull
2. `google_place_id`
3. Normalized domain
4. Normalized phone (E.164, +358 prefix)
5. Normalized name + postal code

## F — Scrape execution plan

### Source run order

1. **PRH/YTJ pull** (~10 min): fetch all companies under TOL `45.20` via avoindata.prh.fi. Persist to `~/crm-for-saas/scripts/data/prh-fi-4520.json`. Build `import-prh-fi-shops.mjs` (port of `import-scb-shops.mjs`). Idempotent on `(workspace_id, y_tunnus)`.
2. **Apify country-wide pass** with 6-term Finnish set.
3. **Apify city-grid passes** for top 5 (Helsinki metro combined, Tampere, Turku, Oulu, Jyväskylä).
4. **Import to `discovered_shops`** via `import-finland-shops.mjs` (copy of `import-czech-shops.mjs`).
5. **Pattern-MV** (`pattern-mv-fi.mjs`): probe `info@ / asiakaspalvelu@ / korjaamo@ / huolto@ <domain>` (Finnish conventions; on Swedish-coast domains also try `info@`/`kontakt@`).
6. **MillionVerifier sweep**.

### Expected outcome

- **Total unique rows after dedup:** ~3,000–4,500
- **Apify credit cost estimate:** $25–35
- **Estimated duration:** ~1 hour
- **Estimated % with email (valid+catch_all):** 45–55% (FI digitally mature; PRH registry first-party emails help similar to NO brreg)

### Go / no-go summary

**Recommend proceed after NO.** FI is the second-best registry experience (after NO). Combined cost is the lowest of the 4. The bilingual Swedish-coast overlap is a minor variant; otherwise the playbook applies directly.

## Open questions for Jacob

1. **PRH/YTJ filterability — UNRESOLVED.** Probed the v3 API on 2026-05-21: `?mainBusinessLine=45.20` and `?mainBusinessLine=45200` both returned 0 results. The response schema confirms a `mainBusinessLine.type` field exists per company (e.g. `"29120"`), but the top-level filter parameter doesn't seem to query it. Two possibilities: (a) the API only supports single-businessId lookups + bulk download for filtering; (b) the filter param name is different. **Before launch:** check the Swagger UI at avoindata.prh.fi or email `avoindata@prh.fi`. If bulk download is the only path, FI is a bigger lift than expected (parse the daily CSV/JSON dump locally, then filter by `mainBusinessLine.type='45200'`). Worst case, fall back to Apify-only like NL — FI is still doable.
2. **PRH/YTJ email field coverage.** Once filterability is resolved, confirm via sample query whether PRH exposes email/phone fields like brreg does. If yes, % with email trends toward 55-60%; if no, more like 40-45%.
3. **AKL member list scrape.** Worth scraping akl.fi for the 167 members + 523 facilities as a "verified" tier tag (like NBF in NO)?
4. **Helsinki metro combined grid vs split.** Combined saves ~$8 Apify spend at the cost of ~2-5% missed coverage from radius edges. Combined is the default recommendation.

---

## Actual results (fill in after scrape completes)

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Total rows | 3,000–4,500 |  |  |
| % with email | 45–55% |  |  |
| % with phone |  |  |  |
| Unique cities | 10+ |  |  |
| Apify cost | $25–35 |  |  |
| Duration | ~1 hr |  |  |

**Lessons for next country:**
-

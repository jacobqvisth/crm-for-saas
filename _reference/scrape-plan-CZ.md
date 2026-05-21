---
type: scrape-plan
country: Czech Republic
country_code: CZ
status: in-progress  # draft → approved → in-progress → done
created: 2026-04-22
scraped: 2026-04-22
---

# Scrape Plan — Czech Republic (CZ)

> Step 0 output of the `scrape` skill. Awaiting Jacob's approval before any Apify credit is spent. This is the **first non-Nordic/non-Baltic country** in the pipeline and by far the largest by fleet size of anything we've scraped.

## A — Country profile

- **Population:** ~10.9M (CSU, start-of-2026 estimate; 10.52M in 2021 census, steady growth via migration).
- **GDP per capita:** ~$31k nominal / ~$51k PPP (2025 est.) — easily the wealthiest target market in the pipeline so far, comparable to SE/FI on PPP.
- **Registered passenger cars:** ~**6.5M** (6.14M in 2021 per Statista; Min. of Transport reports ~3 cars for every 4 adults; consistent 2–3% YoY growth puts 2025 stock at 6.4–6.6M).
- **Registered light commercial vehicles:** ~660k (N1 class, Eurostat 2024).
- **Cars per 1,000 people:** ~**607** — very high, comparable to Italy and higher than any Baltic state. Strong implication: shop density per capita will be materially higher than LV/EE/LT.
- **EV share of new sales / EV share of stock:**
  - BEV new-sales share: **5.6%** in H1 2025 (up from 3.5% H1 2024); **+53% YoY BEV registrations** in 2025 YTD.
  - BEV stock: ~**36,000** (EOY 2024 per EAFO) — trending toward ~50–55k by EOY 2025.
  - BEVs still <1% of total fleet → primary workshop demand remains ICE-dominated.
- **Mandatory inspection regime:** **STK** (Stanice technické kontroly), administered by **~350 licensed stations** (mix of state-linked and private operators — unlike LV, CZ has a meaningful private STK industry).
  - New cars: first STK after 4 years, then every 2 years
  - Commercial / heavy: annual
  - Non-compliance penalty: up to **50,000 CZK** + operation ban — strong enforcement = steady pre-STK prep work for shops.
- **Import tax / fleet notes:**
  - No CO₂-based first-registration tax. Standard EU VAT 21%. Modest annual road tax.
  - Fleet is **older than the EU average** (~14 years avg) but skews less dieselly than the Baltics — diesel still dominant but gasoline share is meaningful in Prague.
  - Large domestic manufacturing presence (Škoda/VW, TPCA in Kolín, Hyundai Nošovice) creates secondary industry density around Mladá Boleslav, Kolín, Nošovice.
- **Dominant brands / aftermarket chains:**
  - **Bosch Car Service** — large franchise footprint (`bcservice.cz`); dozens of locations nationwide (Prostějov, Ostrava, Přerov, Opava, Karviná, Nový Jičín, Písek, Jičín, etc.).
  - **BestDrive** — pan-CZ tyre+service chain (`bestdrive.cz`), Continental-owned.
  - **AD Partner / Auto Kelly** — parts-distributor-linked independent network.
  - **Inter Cars** — Polish parts distributor, cooperates with many independents (no owned stations).
  - **Mekonomen / MECA** — minimal direct presence in CZ (weaker than SE/FI).
  - **Škoda authorized service** — dense dealership+service network given Škoda's home market.
  - Long tail of **small independents** — single owner, 2–5 bays. The bulk of the ICP.
- **Other market quirks:**
  - **Two mandatory tyre swaps/year** (winter tyre rule Nov 1 – Mar 31 when conditions warrant) → strong `pneuservis` market, but pure tyre-only shops are not ICP (per the LV precedent).
  - **Large domestic automotive R&D** → more owner-operators with real technical depth than the Baltic average.
  - **Language:** Czech only (not bilingual like LV). German and English signage present in border regions and tourist Prague, but search indexing is predominantly in Czech.
  - **Prague-concentrated demand**: ~12% of pop but ~20%+ of registered vehicles; workshop count scales with vehicle density, so Prague metro alone will be ~1,000+ shops.

## B — Administrative geography

### Regions (kraje, CSU 2024 estimates)

| Region | Population | Notable cities | Est. shops |
|--------|-----------|----------------|-----------|
| Praha (Capital) | 1,384,000 | Praha | ~1,000–1,400 |
| Středočeský (Central Bohemia) | 1,440,000 | Kladno, Mladá Boleslav, Příbram, Kolín | ~900–1,200 |
| Jihomoravský (South Moravian) | 1,220,000 | Brno, Znojmo, Hodonín, Břeclav | ~750–1,000 |
| Moravskoslezský | 1,180,000 | Ostrava, Havířov, Karviná, Frýdek-Místek, Opava | ~700–950 |
| Ústecký | 800,000 | Ústí n. Labem, Most, Děčín, Teplice, Chomutov | ~500–700 |
| Jihočeský (South Bohemian) | 645,000 | České Budějovice, Tábor, Písek | ~400–550 |
| Plzeňský | 606,000 | Plzeň, Klatovy | ~380–520 |
| Olomoucký | 625,000 | Olomouc, Přerov, Prostějov, Šumperk | ~400–550 |
| Zlínský | 574,000 | Zlín, Uherské Hradiště, Kroměříž, Vsetín | ~360–490 |
| Královéhradecký | 541,000 | Hradec Králové, Trutnov, Náchod | ~340–460 |
| Pardubický | 523,000 | Pardubice, Chrudim, Svitavy | ~330–450 |
| Vysočina | 504,000 | Jihlava, Třebíč, Žďár n. Sázavou | ~320–430 |
| Liberecký | 442,000 | Liberec, Jablonec, Česká Lípa | ~280–380 |
| Karlovarský | 284,000 | Karlovy Vary, Cheb, Sokolov | ~180–250 |
| **Total** | **~10.9M** | | **~6,000–8,500 raw** → **~4,500–6,500 unique** after dedup |

These estimates apply the LT ratio (≈1 shop per 1,400 people) with a light discount because Google Maps under-indexes rural eastern regions. Reality check: Prague alone has 3,500+ results for `autoservis` on `firmy.cz`, but with heavy overlap (dealers, tyre shops, parts stores); filtered ICP count lands around the 1,000–1,400 range.

### Top cities — city-grid targets

CZ is the largest country in the pipeline. Country-wide queries will **definitely** hit the 500-cap, so city-grids are essential. Everything above ~50k gets an individual pass; Prague, Brno, Ostrava get split-by-search-term to clear their own 500-caps.

| City | Population | Lat | Lng | Radius (m) | Expected shops |
|------|-----------|-----|-----|------------|----------------|
| Praha | 1,384,000 | 50.0755 | 14.4378 | 20000 | 900–1,300 |
| Brno | 381,000 | 49.1951 | 16.6068 | 15000 | 300–450 |
| Ostrava | 284,000 | 49.8209 | 18.2625 | 15000 | 230–320 |
| Plzeň | 170,000 | 49.7384 | 13.3736 | 12000 | 140–200 |
| Liberec | 105,000 | 50.7663 | 15.0543 | 10000 | 80–120 |
| Olomouc | 100,000 | 49.5938 | 17.2509 | 10000 | 80–120 |
| České Budějovice | 95,000 | 48.9744 | 14.4744 | 10000 | 80–115 |
| Ústí nad Labem | 92,000 | 50.6608 | 14.0321 | 10000 | 75–110 |
| Hradec Králové | 92,000 | 50.2091 | 15.8327 | 10000 | 75–110 |
| Pardubice | 91,000 | 50.0343 | 15.7812 | 10000 | 75–110 |
| Zlín | 74,000 | 49.2264 | 17.6667 | 10000 | 60–90 |
| Havířov | 70,000 | 49.7957 | 18.4368 | 8000 | 55–80 |
| Kladno | 69,000 | 50.1475 | 14.1027 | 8000 | 55–80 |
| Most | 62,000 | 50.5030 | 13.6362 | 8000 | 50–75 |
| Karviná | 51,000 | 49.8547 | 18.5418 | 8000 | 40–60 |

Notes:
- **Praha**, **Brno**, **Ostrava** get split-by-search-term grids (run each primary term separately against the same geolocation) to clear the 500-cap.
- Mladá Boleslav (44k, Škoda HQ) is below the grid threshold but will be well-covered by the country-wide pass + Středočeský residual. No dedicated grid.
- Kolín (31k, TPCA plant) — same logic.

## C — Search term matrix

Language: Czech only. Slovak-language parallels are absorbed by country-wide CZ queries (rare cross-border shops auto-categorize in Czech).

| Niche | Primary local term(s) | English fallback | Include? | Notes |
|-------|----------------------|------------------|----------|-------|
| General repair / mechanic | `autoservis`, `auto servis` | `auto repair`, `car repair shop` | ✅ | `autoservis` dominates. Run both spacing variants — Google treats them slightly differently. |
| Body shop / paint | `autolakovna`, `karosárna`, `klempířství` | `auto body shop` | ✅ | Large category given older fleet. `autolakovna` = paint shop, `karosárna` = body shop — run as separate terms. |
| Inspection / STK | `stanice technické kontroly`, `STK` | `vehicle inspection` | ❌ | Private STK industry exists but is a **separate ICP** (distinct revenue model). Exclude this pass. |
| Tyre shop | `pneuservis`, `pneumatiky` | `tire shop` | ❌ | **Excluded this pass** per LV precedent. Combined shops still caught via `autoservis`. |
| EV specialist | `elektromobil servis`, `servis elektromobilů` | `EV repair` | ⚠️ | Include as a side term but expect <30 results. Stock too small. |
| Brand / chain specialist | `Bosch Car Service`, `BestDrive`, `Škoda servis` | — | ➖ | Absorbed by `autoservis` queries — no separate pass needed. |
| Truck / heavy / commercial | `servis nákladních vozidel`, `kamion servis` | `truck repair` | ❌ | **Skipped this pass** per LV precedent. Revisit if truck ICP emerges. |
| Motorcycle | `moto servis` | `motorcycle repair` | ❌ | Not ICP. |
| Car wash | `myčka aut` | `car wash` | ❌ | Not ICP. |
| Car dealer | `autobazar`, `prodejce aut` | `car dealer` | ❌ | Not ICP. |

**Country-wide search strings (run as a single actor call):**
1. `autoservis`
2. `auto servis`
3. `autolakovna`
4. `karosárna`

**City-grid search strings (run per city in B):**
1. `autoservis`
2. `karosárna`

Prague / Brno / Ostrava also split `autoservis` and `karosárna` across **two separate geolocation runs each** to maximise results under the 500-cap.

## D — Include / exclude list

> **Array-overlap semantics.** Google Maps returns `categories[]` per place. A shop is **excluded only if every one of its categories is in the exclude list**. A shop tagged both `"Tire shop"` AND `"Auto repair shop"` survives. Filtering runs against `all_categories`, never `category`.

**Include categories (any match → keep):**
- Auto repair shop
- Car repair and maintenance service
- Mechanic
- Auto body shop
- Car service station
- Brake shop
- Transmission shop
- Diesel engine repair service
- Auto electrical service
- Wheel alignment service
- Muffler shop
- Auto radiator repair service
- Auto air conditioning service
- Auto tune up service
- Oil change service
- Vehicle inspection service *(tag only; CSDD-style operator exclusions don't apply — CZ private STK is legitimate but separate ICP; filter at import-time via name pattern if needed)*

**Exclude categories (only excluded if *all* of a shop's categories are in this list):**
- Tire shop
- Truck repair shop
- Car dealer
- Used car dealer
- Motorcycle dealer
- Motorcycle repair shop
- Auto parts store
- Gas station
- Car wash
- Car rental agency
- Motor scooter dealer
- ATV dealer
- Scrap metal dealer
- Junkyard
- Car accessories store
- Tuning shop *(cosmetic-only tuning, edge case; keep if they also do repair)*
- Driving school
- Car detailing service

**Edge cases / judgment calls for CZ:**
- **Škoda / ŠkodaAuto authorized service centers** will have `Car dealer` + `Auto repair shop`. Array-overlap keeps them. Flag with `dealer_service` tag at import for ICP tiering — they are not independents but the service-side revenue is real.
- **TPCA and Hyundai Nošovice tied shops** — same pattern, flag as `dealer_service`.
- **BestDrive / Mitas / Barum points** — often tagged both `Tire shop` AND `Auto repair shop`. Array-overlap keeps them correctly.
- **STK stations** — mostly private in CZ. If tagged `Vehicle inspection service` only, exclude by name pattern (`STK`, `Stanice technické kontroly`, domain contains `stk.`). If also tagged `Auto repair shop`, keep.
- **Mladá Boleslav / Kolín / Nošovice factory-tied shops** — keep; they are real workshops serving the local fleet.
- **Prague heavy exclude flags** — Prague has many luxury/import dealers (`Porsche`, `Mercedes-Benz`, `BMW`) with service centers. These will survive via overlap — correct. ICP tiering is a later decision.

## E — Data source & tool selection

### Layers evaluated

| Layer | Source | Coverage | Free? | Apify actor? | Decision |
|-------|--------|----------|-------|--------------|----------|
| Registry (official) | **ARES** (wwwinfo.mfcr.cz/ares) | All CZ legal entities with NACE (CZ-NACE 45.20 = motor vehicle repair) | Free, public API | No off-the-shelf actor; well-documented REST + XML | **Layer 2 (deferred to Pass 2)** — excellent coverage but custom scrape required |
| Directory | **firmy.cz** | Near-complete CZ business directory; category-indexed | Free to browse | No dedicated actor; possible via `apify/web-scraper` | **Optional gap fill** after Maps |
| Directory | **edb.eu** (European Databank) | Regional pages per kraj (jihomoravsky, etc.) | Free | Generic scraper | Low priority — likely redundant with firmy.cz |
| Google Maps | `compass/crawler-google-places` | Very good for CZ; mature market means most shops are indexed | $7/1,000 places | Yes | **Primary source** |
| Facebook Pages | FB scraper | Moderate value — CZ shops tend to have websites, not FB-only | Paid | Yes (`apify/facebook-pages-scraper`) | **Skip this pass** |
| Enrichment | **Prospeo** | Decent CZ coverage (better than Baltics) | Paid | Existing integration | **Run after primary** |
| Enrichment | Vibe Prospecting | Weak in CZ owner layer | Paid | MCP connected | **Skip for CZ first pass** |
| Email verification | MX check | — | Free | Existing pipeline | **Always run last** |

### Ranked source stack (final)

1. **Google Maps (primary)** — country-wide pass + 15-city grid; Prague/Brno/Ostrava split by search term. Captures ~4,500–6,500 unique shops. This is by far the biggest scrape we've run.
2. **Prospeo enrichment (gap fill, domain → email)** — on shops with `website` but no `primary_email`.
3. **MX verification (cleanup)** — write `email_valid` + `email_check_detail` to `discovered_shops`.
4. **(Deferred to Pass 2)** ARES custom scrape against CZ-NACE 45.20 registry — best for closing the long-tail gap and adding VAT numbers for dedup.

### Dedup keys (priority order)

1. `google_place_id` (primary — this pass is Maps-only)
2. Normalized domain (strip protocol, www., trailing slash; lowercase)
3. Normalized phone (E.164, +420 for CZ)
4. Lowercased name + city combo (last-resort, for shops missing domain + phone)

VAT (DIČ) is not exposed by Google Maps. ARES would add it in Pass 2.

## F — Scrape execution plan

### Source run order

1. **Apify Google Maps — country-wide pass**
   - `countryCode: "cz"`, `searchStringsArray: ["autoservis", "auto servis", "autolakovna", "karosárna"]`, `maxCrawledPlacesPerSearch: 500`, `scrapeContacts: true`, `language: "cs"`, `includeOpeningHours: true`.
   - Expected: ~1,800–2,000 raw rows (will max out on `autoservis` and `auto servis` at 500 each).
2. **Apify Google Maps — city-grid passes (15 cities, 2 terms each, with PRA/BRN/OST splits)**
   - Total: **15 + 3 split-grid extras = 18 geolocation actor calls**, each with 1–2 `searchStringsArray` terms at cap 500.
   - Uses `customGeolocation` (`{ type: "Point", coordinates: [lng, lat], radiusMeters: <from B> }`).
   - Expected: ~4,500–6,000 additional raw rows, heavy overlap with pass 1.
3. **Python dedup + normalization in sandbox** — by dedup keys in E; emit `scripts/cz-shops-data.json`.
4. **Supabase import** — `scripts/import-czech-shops.mjs` (copy of the Estonia script, edited for CZ filename). Upsert on `google_place_id`.
5. **Prospeo enrichment** — rows with `website` but no `primary_email`; use existing rate-limited pipeline.
6. **MX verification** — all rows with any email, standard pipeline writing `email_valid` + `email_check_detail`.

### Google Maps passes

- **Country-wide terms (500-cap each):** `autoservis`, `auto servis`, `autolakovna`, `karosárna`
- **City-grid terms (per city in B, 2 terms each):** `autoservis`, `karosárna`
- **Prague / Brno / Ostrava split grids:** 2 extra geolocation calls per city, each with a single term — doubles the cap.

### Expected outcome

- Total raw rows (pre-dedup): **~6,500–8,500**
- Total unique rows after dedup: **~4,500–6,500**
- Apify credit cost estimate: **~$45–60** at $7 / 1,000 places
- Estimated duration: **3–5 hours** (18 geolocation runs + 1 country-wide, polled serially or in 3–4 parallel batches)
- Estimated % with email: **45–60%** (higher than Baltics; CZ has stronger web presence — Wrenchlane's SE scrape hit ~50%)
- Estimated % with phone: **92–96%**

### Go / no-go summary

Recommend proceeding with **one caveat: this is ~5× the scale of any previous single-country scrape** (LT was the biggest at ~2,000 unique). Budget-wise the Apify cost is still modest (~$45–60) but the time and the review burden afterward is real — expect 3–5 hours of actor-run time and a large `cz-shops-data.json` (~15–25 MB). The multi-category pipeline from PR #41 has been battle-tested on LV; it should handle CZ cleanly. Prague/Brno/Ostrava split-grid trick is essential to avoid under-coverage; without it we'd leave 1,500+ shops on the table. Prospeo credits may get heavy if we enrich 2,500+ missing-email rows — worth checking credit balance before Step 5 triggers automatically. **Go.**

---

## Actual results (2026-04-22)

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Total rows (unique, post-dedup) | ~4,500–6,500 | **5,709** | within range |
| Raw rows (pre-dedup) | ~6,500–8,500 | 7,230 | within range |
| Dup placeId removed | n/a | 399 | — |
| Dup domain/phone/name+city removed | n/a | 1,108 | — |
| Category-filtered | n/a | 7 | tiny — CZ Google Maps is well-categorized |
| % with email | 45–60% | **50%** (2,849) | on plan |
| % with phone | 92–96% | **91%** (5,172) | slightly below |
| % with website | n/a | 63% (3,580) | — |
| Unique cities | ~200+ | **952** | well above (long-tail villages show up) |
| Apify cost | ~$45–60 | TBD (poll end-of-run) | — |
| Duration | 3–5 hours | ~2 hours (Waves 1+2 SUCCEEDED) | **faster than expected** |

### Run ledger — 14 of 15 runs complete

- **Wave 1 (4 runs, 4,667 raw):** Country-wide 2,000 | Praha 1,000 | Brno 967 | Ostrava 700
- **Wave 2 (11 runs, 2,563 raw):** Plzeň 418 | České Budějovice 371 | Hradec Králové 333 | Liberec 303 | Olomouc 272 | Pardubice 244 | Zlín 182 | Ústí 177 | Most 139 | Havířov 124 | Kladno **0 (first attempt failed geocoding)**
- **Kladno retry** (`vU7fBatKNajr2wSO1`, searchString-based `autoservis Kladno` / `auto servis Kladno`) — IN PROGRESS at time of this write; will be appended via idempotent re-run of `import-czech-shops.mjs`.

### Lessons for next country

- **500-cap hits are the main driver of city-grid design.** CZ country-wide hit the cap on every term (2,000 / 4×500), Praha hit the cap on both terms (1,000 / 2×500), Brno nearly hit it (967). Every grid term at cap means hidden shops — pre-plan split-by-term for any city projected above ~400 results.
- **`city:` parameter can silently geocode-miss.** Kladno (5th-largest CZ city) returned 0 items when passed as `city: "Kladno"`. Fallback: use `searchStringsArray` with the city name embedded (`"autoservis Kladno"`). For future countries, validate any city returning 0 the same day — don't discover it days later.
- **Secondary-key dedup was worth it.** 399 placeId dups + 1,108 secondary-key dups (domain / phone / name+city). Running placeId-only would have left ~19% of the list as soft duplicates. Chains (Bosch Car Service, BestDrive, franchise autoservis networks) are the main source.
- **Category filter barely moved the needle (7 of 7,230).** Google Maps categories in CZ are tighter than in Nordic countries — almost everything coming back under `autoservis` / `auto servis` / `autolakovna` / `karosárna` is in scope. Array-overlap rule is still right, but for CZ-sized markets the filter is a safety net, not a yield gate.
- **952 unique cities from 15 targeted grids** — the country-wide pass picked up long-tail villages well. City-grid waves were still additive (+2,563 raw), but the country-wide pass alone would have covered most metros.
- **~50% email coverage** matched the plan ceiling for Central Europe. Prospeo enrichment on the ~2,860 missing-email rows with websites (63% have sites) is the obvious next step before MX verification.
- **2 hours end-to-end vs 3–5 hour estimate** — parallel wave launches (rather than serial) saved significant wall-clock. Worth replicating for SK and larger markets.

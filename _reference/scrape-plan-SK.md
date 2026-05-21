---
type: scrape-plan
country: Slovakia
country_code: SK
status: done  # draft → approved → in-progress → done
created: 2026-04-22
approved: 2026-04-22
kickoff_prompt: ../_prompts/cowork-prompt-sk-scrape-kickoff.md
---

# Scrape Plan — Slovakia (SK)

> Step 0 output of the `scrape` skill. Awaiting Jacob's approval before any Apify credit is spent. Paired with `scrape-plan-CZ.md` (same session). SK is the smaller sibling — similar language family, simpler geography, leaner execution than CZ.

## A — Country profile

- **Population:** ~5.43M (Statistical Office SR, 2024 estimate; stable with slight migration-driven decline).
- **GDP per capita:** ~$25k nominal / ~$41k PPP (2025 est.) — lower than CZ, higher than any Baltic state.
- **Registered passenger cars:** ~**2.6M** (2.49M in 2021 per Statista; ~2% YoY → 2025 stock ~2.6M). Total registered vehicles across all classes: **3.30M** (EOY 2023, CEIC).
- **Registered light commercial vehicles:** ~250k (Eurostat 2024 N1 class).
- **Cars per 1,000 people:** ~**479** — mid-pack Europe, materially lower than CZ (~607) but higher than LV (~415).
- **EV share of new sales / EV share of stock:**
  - BEV new-sales share: **>5% in 2025** for the first time; **+77% YoY BEV growth** through October 2025 (EAFO).
  - BEV stock: ~**24,661** EOY 2025 (EAFO). Total EV (incl. PHEV) ~26,300.
  - EV stock ~1% of total fleet → workshop demand remains ICE-dominated.
- **Mandatory inspection regime:** **STK** (Technická kontrola), mandatory for all M, N, O, T, R categories.
  - New cars: first STK after 4 years, then every 2 years.
  - Non-compliance fine: ~55 EUR per missed inspection (TK + EK), up to ~330 EUR if escalated.
  - STK stations are **a mix of state-linked and private operators** (similar to CZ; unlike LV's state monopoly).
- **Import tax / fleet notes:**
  - Standard EU VAT 20%. Modest annual road tax based on engine size / emissions.
  - Fleet age: ~14 years avg — older than EU average, similar to CZ, slightly younger than LV.
  - **Slovakia is the world's per-capita car-production leader** (7th by volume, 20th globally — Kia Žilina, VW Bratislava, PSA Trnava, JLR Nitra). This creates dense supplier/aftermarket clusters around those plants.
- **Dominant brands / aftermarket chains:**
  - **Bosch Car Service** — meaningful SK footprint (Bratislava, Banská Bystrica, Poprad, Prešov, Nové Zámky, Námestovo, Bardejov, Žiar nad Hronom, etc.).
  - **Continental / BestDrive** — tyre+service chain, present but smaller than in CZ.
  - **Inter Cars / AD Slovakia** — parts-distributor-linked independent network.
  - **Authorized dealer service** — dense for Kia, VW, Škoda, PSA given domestic manufacturing.
  - **Long tail of small independents** — the bulk of the ICP, same pattern as CZ/LV.
- **Other market quirks:**
  - **Bilingual edges:** Hungarian is widely spoken in the south (Nitra, Komárno, Dunajská Streda, Košice outskirts); Rusyn/Ukrainian in the far east. Most shops list in Slovak; cross-language coverage is fine with a Slovak primary.
  - **Mandatory winter tyres (Nov 15 – Mar 31 under snow/ice conditions)** → active `pneuservis` market but not ICP.
  - **Eastern regions (Prešov, Košice) are poorer** — higher share of Facebook-only shops than western SK.
  - **Automotive manufacturing clusters** around Žilina (Kia), Bratislava (VW), Trnava (PSA), Nitra (JLR) create local aftermarket density well above population-weighted estimates.
  - **Language note:** Slovak is close enough to Czech that `autoservis` / `pneuservis` work in both languages. The only SK-specific term Jacob should be aware of is `autoopravovňa` (a more formal/technical word for auto workshop, less common but still indexed).

## B — Administrative geography

### Regions (kraje, ŠÚSR 2024 estimates)

| Region | Population | Notable cities | Est. shops |
|--------|-----------|----------------|-----------|
| Bratislavský | 722,000 | Bratislava, Pezinok, Senec | ~550–750 |
| Košický | 801,000 | Košice, Michalovce, Spišská Nová Ves | ~450–600 |
| Prešovský | 820,000 | Prešov, Poprad, Humenné, Bardejov | ~400–550 |
| Žilinský | 691,000 | Žilina, Martin, Čadca, Dolný Kubín | ~400–550 |
| Nitriansky | 665,000 | Nitra, Nové Zámky, Komárno, Levice | ~400–550 |
| Banskobystrický | 634,000 | Banská Bystrica, Zvolen, Lučenec | ~350–500 |
| Trenčiansky | 573,000 | Trenčín, Prievidza, Považská Bystrica | ~330–460 |
| Trnavský | 565,000 | Trnava, Piešťany, Galanta, Dunajská Streda | ~330–460 |
| **Total** | **~5.47M** | | **~3,200–4,400 raw** → **~2,200–3,200 unique** after dedup |

Estimates apply the LT/CZ-derived ratio (~1 shop per 1,500 people, slightly lower than CZ given SK's lower cars-per-capita). Reality check: Bratislava metro should produce the densest cluster; Košice is SK's manufacturing second city and will over-index on its population weight.

### Top cities — city-grid targets

| City | Population | Lat | Lng | Radius (m) | Expected shops |
|------|-----------|-----|-----|------------|----------------|
| Bratislava | 444,000 | 48.1486 | 17.1077 | 15000 | 450–650 |
| Košice | 229,000 | 48.7164 | 21.2611 | 12000 | 200–290 |
| Prešov | 83,000 | 49.0014 | 21.2393 | 10000 | 75–110 |
| Žilina | 79,000 | 49.2228 | 18.7394 | 10000 | 80–115 (Kia cluster) |
| Nitra | 77,000 | 48.3069 | 18.0878 | 10000 | 75–110 (JLR cluster) |
| Banská Bystrica | 75,000 | 48.7392 | 19.1534 | 10000 | 70–100 |
| Trnava | 65,000 | 48.3775 | 17.5883 | 10000 | 70–100 (PSA cluster) |
| Martin | 53,000 | 49.0650 | 18.9221 | 8000 | 45–65 |
| Trenčín | 54,000 | 48.8946 | 18.0447 | 8000 | 45–65 |
| Poprad | 50,000 | 49.0585 | 20.2966 | 8000 | 40–60 |

Notes:
- **Bratislava** gets split-by-search-term (two grids, one term each) to clear the 500-cap — similar pattern to Prague but smaller scale.
- **Košice** likely doesn't need splitting but we keep a single-grid 500-cap call, which should be sufficient.
- **Žilina, Nitra, Trnava** each gets a dedicated city-grid given the manufacturing-cluster bump (will over-index vs population).
- Cities below 50k are absorbed by the country-wide pass.

## C — Search term matrix

Language: Slovak. Strong overlap with Czech — `autoservis` and `pneuservis` are identical. Hungarian-region shops self-list in Slovak; cross-language coverage is not a problem.

| Niche | Primary local term(s) | English fallback | Include? | Notes |
|-------|----------------------|------------------|----------|-------|
| General repair / mechanic | `autoservis`, `auto servis`, `autoopravovňa` | `auto repair` | ✅ | `autoservis` dominant; `autoopravovňa` more formal. Run all three. |
| Body shop / paint | `autolakovňa`, `karoséria`, `klampiarstvo` | `auto body shop` | ✅ | `autolakovňa` = paint, `karoséria` = body. Run both. |
| Inspection / STK | `stanica technickej kontroly`, `STK` | `vehicle inspection` | ❌ | **Separate ICP.** Exclude this pass. |
| Tyre shop | `pneuservis`, `pneumatiky` | `tire shop` | ❌ | **Excluded this pass.** Combined shops still caught via `autoservis`. |
| EV specialist | `servis elektromobilov`, `elektromobil servis` | `EV repair` | ⚠️ | Include but expect <20 results. Stock too small. |
| Brand / chain specialist | `Bosch Car Service`, `BestDrive` | — | ➖ | Absorbed by `autoservis` queries. |
| Truck / heavy / commercial | `servis nákladných vozidiel`, `autoservis kamiónov` | `truck repair` | ❌ | **Skipped this pass.** |
| Motorcycle | `motoservis` | `motorcycle repair` | ❌ | Not ICP. |
| Car wash | `umývanie áut`, `autoumývareň` | `car wash` | ❌ | Not ICP. |
| Car dealer | `autobazár`, `predajca áut` | `car dealer` | ❌ | Not ICP. |

**Country-wide search strings (single actor call):**
1. `autoservis`
2. `auto servis`
3. `autoopravovňa`
4. `autolakovňa`
5. `karoséria`

**City-grid search strings (per city in B):**
1. `autoservis`
2. `karoséria`

Bratislava also splits `autoservis` and `karoséria` across **two separate geolocation runs** to clear its cap.

## D — Include / exclude list

> **Array-overlap semantics.** Google Maps returns `categories[]`. A shop is **excluded only if every one of its categories is in the exclude list**. Filtering runs against `all_categories`.

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
- Vehicle inspection service *(tag only; SK private STK is legitimate but separate ICP — filter at import if needed)*

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
- Driving school
- Car detailing service

**Edge cases / judgment calls for SK:**
- **Kia / VW / PSA / JLR authorized dealer service** — same `dealer_service` tagging strategy as CZ. Keep via overlap.
- **Manufacturing-cluster cities** (Žilina, Bratislava, Trnava, Nitra) will over-index on dealer+service hybrids. Flag all for ICP tiering; don't exclude.
- **STK stations** — mostly private in SK. Filter by name pattern (`STK`, `Stanica technickej kontroly`, domain contains `stk.`) at import if they carry only `Vehicle inspection service` — keep if also `Auto repair shop`.
- **Hungarian-border shops** (Komárno, Dunajská Streda) may list in both Slovak and Hungarian. Google Maps usually returns the Slovak primary listing — no need for Hungarian terms.
- **Facebook-only shops in the east** (Prešov, Humenné, Bardejov) — smaller coverage gap than LV-Latgale but exists. Acceptable in Pass 1; revisit if import shows thin eastern coverage.

## E — Data source & tool selection

### Layers evaluated

| Layer | Source | Coverage | Free? | Apify actor? | Decision |
|-------|--------|----------|-------|--------------|----------|
| Registry (official) | **ORSR** (orsr.sk) | All SK legal entities; searchable by name/ICO/NACE | Free | No off-the-shelf actor; basic ASP search forms, scrape-friendly | **Layer 2 (deferred)** — custom scrape possible but friction high |
| Registry (commercial) | **FinStat.sk** | Excellent SK business-data aggregator; NACE-indexed; free search, paid API | Freemium | No dedicated actor | **Layer 2 (deferred)** — best Pass-2 candidate |
| Directory | **zoznam.sk / azet.sk** | SK business directories with category browse | Free | Generic scraper | Optional gap fill |
| Directory | **trade.tym.sk** | Smaller SK directory | Free | Generic scraper | Low priority |
| Google Maps | `compass/crawler-google-places` | Very good for SK; mature market, shops well-indexed | $7/1,000 places | Yes | **Primary source** |
| Facebook Pages | FB scraper | Higher value in eastern SK than western | Paid | Yes (`apify/facebook-pages-scraper`) | **Skip this pass** |
| Enrichment | **Prospeo** | Decent SK coverage | Paid | Existing integration | **Run after primary** |
| Enrichment | Vibe Prospecting | Weak in SK owner layer | Paid | MCP connected | **Skip** |
| Email verification | MX check | — | Free | Existing pipeline | **Always run last** |

### Ranked source stack (final)

1. **Google Maps (primary)** — country-wide + 10-city grid, Bratislava split by search term. Captures ~2,200–3,200 unique shops.
2. **Prospeo enrichment (gap fill, domain → email)** — on shops with `website` but no `primary_email`.
3. **MX verification (cleanup)** — write `email_valid` + `email_check_detail` to `discovered_shops`.
4. **(Deferred to Pass 2)** FinStat / ORSR custom scrape against NACE 45.20 for long-tail + VAT numbers.

### Dedup keys (priority order)

1. `google_place_id` (primary — this pass is Maps-only)
2. Normalized domain
3. Normalized phone (E.164, +421 for SK)
4. Lowercased name + city combo (last-resort)

VAT (IČ DPH) is not exposed by Google Maps. FinStat/ORSR would add it in Pass 2.

## F — Scrape execution plan

### Source run order

1. **Apify Google Maps — country-wide pass**
   - `countryCode: "sk"`, `searchStringsArray: ["autoservis", "auto servis", "autoopravovňa", "autolakovňa", "karoséria"]`, `maxCrawledPlacesPerSearch: 500`, `scrapeContacts: true`, `language: "sk"`, `includeOpeningHours: true`.
   - Expected: ~1,800–2,200 raw rows (likely maxed on `autoservis`, lower on the formal / body terms).
2. **Apify Google Maps — city-grid passes (10 cities, 2 terms each, + BA split)**
   - Total: **10 + 1 split-grid extra = 11 geolocation actor calls**.
   - Uses `customGeolocation` per city.
   - Expected: ~1,600–2,200 additional raw rows, heavy overlap with pass 1.
3. **Python dedup + normalization in sandbox** — emit `scripts/sk-shops-data.json`.
4. **Supabase import** — `scripts/import-slovakia-shops.mjs` (copy of the Estonia script). Upsert on `google_place_id`.
5. **Prospeo enrichment** — rows with `website` but no `primary_email`.
6. **MX verification** — all rows with any email.

### Google Maps passes

- **Country-wide terms (500-cap each):** `autoservis`, `auto servis`, `autoopravovňa`, `autolakovňa`, `karoséria`
- **City-grid terms (per city in B, 2 terms each):** `autoservis`, `karoséria`
- **Bratislava split grid:** 2 extra calls, single-term each — doubles the cap.

### Expected outcome

- Total raw rows (pre-dedup): **~3,400–4,400**
- Total unique rows after dedup: **~2,200–3,200**
- Apify credit cost estimate: **~$24–32** at $7 / 1,000 places
- Estimated duration: **1.5–3 hours** (11 geolocation runs + 1 country-wide)
- Estimated % with email: **45–55%** (similar to CZ baseline expectation)
- Estimated % with phone: **90–95%**

### Go / no-go summary

Recommend proceeding. SK is ~½ the scale of CZ and the execution plan is a close mirror — same multi-category pipeline, same actor, same dedup strategy, just fewer city-grids and no Brno/Ostrava-style splits. Apify cost is modest (~$24–32) and duration fits comfortably in a single session. **If run alongside CZ** (same Cowork thread), total combined cost lands at ~$70–95 and combined duration ~5–8 hours of actor-run time — still well within a single-day pipeline. **Go — and recommend running SK first, CZ second**, so SK serves as a smaller calibration run before committing to the larger CZ budget.

---

## Actual results (fill in after scrape completes)

Scrape completed: 2026-04-22. Import script: `scripts/import-slovakia-shops.mjs`.

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Total rows (unique) | ~2,200–3,200 | **3,573** | +12–62% above plan |
| Raw rows (pre-dedup) | ~3,400–4,400 | **4,918** | +12% above plan |
| % with email | 45–55% | **40%** (1,414) | −5–15pp below plan |
| % with phone | 90–95% | **92%** (3,271) | ✅ on target |
| Unique cities | ~100+ | **683** | Far above plan — country-wide rural coverage |
| Apify cost | ~$24–32 | **~$34** (4,918 × $7/1k) | +6–10% above plan |
| Duration | 1.5–3 hours | **~1 hr wall time** (country-wide took 45 min; city grids parallel in 8–10 min each) | ✅ within plan |

**Email verification (MillionVerifier, 1,414 verified):**
- valid: 791 (56% of verified, 22% of all SK rows)
- risky: 288 (20%)
- catch_all: 290 (21%)
- invalid: 45 (3%)
- unknown: 0

**Datasets captured:**

| Dataset | Label | Items | Dataset ID |
|---------|-------|-------|-----------|
| Country-wide (5 terms) | SK country-wide | 1,754 | `DhsCuSPp6xzWYBB89` |
| Bratislava main grid | Bratislava | 502 | `mvtdigY7qUJTcqp5g` |
| Bratislava BA split | BA split | 502 | `xriLqmFjgLsWsE8xG` |
| Košice | Košice | 438 | `HTUI2BQafJepv9mvH` |
| Prešov | Prešov | 267 | `zw2f2M8N8tVUZzUCw` |
| Žilina | Žilina | 288 | `vUqokNm6xC4oulahE` |
| Nitra | Nitra | 247 | `ge7Uc7XfoJwouZ54E` |
| Banská Bystrica | Banská Bystrica | 215 | `vfvpllgJrAtHHEYkp` |
| Trnava | Trnava | 225 | `UbmVkLkGZIkhodVL5` |
| Martin | Martin | 117 | `n1IHpU3YPgtq6ET2W` |
| Trenčín | Trenčín | 171 | `ja20UFDq2myjbEe5m` |
| Poprad | Poprad | 192 | `5t1fHEBad0SSWeA1u` |

**Lessons for next country:**
- Country-wide pass with 5 terms + `scrapeContacts: true` took **45 min** — the dominant bottleneck. Plan for 40–60 min when using 5+ terms on a country-wide pass.
- Email rate came in 5–15pp below plan (40% vs 45–55%). SK shops have slightly less web presence than CZ; adjust expectations for smaller EU markets.
- Category filter caught **0 items** — Slovak Google Maps category names ("Automobilový servis", "Oprava a údržba automobilov") map cleanly to the include regex. No adjustments needed for subsequent SK-like markets.
- 683 unique cities (vs ~100+ planned) confirms the country-wide pass provides excellent rural/long-tail coverage — the extra city-grid runs primarily boost density in major urban areas, not total coverage.
- `autoopravovňa` (SK-specific formal term) must be in `INCLUDE_CATEGORY_REGEX` for correct filtering — it was added to `import-slovakia-shops.mjs` and is absent from the CZ script.
- Dedup removed 715 placeId dups + 625 secondary-key dups (26% reduction) — consistent with CZ (19% secondary dedup) when running overlapping city-grid + country-wide passes.

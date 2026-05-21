---
type: scrape-plan
country: Tanzania
country_code: TZ
status: draft  # draft → approved → in-progress → done
created: 2026-04-28
---

# Scrape Plan — Tanzania (TZ)

> Step 0 output of the `scrape` skill. Awaiting Jacob's approval before any Apify credit is spent. **Second non-EU country in the pipeline, and the first Sub-Saharan African market.** TZ diverges from every prior scrape (CZ/SK/LT/LV/EE/RS) in five compounding ways that shape execution: (1) **massive informal sector** — 60–75% of non-agricultural workforce is informal, so a much larger share of real workshops will be Facebook-only or have no online footprint at all; (2) **phone-first not email-first** market — expect **<10% email coverage** vs RS's already-low 14%, but **>90% phone coverage** holds; (3) **right-hand-drive Japanese-import mono-fleet** — Toyota alone is ~25% market share, and the entire aftermarket is built around used Japanese imports (47k/year, #1 in Africa) — implication: parts compatibility, ICP intensity, and shop specialization patterns are nothing like Eastern Europe; (4) **bilingual Swahili / English business naming** — most shops self-list with a mix of both, often "[Owner Name] Auto Garage" or "[X] Motors"; (5) **no commercial vehicle-inspection industry** — inspections are done by Tanzania Police Force / LATRA, not private operators, so the `tehnički pregled` analog used in RS doesn't exist as a separate ICP or category to filter.

## A — Country profile

- **Population:** ~67M (2025 est. — 2022 census recorded 61.74M, ~3% annual growth). 26 mainland regions + 5 Zanzibar regions.
- **GDP per capita:** **~$1,300 nominal (2025)** — the **lowest of any country we've scraped by an order of magnitude** (RS ~$12k, EE ~$30k, CZ ~$31k). World Bank classifies as lower-middle income. Implies extreme price-sensitivity, owner-operator dominance, and very low digital-spend per shop.
- **Registered passenger cars:** **No clean public figure.** Best triangulation: Dar es Salaam alone had ~1M registered vehicles in 2012 with ~50k/year growth since (per World Bank/Tanroads); CEIC reported 380k national in 2015 (low due to definition). Combining 47k/year used-Japanese imports for the past decade-plus + organic urban growth, **estimated total fleet 1.8–2.5M vehicles all classes** (vs 2.5M in RS at 6.6M pop — TZ has 10× the population at ~similar absolute fleet size, so motorization is **very low per capita**).
- **Registered light commercial vehicles:** ~250–400k (estimate; commercial fleet is dominated by minibuses (`daladala`), light trucks, and small Hilux-class pickups).
- **Cars per 1,000 people:** **~30–40** (rough — CZ ~607, RS ~375, the developing-world bracket starts here). Despite low motorization, **shop density per car is high** because virtually all vehicles are used Japanese imports requiring frequent labor-intensive maintenance.
- **EV share of new sales / EV share of stock:** **Negligible** (<0.1% of fleet). Dar es Salaam has a small handful of EV pilots (matatus, government fleets); not a commercial workshop niche. **Skip the EV search term entirely** — we wouldn't yield a single relevant shop.
- **Mandatory inspection regime:** **No standalone private operator industry.** Roadworthiness inspections are conducted by **Tanzania Police Force (TPF)** and licensed by **LATRA** (Land Transport Regulatory Authority, est. 2019 by Cap. 413). There's a **planned PPP project to outsource motor vehicle inspection to private operators** (visible on PPP Centre's pipeline as of 2024–2025), but it has not yet stood up a private inspection-station industry comparable to RS's `tehnički pregled` or DK's bilsyn. **Implication:** no inspection-station search term, no inspection-station category to either include or filter — much simpler category set than RS.
- **Import tax / fleet notes:**
  - **The fleet is overwhelmingly used-import.** New car sales 2,000–3,000/year nationally (negligible). Used Japanese imports: **47,000 in 2024** — Tanzania is the **#1 importer of used Japanese cars in Africa** (Kenya is #2 at 39k). Right-hand drive (Tanzania drives on the left, UK colonial heritage), making JDM imports plug-and-play.
  - Import-duty regime favors used imports under 8 years old; ad valorem excise + VAT on top. The 8-year cap means **fleet age is ~12–18 years average** (younger than RS's 17yr only because of the 8yr import cap on entry; many vehicles then stay on Tanzania roads for another 10–15 years).
  - **Implication:** ICP is rich. Independent workshops are the labor-intensive workhorse of a fleet that sees zero dealer service. Shops that can do Toyota, Nissan, Honda are indistinguishable from generalists.
- **Dominant brands / aftermarket chains:**
  - **Toyota: ~24–28% market share** (Q1 2025) — the single dominant brand.
  - **Nissan, Honda, Isuzu, Ford, Mitsubishi** — together with Toyota, Toyota+Nissan+Honda are >80% of the fleet.
  - **Authorized dealer service networks:** **Toyota Tanzania** (CFAO Mobility, Dar es Salaam HQ + branches), **AMC Motors** (Nissan distributor), **CMC Motors** (Tata, Suzuki, Mahindra commercial), **Yamaha Tanzania**.
  - **No franchised independent chains analogous to Bosch Car Service / Mekonomen / Inter Auto.** The aftermarket is **near-100% independent owner-operator shops** plus a thin layer of authorized-dealer service. This is closer to "first-generation aftermarket" than anything we've seen in EU/CIS markets — and means **chain-driven dedup leakage will be much smaller than CZ/SK** (where chains added ~19% dup load).
  - **TEMESA** (Tanzania Electrical Mechanical Electronics Services Agency) operates ~27 government-fleet karakana — not in ICP, but their listings may surface on Maps; should be filtered at import.
- **Other market quirks:**
  - **Bilingual market.** Swahili (Kiswahili) is the lingua franca of daily life; English is the second official language and dominates in business / Dar metro. **Shop names are heavily mixed:** "Karibu Auto Garage", "Mwanza Motors", "Kitogo Auto Garage", "Fundi Magari Centre". Both languages need to be in the search-term matrix.
  - **Massive informal economy.** Tanzania's informal sector is 31–52% of non-agricultural GDP and **60–75% of non-agricultural employment**. Many real workshops are not registered with BRELA or TRA, operate from a shed/yard, and have **Facebook as their only digital footprint** if any. Google Maps coverage will be **lower density** than the on-the-ground count suggests, especially outside Dar es Salaam.
  - **Phone-first market.** SMBs use **WhatsApp Business** as primary contact; emails are rare among informal/owner-operator shops. **Plan: target ~5–10% email coverage**, vs ~88–92% phone coverage. Domain coverage will be sparse — most listings will have phones and a Facebook URL but no website.
  - **Boda-boda economy.** Two-wheel motorcycle taxis are everywhere; motorcycle-only repair shops are a separate, large category that we'll exclude per our usual rule. They'll dilute Maps results if not filtered out.
  - **Zanzibar is a separate jurisdiction** but reachable by the same Apify `countryCode: "tz"` parameter. ~340k pop in Zanzibar Town + ~1.9M in the archipelago — small absolute volume, distinct dialect (Kiunguja Swahili). Include but don't run a dedicated city-grid; Stone Town will be picked up by country-wide.
  - **Geographic dispersal:** Tanzania is **larger than France** (945k km²). Outside Dar es Salaam metro, density drops fast. The country-wide query is unlikely to hit the 500-cap on any single term except in Dar; city-grids matter for capturing Mwanza / Arusha / Mbeya / Morogoro / Dodoma but the long tail will be **sparse**.
  - **Daladala / matatu specialists.** Minibus-conversion + commercial-vehicle repair is a meaningful niche (15-seater Toyota HiAce conversions are the backbone of public transport). Likely co-tagged as `Auto repair shop` + `Truck repair shop` — array-overlap rule keeps them, which is correct.

## B — Administrative geography

### Regions (31 — 26 mainland + 5 Zanzibar; selected by 2022 census population)

Tanzania's administrative layer below national is **mkoa** (region). Each region has 5–10 districts. We don't run city-grids by region — we run by city. The region table below is for ICP estimation and to flag where shop density is expected.

| Region | Population (2022) | Administrative center | Notes |
|---|---:|---|---|
| Dar es Salaam | 5,383,728 | Dar es Salaam | Mega-metro, 8.7% of national pop, est. 60% of national vehicle fleet |
| Mwanza | 3,699,872 | Mwanza | Lake Victoria port, second commercial center |
| Tabora | 3,391,679 | Tabora | Inland trade hub, lower per-capita workshop density |
| Morogoro | 3,197,104 | Morogoro | TAZARA railway corridor |
| Dodoma | 3,085,625 | Dodoma | Capital city, fast-growing govt district |
| Tanga | ~2.6M | Tanga | Coastal, port + cement industry |
| Mbeya | ~2.3M | Mbeya | Southern Highlands, Zambia border |
| Kagera | ~2.9M | Bukoba | Lake Victoria western shore |
| Kigoma | ~2.4M | Kigoma | Lake Tanganyika, sparser |
| Mara | ~2.4M | Musoma | Lake Victoria southeast |
| Arusha | ~2.0M | Arusha | Tourism hub, higher-end fleet |
| Kilimanjaro | ~1.9M | Moshi | Tourism + agriculture |
| Iringa, Ruvuma, Njombe, Singida, Shinyanga, Geita, Simiyu, Manyara, Pwani, Lindi, Mtwara, Katavi, Rukwa, Songwe (mainland balance) | varies | varies | Country-wide pass coverage |
| Zanzibar West, Zanzibar South, Zanzibar North, Pemba North, Pemba South | ~1.9M (Zanzibar total) | Zanzibar City (Mjini) | Archipelago, picked up by country-wide |

Estimated workshop ratio: **~1 per 700–1,000 people** in urban areas (higher than RS's 1:1,300, because per-vehicle labor intensity is much higher on a Japanese-import fleet); much sparser in rural districts. Dar es Salaam alone is likely the source of **>50% of all listings** the scrape will return.

### Top cities — city-grid targets

City-proper populations (2012 census, the most reliable city-level dataset; 2022 census published primarily at regional level). Apply ~1.4× growth to estimate 2025 numbers. **Dar es Salaam metro is so dominant it warrants a 4-way split** (one more than RS Belgrade) — likely capping at 500 on multiple terms.

| City | Pop (2012) | Pop (~2025 est) | Lat | Lng | Locality query | Expected shops |
|------|---:|---:|---:|---:|---|---:|
| Dar es Salaam | 4,364,541 | ~6,100,000 | -6.7924 | 39.2083 | `Dar es Salaam, Tanzania` | 1,400–2,200 |
| Mwanza | 706,543 | ~990,000 | -2.5164 | 32.9175 | `Mwanza, Tanzania` | 250–400 |
| Arusha | 416,442 | ~580,000 | -3.3869 | 36.6830 | `Arusha, Tanzania` | 200–320 *(tourism/expat fleet bump)* |
| Mbeya | 385,279 | ~540,000 | -8.9094 | 33.4607 | `Mbeya, Tanzania` | 130–200 |
| Morogoro | 315,866 | ~440,000 | -6.8278 | 37.6592 | `Morogoro, Tanzania` | 110–170 |
| Tanga | 273,332 | ~380,000 | -5.0689 | 39.0987 | `Tanga, Tanzania` | 90–140 |
| Kahama | 242,208 | ~340,000 | -3.8333 | 32.6000 | `Kahama, Tanzania` | 60–100 |
| Tabora | 226,999 | ~320,000 | -5.0167 | 32.8000 | `Tabora, Tanzania` | 70–110 |
| Zanzibar City (Stone Town) | 223,033 | ~310,000 | -6.1659 | 39.2026 | `Zanzibar City, Tanzania` | 70–110 *(distinct island sub-market)* |
| Kigoma | 215,458 | ~300,000 | -4.8772 | 29.6266 | `Kigoma, Tanzania` | 60–90 |
| Dodoma | 213,636 | ~700,000 | -6.1722 | 35.7395 | `Dodoma, Tanzania` | 200–320 *(capital, fastest-growing — population estimate is much higher than 2012 census)* |
| Sumbawanga | 209,793 | ~280,000 | -7.9667 | 31.6167 | `Sumbawanga, Tanzania` | 50–80 |
| Songea | 203,309 | ~280,000 | -10.6850 | 35.6500 | `Songea, Tanzania` | 50–80 |
| Moshi | 184,292 | ~260,000 | -3.3499 | 37.3370 | `Moshi, Tanzania` | 90–140 *(Kilimanjaro tourism + Toyota Tanzania regional dealer)* |
| Iringa | 151,345 | ~210,000 | -7.7700 | 35.6900 | `Iringa, Tanzania` | 50–80 |
| Mtwara | 108,299 | ~150,000 | -10.2667 | 40.1833 | `Mtwara, Tanzania` | 40–70 *(LNG/gas industry corridor)* |
| Bukoba | 128,796 | ~180,000 | -1.3333 | 31.8167 | `Bukoba, Tanzania` | 35–60 |
| Singida | 150,379 | ~210,000 | -4.8167 | 34.7500 | `Singida, Tanzania` | 35–60 |

**Total expected unique shops after dedup: ~2,800–4,500.**

**Locality query, not customGeolocation.** Per the **RS lessons-learned (the `customGeolocation` `radiusMeters:` field is silently ignored** — see RS plan + scrape skill master), every city-grid run uses `locationQuery: "<City>, Tanzania"` instead of `customGeolocation`. Simpler, well-supported, and matches actor docs.

## C — Search term matrix

Tanzania is **bilingual Swahili/English** in business naming. Both languages need to run. Swahili `garaji` + `karakana` + `fundi magari` are the dominant local terms; English `auto repair` + `garage` + `mechanic` catch the formal-sector + Dar metro shops; plus a few brand-anchored terms for the high-volume Toyota / Nissan share.

| Niche | Primary local term(s) | English fallback | Include? | Notes |
|-------|----------------------|------------------|----------|-------|
| General repair / mechanic | `garaji`, `karakana`, `fundi magari`, `mafundi wa magari` | `auto repair`, `car repair`, `mechanic`, `auto garage` | ✅ | `garaji` is a Swahili adoption of "garage", **the most common term** in Maps listings; `karakana` is the formal Swahili (also used by govt — TEMESA's "27 karakana" network); `fundi magari` = "car craftsman" / mechanic, used in informal-sector naming |
| Brand-specialist | (absorbed) | `Toyota service`, `Nissan service`, `Honda service` | ✅ | Run as separate country-wide terms — the Toyota/Nissan/Honda dominance (>80% market) means a meaningful number of shops self-name with the brand. Good ICP signal too. |
| Body shop / paint | `kupiga rangi`, `body shop`, `panel beater` | `auto body shop`, `auto paint shop`, `panel beater` | ✅ | **`panel beater`** is the British-colonial-era term still used in TZ/KE/UG; **higher yield than the Swahili equivalents**. `kupiga rangi gari` literally "to apply paint to car" — a phrase, not a fixed term, less productive on Maps |
| Tire shop | `puncture`, `gari ya matairi`, `tire shop` | `tire shop`, `tyre shop` (UK spelling more common) | ❌ | **Excluded this pass** per CZ/SK/RS precedent. Combined shops survive via array-overlap. **`puncture`** as a noun is heavily used colloquially for puncture-repair stalls — would surface a long tail of micro-businesses, but ICP is too thin |
| EV specialist | — | — | ❌ | **Skip** — EV stock <0.1%. Re-evaluate post-2030. |
| Inspection / MOT | — | — | ❌ | **Skip** — no commercial inspection-station industry exists in TZ. Inspections done by police + LATRA. |
| Truck / heavy / commercial | `lori`, `garaji ya malori` | `truck repair`, `lorry repair` | ⚠️ Soft include | **Important nuance:** the `daladala` minibus economy means many shops **co-handle** light passenger + 15-seater HiAce + small lorries. Don't run a dedicated truck term, but **don't exclude** truck-repair categories at filter time — array-overlap will keep co-tagged shops correctly. Pure-truck depots (TBL/Coca-Cola distribution fleets) will surface and should be excluded by category. |
| Motorcycle | `pikipiki`, `boda boda fundi` | `motorcycle repair` | ❌ | **Excluded**. Boda-boda repair is a massive separate category (TZ has millions of motorcycle taxis); not ICP. Filter aggressively. |
| Auto electrical | `auto electrical`, `umeme wa magari` | `auto electrician` | ⚠️ Soft include | Often a standalone specialty given fleet age + electronics-heavy modern Toyotas. Add as a country-wide term. |

**Country-wide search strings (single actor call):**
1. `garaji`
2. `karakana`
3. `fundi magari`
4. `auto repair Tanzania`
5. `panel beater`
6. `auto electrical`

**Brand-anchored country-wide search strings (separate run, lower priority — drop if budget tight):**
7. `Toyota service`
8. `Nissan service`

**City-grid search strings (per city in B, single term):**
1. `garaji`

**Dar es Salaam 4-way split grid:** four separate `locationQuery: "Dar es Salaam, Tanzania"` calls, each with one of `["garaji"]`, `["karakana"]`, `["auto repair"]`, `["panel beater"]` — quadruples effective cap from 500 → 2,000 in the metro.
**Mwanza / Arusha / Dodoma 2-way splits:** two `locationQuery` calls each with `["garaji"]`, `["auto repair"]`.
**Other 14 cities:** single `locationQuery` call with `searchStringsArray: ["garaji"]` — one search term per call, since outside the top 4 cities most queries will not approach the 500-cap.

## D — Include / exclude list

> **Array-overlap semantics.** Google Maps returns `categories[]`. A shop is **excluded only if every one of its categories is in the exclude list**. Filtering runs against `all_categories`, never `category`.

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
- Auto radiator repair service
- Auto air conditioning service
- Oil change service
- Truck repair shop *(soft include — co-tagged passenger+commercial shops are core ICP in TZ; pure-truck depots filtered by exclude overlap)*
- Auto restoration service

**Exclude categories (only excluded if *all* of a shop's categories are in this list):**
- Tire shop
- Motorcycle dealer
- Motorcycle repair shop *(boda-boda specialists)*
- Motor scooter dealer
- Auto parts store
- Gas station / Petrol station
- Car wash
- Car rental agency
- Car dealer
- Used car dealer *(Toyota/Nissan/Honda used-import lots are dense in Dar — exclude unless they have a service category overlap)*
- Vehicle wrapping service
- Driving school *(fleet-aging proxy — many "driving schools" in TZ are essentially used-car-rental + motorcycle-rental businesses)*
- Bus station
- Truck stop
- Car detailing service
- Spare parts store
- Service station

**Edge cases / judgment calls for TZ:**
- **TEMESA government karakana** — the 27 government repair shops will surface on Maps. They're real workshops but **not ICP** (govt fleet only, no commercial customers). Filter at import by `name ILIKE '%TEMESA%'` post-hoc.
- **Authorized dealer service centres** — Toyota Tanzania (CFAO Mobility), AMC Motors (Nissan), CMC Motors. These are **legitimate ICP at the high end** (formal-sector buyers, fleet contracts) but small in count (~10–20 listings nationally). Keep them; tag with `authorized_dealer = true` at import for ICP tiering.
- **"Auto garage" used-car lots** — overlap of used-car-sales + light service is common. Survive via overlap. Likely real ICP since these places do prep / pre-sale inspection work.
- **Boda-boda repair** — pure motorcycle shops will be excluded correctly via array-overlap. Watch for shops co-tagged `Auto repair shop` + `Motorcycle repair shop` — these are mixed-fleet workshops and should **survive**.
- **`Daladala` / minibus conversion shops** — co-tagged Auto+Truck+Auto body. Survive via overlap.
- **Zanzibar listings** — included by `countryCode: "tz"`. No filtering. Tag with `region = 'Zanzibar'` at import for downstream ICP segmentation.
- **Kosovo/disputed-territory analog: none.** TZ has no disputed-territory exclusion concern.
- **Informal / Facebook-only shops** — **the largest known gap.** These will not surface in Pass 1. Tracked as a **strong Pass 2 candidate** (Facebook Pages Scraper).

## E — Data source & tool selection

### Layers evaluated

| Layer | Source | Coverage for TZ | Free? | Apify actor? | Decision |
|-------|--------|-----------------|-------|--------------|----------|
| Registry (official) | **BRELA ORS** ([ors.brela.go.tz](https://ors.brela.go.tz/orsreg/searchbusinesspublic)) | All BRELA-registered legal entities. **Searchable by name only — no NACE-equivalent / category index** in the public interface. Free, no auth required. | Free (public search) | No off-the-shelf actor; would need form-based scraper that iterates name patterns | **Deferred** — without category index, custom scrape is expensive (millions of name combinations) and would surface non-ICP entities. Could be useful for a **VAT/TIN cross-reference** lookup post-Maps if we ever want to enrich with formal-business confirmation. |
| Registry (commercial) | **TIN registry (TRA)** | Tax-payer ID DB; not publicly searchable by category | Behind auth | No | **Skip** |
| Directory | **ZoomTanzania** ([zoomtanzania.net/directory](https://www.zoomtanzania.net/directory/)) | ~7,000–7,300 businesses across all categories; auto-repair sub-category exists | Free browse | Generic scraper would work | **Optional Pass 2 gap fill** — yield estimated 100–300 net-new shops vs Maps |
| Directory | **Yellow Tanzania** ([yellow.co.tz](https://www.yellow.co.tz/)) | Smaller than ZoomTanzania | Free browse | Generic | Low priority |
| Directory | **Tanzania Aura Directory**, **LocalBizNetwork**, **Africa Yellow Pages Online** | Smaller, older, often stale | Free browse | Generic | **Skip** |
| Google Maps | `compass/crawler-google-places` | **Best available source for TZ.** Coverage is good in Dar metro, weaker in mid-tier cities, sparse in rural districts | $7 / 1,000 places | ✅ Battle-tested across CZ/SK/LT/LV/EE/RS | **Primary source** |
| Facebook Pages | `apify/facebook-pages-scraper` | **Likely the highest-yield Pass 2 layer for TZ.** Informal-sector shops are 60–75% of non-ag employment; many run their entire customer-acquisition flow through FB Pages + WhatsApp. Risk: FB scraping quality varies, query-by-keyword/location is less precise than Maps | Paid (~$1–3 per 1k profiles) | Yes | **Strong Pass 2 candidate — defer this scrape** |
| Enrichment | **Prospeo `/domain-to-email`** | **Weak in TZ.** Most rows will not have a domain at all (informal sector + WhatsApp-as-primary). Of rows with a domain, Prospeo coverage is unmeasured for TZ | Paid, existing integration | Existing lib | **Run after primary** but expect low yield (~50–150 new emails on a 3,000-row import). Cost ~$5–15. |
| Enrichment | Vibe Prospecting | Weak in TZ | Paid, MCP connected | — | **Skip** |
| Email verification | **MillionVerifier** via `scripts/lib/email-verify.mjs` | — | Paid, existing pipeline | Existing lib | **Always run last** |

### Ranked source stack (final)

1. **Google Maps (primary)** — country-wide 6-term Swahili+English pass + 18 city-grid runs with Dar es Salaam 4-way / Mwanza+Arusha+Dodoma 2-way splits. Captures ~2,800–4,500 unique shops.
2. **(Optional, separate budget call) Brand-anchored country-wide pass** — `Toyota service`, `Nissan service` country-wide. Estimated +100–300 unique rows. Cost ~$3–5.
3. **Prospeo `/domain-to-email` enrichment** — on rows with `website` but no `primary_email`. Expect very low domain coverage in TZ (~10–20% of rows have a domain), so target volume is ~300–600 rows; expected new emails ~50–150.
4. **MillionVerifier** — verify every row with any email; write `email_status` + `email_verified_at`.
5. **(Deferred to Pass 2)** Facebook Pages scrape — for informal-sector / WhatsApp-only shops missing from Maps. **Highest-leverage Pass 2 layer for TZ.** Plan it after Pass 1 results come in so we can scope it on real data.
6. **(Deferred to Pass 2)** ZoomTanzania directory custom scrape — auto-repair category page → ~100–300 net-new rows.
7. **(Deferred indefinitely)** BRELA registry — only useful for VAT/TIN cross-reference if we ever build out a formal-business validation layer.

### Dedup keys (priority order)

1. `google_place_id` (primary — this pass is Maps-only)
2. Normalized phone (E.164, **+255** for TZ) — **elevated to #2 vs RS** because phone coverage is much higher than domain coverage in TZ (~92% phone vs ~15–20% domain), so phone is the better cross-source dedup key
3. Normalized domain (strip protocol, `www.`, trailing slash; lowercase) — sparse in TZ
4. Lowercased name + city combo (last-resort)

VAT (TIN) is not exposed by Google Maps. BRELA could add it in Pass 2 but only via expensive name-by-name lookup.

## F — Scrape execution plan

### Source run order

1. **Apify Google Maps — country-wide pass (6 terms, single actor call)**
   - Input: `countryCode: "tz"`, `searchStringsArray: ["garaji", "karakana", "fundi magari", "auto repair Tanzania", "panel beater", "auto electrical"]`, `maxCrawledPlacesPerSearch: 500`, `scrapeContacts: true`, `language: "en"` (TZ Maps listings overwhelmingly carry English-language category tags + Swahili names; `sw` locale fallback if yield is light), `includeOpeningHours: true`.
   - Expected: ~1,500–2,500 raw rows. Only `garaji` likely caps at 500; `karakana` ~300–400; brand/English terms ~150–300 each.
2. **Apify Google Maps — Dar es Salaam 4-way split (4 runs)**
   - 4 runs at `locationQuery: "Dar es Salaam, Tanzania"`, each with one of `["garaji"]`, `["karakana"]`, `["auto repair"]`, `["panel beater"]`.
   - Expected: ~1,500–2,200 raw rows combined. `garaji` and `auto repair` both likely cap at 500 in Dar.
3. **Apify Google Maps — Mwanza / Arusha / Dodoma 2-way splits (6 runs total)**
   - 3 cities × 2 terms (`garaji`, `auto repair`).
   - Expected: ~700–1,200 raw rows combined.
4. **Apify Google Maps — remaining 14 city-grid passes (single term each)**
   - 14 runs × 1 term (`garaji`). Cities: Mbeya, Morogoro, Tanga, Kahama, Tabora, Zanzibar City, Kigoma, Sumbawanga, Songea, Moshi, Iringa, Mtwara, Bukoba, Singida.
   - Expected: ~700–1,200 raw rows combined.
5. **(Optional) Brand-anchored country-wide pass** — single actor call, `searchStringsArray: ["Toyota service", "Nissan service"]`. Expected ~150–400 raw rows.
6. **Python dedup + normalization** in sandbox — apply dedup cascade from E, filter against include/exclude lists with array-overlap semantics. Filter `name ILIKE '%TEMESA%'` to drop government karakana. Emit direct-from-dataset reads (no local JSON file).
7. **Supabase import** — create `scripts/import-tanzania-shops.mjs` from the `import-serbia-shops.mjs` template. Update `INCLUDE_CATEGORY_REGEX` to cover TZ-specific tags. Upsert on `google_place_id`. Run against `discovered_shops` on project `wdgiwuhehqpkhpvdzzzl`.
8. **Prospeo `/domain-to-email` enrichment** — target rows with `website IS NOT NULL AND primary_email IS NULL AND country_code = 'TZ'`. Expected target volume ~300–600 rows.
9. **MillionVerifier** — `node scripts/verify-emails.mjs --country TZ --concurrency 80 --only-null`, chunked in `--limit 400` batches for bash timeout. Expected verifier volume ~100–250 emails (low coverage).

### Google Maps passes summary

- **Country-wide terms (500-cap each):** `garaji`, `karakana`, `fundi magari`, `auto repair Tanzania`, `panel beater`, `auto electrical` — **1 actor call, 6 terms.**
- **Dar es Salaam 4-way split:** **4 actor calls** (1 term each).
- **Mwanza / Arusha / Dodoma 2-way splits:** **6 actor calls** (3 cities × 2 terms).
- **Other 14 cities:** **14 actor calls** (1 term each).
- **(Optional) brand pass:** **1 actor call.**
- **Total: 25 actor calls (or 26 with optional brand pass).**

### Expected outcome

- Total raw rows (pre-dedup): **~5,000–7,500**
- Total unique rows after dedup: **~2,800–4,500**
- Apify credit cost estimate: **~$35–55** at $7 / 1,000 places
- Estimated duration: **1.5–3 hours** (25 runs launched in 3 parallel waves — country-wide + Dar splits, then mid-tier cities, then long tail; matches RS's 21-run pattern)
- Estimated **% with email: 5–12%** (lower than RS's 14% — TZ informal sector + WhatsApp-as-primary will drag this hard)
- Estimated **% with phone: 88–94%** (in line with all prior runs)
- Estimated unique cities: **400–700**

### Go / no-go summary

Recommend proceeding, with a **lower-yield expectation than RS** and a clear flag that TZ's most valuable pass-2 layer is Facebook, not a registry. The execution plan is a tested pattern (the Dar 4-way split is one step beyond RS Belgrade's 3-way; the rest is standard). Apify cost is in line with RS (~$35–55). Email coverage will be **the worst of any country we've scraped**, but **phone coverage will hold at >88%**, which matters because TZ outbound is **WhatsApp-led, not email-led** — phone is the primary contact channel for Tanzanian shop owners anyway. **Go.**

**Open flags for Jacob to confirm or redirect:**

1. **Search-language balance.** Default plan is **6 terms = 3 Swahili + 3 English** for the country-wide pass. If you want a Swahili-heavier mix (e.g. add `mafundi wa magari`, drop `auto electrical`) flag it. Default rationale: English captures Dar metro and authorized-dealer ICP; Swahili captures informal/upcountry shops; balanced split avoids missing either tail.
2. **Brand-anchored pass (Toyota/Nissan service).** Optional ~$3–5. Default: **include** — TZ's brand concentration (>80% Toyota+Nissan+Honda) means it's a higher-yield brand-search market than any prior country. If budget-tight, drop.
3. **Dar es Salaam 4-way split.** First time we're going beyond a 3-way. Risk: low — the RS Belgrade 3-way ran cleanly, this is the same pattern with one more call. Cost: one extra Apify run (~$3). Default: run the 4-way. If yield comes in light, we drop a future 4-way back to 3.
4. **Optional Pass-2 Facebook scrape.** **Strongly recommended as a follow-up**, given informal-sector dominance, but **not** in this Pass 1 scope. Plan to scope it after we see Pass 1's actual yield + how many shops have FB URLs but no Maps presence.
5. **TEMESA filter.** Plan filters government karakana out at import via name match. If you'd rather keep them tagged, flag it; trivial to change.
6. **Zanzibar — keep merged or split out?** Default plan keeps Zanzibar listings in `discovered_shops` with `region = 'Zanzibar'` tag. If you'd rather have Zanzibar in a separate Supabase view (different jurisdiction, different tax regime), flag it now.
7. **Email-coverage realism.** Plan targets 5–12% email. If this comes in below 5% — meaning <150 verified emails on a 3,000-row import — Pass 1 may not be cost-effective for outbound email; phone-led WhatsApp outreach would be the actual GTM channel. Worth gut-checking the GTM assumption before we burn $35–55 + MV credits.

---

## Actual results (fill in after scrape completes)

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Total rows |  |  |  |
| % with email |  |  |  |
| % with phone |  |  |  |
| Unique cities |  |  |  |
| Apify cost |  |  |  |
| Duration |  |  |  |

**Lessons for next country:**
-

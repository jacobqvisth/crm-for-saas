---
type: scrape-plan
country: Latvia
country_code: LV
status: draft  # draft → approved → in-progress → done
created: 2026-04-14
---

# Scrape Plan — Latvia (LV)

> Step 0 output of the `scrape` skill. Awaiting Jacob's approval before any Apify credit is spent.

## A — Country profile

- **Population:** 1,857,000 (Jan 2025, CSB); ~1.836M mid-2026 projection — Latvia is slowly shrinking via emigration + negative natural growth.
- **GDP per capita:** ~$22–24k (2025 est.); was $20k in 2023. Weakest of the three Baltics on a PPP basis.
- **Registered passenger cars:** ~760–800k (extrapolated: 693k in 2018 + ~8% growth 2019–2024 reported by LSM). No single authoritative 2026 figure — CSDD holds the register.
- **Registered light commercial vehicles:** ~100–110k (Eurostat 2024 N1 class).
- **Cars per 1,000 people:** ~415 — lower than EE (~600) and LT (~490). Meaningful for workshop density: fewer cars per capita = fewer shops per capita.
- **EV share of new sales / EV share of stock:**
  - BEV: **7.1%** of new passenger-car registrations in 2025 (1,602 of 22,506)
  - PHEV: **12.2%** (2,742)
  - Combined BEV+PHEV: **19.3%** (up from 11.8% in 2024 — fastest-growing segment is PHEV at +258% YoY)
  - EV stock remains small (<2% of total fleet) — majority of workshops still serve ICE-dominant fleet
- **Mandatory inspection regime:** **Tehniskā apskate** (TA), administered by **CSDD** (Ceļu Satiksmes Drošības Direkcija — the state road-safety directorate).
  - New cars: 2 years → 2 years → annual thereafter
  - Imported used cars: first TA within 5 days of LV registration, then annual
  - Heavy vehicles (>3.5t) and buses: annual from year 1
  - **Critical quirk:** TA stations are **state-owned and operated by CSDD**, not private workshops. This means inspection is out-of-scope for our scrape (no private inspection industry to sell into). We scrape only the workshops that do *pre-inspection prep*.
- **Import tax / fleet notes:**
  - No first-registration CO₂ tax like NO/SE — import duty is standard EU VAT (21%) + low annual road tax tied to engine size/weight/emissions
  - Result: fleet skews **old, heavy, and diesel** (per LSM Jan 2026 analysis). Average passenger car age is ~14 years — one of the oldest in the EU.
  - **Strong implication for ICP:** older diesel fleet = higher repair frequency + more independent-shop volume = very favorable shop density per capita once you correct for fewer cars.
- **Dominant brands / aftermarket chains:**
  - **Mekonomen / MECA** — present via MEKO Baltic acquisitions (smaller footprint than SE/FI but real)
  - **Bosch Car Service** — operated locally by **WESS Auto Group** (Riga-centric) and **LTD Lāde** (Liepāja, also Peugeot/Citroën/Opel dealer)
  - **Inter Cars** (Polish parts distributor) — cooperates with many independent shops but does not operate branded service stations
  - **AD Baltic** — regional parts wholesaler, similar cooperation pattern
  - Most shops are **small independents** — single owner, 2–5 bays. Very long tail.
- **Other market quirks:**
  - **Bilingual market:** Latvian is official, but Russian is a near-universal second language, especially in Riga, Daugavpils, Rēzekne, and Latgale broadly. Shop names, websites, and signage often appear in both. Search terms and enrichment should account for this.
  - Latgale region (Daugavpils, Rēzekne) is the poorest and most Russian-speaking — many shops there operate as Facebook pages only.
  - Smaller domestic aftermarket association than SE (MRF) or FI — no equivalent we should scrape as a dedicated ICP source.
  - Older fleet + colder climate → **winter tire swap twice a year is legally expected** → strong standalone tire-shop market (`riepu serviss` is a distinct category worth scraping independently of general repair).

## B — Administrative geography

### Planning regions (CSB 2025)

| Region | Population | Notable cities | Estimated shops |
|--------|-----------|----------------|-----------------|
| Rīga region | 847,162 | Rīga, Jūrmala, Ogre, Sigulda | ~600–800 |
| Kurzeme | 274,754 | Liepāja, Ventspils, Kuldīga, Talsi | ~180–230 |
| Vidzeme | 273,957 | Valmiera, Cēsis, Madona, Gulbene | ~150–200 |
| Latgale | 239,166 | Daugavpils, Rēzekne, Krāslava, Ludza | ~150–200 |
| Zemgale | 221,893 | Jelgava, Jēkabpils, Bauska, Dobele | ~140–190 |
| **Total** | **1,857k** | | **~1,200–1,600 unique** (after dedup, across all niches) |

Full estimate is calibrated against Lithuania (2.8M pop, ~2,000 shops scraped) and Estonia (1.37M, ~810 scraped) — Latvia should fall roughly between them, closer to LT given the older fleet + stronger tire-shop category.

### Top cities — city-grid targets

Only cities above ~45k warrant an individual grid pass to clear the 500-cap on country-wide queries. Everything smaller is absorbed by the country-wide queries.

| City | Population | Lat | Lng | Radius (m) | Expected shops |
|------|-----------|-----|-----|------------|----------------|
| Rīga | 612,980 | 56.9496 | 24.1052 | 20000 | 400–550 |
| Daugavpils | 82,046 | 55.8750 | 26.5356 | 10000 | 70–100 |
| Liepāja | 67,955 | 56.5047 | 21.0108 | 10000 | 55–75 |
| Jelgava | 60,129 | 56.6511 | 23.7214 | 10000 | 50–70 |
| Jūrmala | 51,000 | 56.9680 | 23.7703 | 12000 | 30–45 |
| Ventspils | 33,160 | 57.3894 | 21.5606 | 8000 | 25–40 |
| Rēzekne | 26,878 | 56.5097 | 27.3331 | 8000 | 25–40 |

Notes:
- Rīga gets a 20 km radius because the metro area extends well beyond city limits (Mārupe, Ķekava, Salaspils, Ādaži are all suburbs with many shops).
- Daugavpils is the second city and Russophone hub — likely high FB-only share, so the Google Maps pass will under-cover vs. the true count.

## C — Search term matrix

Primary language: Latvian. Russian parallels included for dense Russophone areas (mostly absorbed by country-wide queries already finding the shops under Latvian names).

| Niche | Primary local term(s) | English fallback | Include? | Notes |
|-------|----------------------|------------------|----------|-------|
| General repair / mechanic | `autoserviss`, `auto remonts` | `auto repair`, `car repair shop` | ✅ | `autoserviss` is the dominant term. Use both word forms. |
| Tire shop | `riepu serviss`, `riepu centrs` | `tire shop` | ❌ | **Excluded this pass** per Jacob — pure tire shops are not ICP. Shops that do both tires + general repair will still be caught by `autoserviss` queries. |
| Body shop / paint | `virsbūves remonts`, `auto virsbūve`, `krāsošana` | `auto body shop` | ✅ | Meaningful chunk — older fleet means lots of cosmetic repair. |
| Inspection / TA | `tehniskā apskate` | `vehicle inspection` | ❌ | **State-run by CSDD** — not an ICP. Exclude. |
| EV specialist | `elektroauto serviss` | `EV repair` | ⚠️ | Include term but expect near-zero results — EV stock too small in LV. |
| Brand / chain specialist | `Bosch Car Service`, `Mekonomen`, `MECA` | — | ✅ | Low volume but captures the known chains. |
| Truck / heavy / commercial | `kravas auto serviss`, `smagā tehnika` | `truck repair` | ❌ | **Skipped this pass** per Jacob. Revisit if LV truck market becomes ICP. |
| Motorcycle | `moto serviss` | `motorcycle repair` | ❌ | Not ICP. |
| Car wash | `automazgātava` | `car wash` | ❌ | Not ICP (though many autoservisi also wash — that's fine, they'll still match on autoserviss category). |
| Car dealer | `autotirgus`, `auto salons` | `car dealer` | ❌ | Not ICP. |

**Country-wide search strings (final list for Step 3):**
1. `autoserviss`
2. `auto remonts`
3. `virsbūves remonts`

**City-grid search strings (run for each city in B):**
1. `autoserviss`
2. `virsbūves remonts`

Brand/chain and EV terms are absorbed by the general `autoserviss` queries — no need for separate passes. Tire shops and truck repair are excluded from this pass.

## D — Include / exclude list

> **Array-overlap semantics.** Google Maps returns `categories[]` per place. A shop is **excluded only if every one of its categories is in the exclude list**. A shop tagged both `"ATV repair shop"` AND `"Auto repair shop"` survives any `"ATV repair shop"` exclusion. Filtering runs against `all_categories`, never `category`.

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
- Vehicle inspection service *(keep as a tag — some private shops offer pre-TA prep and Google may label them this way; CSDD-run official TA centers are excluded below by name/operator pattern, not category)*

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

Note: `Tire shop` and `Truck repair shop` are in the exclude list, but array-overlap rules still keep any shop that *also* has `Auto repair shop` or another include category — this is the intended behavior for combo shops.

**Edge cases / judgment calls for this country:**
- **State TA stations** — Google Maps often tags them as `"Vehicle inspection station"` under operator name "CSDD". Handle in Step 5 post-processing: drop any row where `name` contains `"CSDD"` OR website domain is `csdd.lv`. This is a name/domain filter, not a category filter.
- **Gas stations with workshops** — some Circle K / Neste / Virši stations have bolt-on service bays. These will have both `Gas station` AND `Auto repair shop` → array-overlap rule keeps them. That's correct — they're legitimate workshops.
- **Car dealers with in-house service** — e.g. Moller Auto, Wess Motors. Will have both `Car dealer` AND `Car repair and maintenance service`. Array-overlap keeps them. Flag with `dealer_service` tag during import for later ICP tiering — they are not pure independents.
- **Facebook-only shops** — meaningful chunk in Latgale (Daugavpils, Rēzekne). Google Maps *does* index many FB-only shops as places, so the primary scrape catches most. A dedicated FB scrape in a future pass could close the gap if ICP modeling justifies it.

## E — Data source & tool selection

### Layers evaluated

| Layer | Source | Coverage for this country | Free? | Apify actor available? | Decision |
|-------|--------|---------------------------|-------|------------------------|----------|
| Registry (official) | ur.gov.lv (UR — Uzņēmumu reģistrs) | All registered legal entities; NACE not universally populated; limited web-accessible search | Free, but structured bulk export is paid/limited | No off-the-shelf Apify actor | **Skip as primary** — access friction too high for this pass |
| Registry (commercial) | **Lursoft** (nace.lursoft.lv) | Near-complete coverage of LV companies with NACE codes; 45.20 list is directly browsable | Web reading free, bulk export paid | No public actor; would need custom scrape against `nace.lursoft.lv/45.20/companies` | **Consider as Layer 2** — custom scrape if time permits; otherwise defer |
| Registry (commercial, free) | firmas.lv | Good directory-style coverage, free to browse, domain-linked | Free | No dedicated actor | Useful for manual spot-checks, not primary |
| Google Maps | `compass/crawler-google-places` | Very good for shops with any digital presence; ~70–80% of real workshops likely indexed | $7 / 1,000 places | Yes | **Primary source** |
| Yellow pages | zl.lv, 1188.lv, kontakti.lv | Decent coverage of older shops; overlaps heavily with Google Maps | Free | Generic website scraper (Apify `apify/web-scraper` with custom config) | **Optional gap fill** — only if Google Maps coverage feels thin post-run |
| Facebook Pages | FB business scraper | High value in Latgale / Russophone east | Various | Yes (`apify/facebook-pages-scraper`) | **Defer to Pass 2** — don't add to first run; evaluate coverage gap first |
| Enrichment | Prospeo | Moderate LV coverage (weaker than Nordics) | Paid | Direct API (already integrated) | **Run after primary** for shops with domain but no email |
| Enrichment | Vibe Prospecting | Weak in Baltics for owner-decision-maker layer | Paid | MCP already connected | **Skip for LV first pass** |
| Email verification | MX check | — | Free | Existing pipeline | **Always run last** |

### Ranked source stack (final)

1. **Google Maps (primary)** — country-wide + 7-city grid, 5 Latvian-language search strings country-wide, 3 strings per city. Captures name, phone, website, emails, socials, categories, rating, hours, coordinates.
2. **Prospeo enrichment (gap fill, domain → email)** — run against shops with `website` but no `primary_email`.
3. **MX email verification (cleanup)** — write `email_valid` + `email_check_detail` to `discovered_shops`.

Not in this pass (deferred): Lursoft custom scrape, Facebook Pages scrape. Add only if Google Maps coverage in Latgale turns out to be weak.

### Dedup keys (priority order)

1. `google_place_id` (primary — this is the only pass source)
2. Normalized domain (strip protocol, www., trailing slash; lowercase)
3. Normalized phone (E.164, +371 for LV mobile/landline)
4. Lowercased name + city combo (last-resort, for shops missing domain + phone)

VAT / registration number is unavailable from Google Maps, so no cross-registry merge possible in this pass.

## F — Scrape execution plan

### Source run order

1. **Apify Google Maps (country-wide pass)** — one actor run, `countryCode: "lv"`, `searchStringsArray` = the 5 Latvian terms in C, `maxCrawledPlacesPerSearch: 500`, `scrapeContacts: true`. Expected ~1,500–2,000 raw rows.
2. **Apify Google Maps (city-grid passes)** — one actor run per city (7 runs) using `customGeolocation` for each (lat/lng + radius from B), `searchStringsArray` = the 3 city-grid terms. Expected ~1,500–2,500 additional raw rows with heavy overlap against pass 1.
3. **Python dedup + normalization in sandbox** — by dedup keys in E; write `scripts/lv-shops-data.json`.
4. **Supabase import** — `scripts/import-latvia-shops.mjs` (copy of the Estonia script, edited for the LV filename).
5. **Prospeo enrichment** — on rows with `website` but missing `primary_email`.
6. **MX verification** — on all rows with any email.

### Google Maps passes

- **Country-wide terms (500-cap each):** `autoserviss`, `auto remonts`, `virsbūves remonts`
- **City-grid terms (run per city in B):** `autoserviss`, `virsbūves remonts`

### Expected outcome

- Total raw rows (pre-dedup): ~2,000–3,000
- Total unique rows after dedup: **~900–1,200**
- Apify credit cost estimate: **~$14–21** at $7 / 1,000 places
- Estimated duration: **60–110 minutes**
- Estimated % with email: **40–55%** (Baltic baseline; EE hit ~50%, LT ~55%)
- Estimated % with phone: **90–95%**

### Go / no-go summary

Recommend proceeding as planned. Tire shops and truck repair are out of scope for this pass per Jacob. The plumbing (multi-category filtering, `all_categories` column, array-overlap in the importer) is already in place from PR #41 — this will be the **first country scrape that exercises the multi-category pipeline end-to-end**. Source stack is intentionally lean: Google Maps + Prospeo + MX. Deferring Lursoft and Facebook scrapes keeps the first pass simple and gives us a baseline to judge coverage gaps against. If Daugavpils / Rēzekne coverage feels thin after import, we add FB Pages in a follow-up pass.

---

## Actual results (fill in after scrape completes)

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Total rows | ~900–1,200 | 973 unique (1,036 raw, 61 dup, 2 no placeId, 0 CSDD) | on-target low end |
| % with email | 40–55% | 35% (340/973) | -5–20pp (lower than EE/LT baseline) |
| % with phone | 90–95% | 94% (916/973) | on-target |
| Unique cities | ~60–100 | 46 | under (regional passes yielded near-zero) |
| Apify cost | ~$21–32 | ~$10 initial + $10 top-up used | on the low end |
| Duration | 90–150 min | ~2 sessions (first hit plan cap, resumed after top-up) | within range |

**Lessons for next country:**
- Regional `locationQuery: "<region>, Latvia"` passes returned near-zero results (Vidzeme 0, Zemgale 0, Kurzeme 1, Latgale 18). Google Maps doesn't treat admin regions as meaningful bounding geographies. **Next country: skip regional residual passes** — stick to city-grid `customGeolocation` passes over the top ~6–8 population centers + capital split by search term.
- Rīga split by search term (`autoserviss` + `virsbuves`) was effective: 498 + 136 unique after dedup = 634 unique in Rīga alone.
- Plan cap blew mid-run once; $10 top-up was enough to finish. Budget a single $20–25 topup for any mid-sized country.
- CSDD filter hit 0 rows — Google Maps wasn't returning CSDD inspection stations under auto-repair queries. Keep the filter anyway; cheap insurance.

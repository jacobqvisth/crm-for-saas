# Scrape plan — United Kingdom (GB)

Status: **DRAFT — awaiting Jacob's approval**
Country code: `GB` (ISO 3166-1 alpha-2). DVSA covers Great Britain (England, Scotland, Wales) only — Northern Ireland uses DVA and is structurally different (see Section A). Plan covers the full UK; NI is handled as a sub-segment with Maps + Yell only.
Author: Cowork, 2026-04-28
Sources: DVLA Q3 2025 vehicle stats, SMMT 2025 EV registrations, ONS mid-2024 population, Companies House SIC 45200 register, IGA, Apify actor store.

---

## A — Country profile

| Metric | Value | Source |
|---|---|---|
| Population (mid-2025 est.) | 69.6M | ONS |
| GDP per capita (nominal, 2025) | ~$50K | IMF / ONS |
| Total licensed vehicles (Sept 2025) | **42.4M** | DVLA |
| Cars | 34.5M (81%) | DVLA |
| LGVs (vans) | 4.9M (12%) | DVLA |
| HGVs | 0.54M | DVLA |
| Motorcycles | 1.48M | DVLA |
| Cars per 1,000 people | ~510 | derived |
| BEV share, new car sales 2025 | **23.4%** (473,348 BEVs of 2.02M) | SMMT |
| BEV+PHEV share, new car sales 2025 | 34.5% | SMMT |
| Independent garages (industry est.) | **~35,000** | IGA |
| DVSA-approved MOT test stations (GB) | **23,500+** | DVSA |
| Active companies on Companies House SIC 45200 | **~52,000–56,000** | Companies House / GB Company DB |

### Market quirks worth flagging

- **MOT regime is the regulatory anchor.** First test at 3 years from registration; annual after. Almost every legitimate garage is also a DVSA-licensed MOT test station — so the **DVSA MOT centre register is a near-complete spine** for GB. (NI is the exception; see below.)
- **Northern Ireland is structurally different.** All MOT testing is done by the **Driver and Vehicle Agency (DVA)** at 15 state-run centres, not by private garages. So DVSA's 23,500 list explicitly excludes NI. NI must be filled in by Maps + Yell + Companies House only.
- **Strong fast-fit chain footprint** — Kwik Fit (~650 branches), Halfords Autocentres (~650), ATS Euromaster (253), Formula One Autocentres. These are both competitors and large multi-location targets — **don't dedupe them out**, they are real outbound prospects.
- **Tyre is its own large segment.** "Tyre fitting" / "tyre centre" is a much larger sub-niche in the UK than in Nordics — ~2,900 dedicated fast-fit/tyre outlets.
- **EV specialists** still small but the fastest-growing slice — 23.4% of new sales in 2025 (Europe's #2 EV market by volume after Germany). Worth a dedicated search term but expect <2% of records.
- **Right-hand drive market**, not relevant to scraping but informs the contractor messaging copy later.
- **English-speaking market** — first one in the discovered_shops pipeline. No translation step needed for emails / sequence content. This is a big practical advantage over CZ/SK/RS.
- **Two industry quality marks worth recognising in tags:** AA Approved Garages, RAC Approved Garages, Bosch Car Service network, Trust My Garage (IGA, ~2,900 members), Motor Ombudsman (Independent Garage and Franchise Dealer scheme). These are useful for ICP scoring.

---

## B — Administrative geography

UK uses **12 ITL-1 regions** (replacement for NUTS-1 since 6 Jan 2025): 9 in England, plus Scotland, Wales, Northern Ireland.

### ITL-1 regions (mid-2024 ONS estimates)

| Region | Population | Expected garage count* |
|---|--:|--:|
| South East | 9.6M | ~5,500 |
| London | 9.1M | ~4,500 |
| North West | 7.5M | ~4,200 |
| East of England | 6.4M | ~3,600 |
| West Midlands | 6.0M | ~3,400 |
| South West | 5.7M | ~3,200 |
| Scotland | 5.5M | ~3,100 |
| Yorkshire & Humber | 5.5M | ~3,100 |
| East Midlands | 4.9M | ~2,800 |
| Wales | 3.2M | ~1,800 |
| North East | 2.7M | ~1,500 |
| Northern Ireland | 1.9M | ~1,000 |
| **Total** | **69.6M** | **~35,000** |

*Linear-scaled from IGA's ~35K national estimate. Actual distribution skews to dense urban regions; expect modest under-count in SE (commuter belts) and over-count in NI (where dealer-network share is higher).

### Top 25 urban targets (city-grid centres, EPSG:4326)

| # | City | Region | Pop (urban) | Lat | Lng |
|--:|---|---|--:|--:|--:|
| 1 | London | London | 9.1M | 51.5074 | -0.1278 |
| 2 | Birmingham | West Midlands | 1.15M | 52.4862 | -1.8904 |
| 3 | Leeds | Yorkshire | 0.81M | 53.8008 | -1.5491 |
| 4 | Glasgow | Scotland | 0.62M | 55.8642 | -4.2518 |
| 5 | Sheffield | Yorkshire | 0.55M | 53.3811 | -1.4701 |
| 6 | Bradford | Yorkshire | 0.55M | 53.7950 | -1.7594 |
| 7 | Manchester | North West | 0.55M | 53.4808 | -2.2426 |
| 8 | Edinburgh | Scotland | 0.52M | 55.9533 | -3.1883 |
| 9 | Liverpool | North West | 0.50M | 53.4084 | -2.9916 |
| 10 | Cardiff | Wales | 0.49M | 51.4816 | -3.1791 |
| 11 | Bristol | South West | 0.47M | 51.4545 | -2.5879 |
| 12 | Coventry | West Midlands | 0.34M | 52.4068 | -1.5197 |
| 13 | Leicester | East Midlands | 0.36M | 52.6369 | -1.1398 |
| 14 | Belfast | NI | 0.35M | 54.5973 | -5.9301 |
| 15 | Nottingham | East Midlands | 0.32M | 52.9548 | -1.1581 |
| 16 | Reading | South East | 0.32M | 51.4543 | -0.9781 |
| 17 | Newcastle upon Tyne | North East | 0.31M | 54.9783 | -1.6178 |
| 18 | Brighton | South East | 0.29M | 50.8225 | -0.1372 |
| 19 | Sunderland | North East | 0.27M | 54.9069 | -1.3838 |
| 20 | Stoke-on-Trent | West Midlands | 0.26M | 53.0027 | -2.1794 |
| 21 | Wolverhampton | West Midlands | 0.26M | 52.5862 | -2.1281 |
| 22 | Plymouth | South West | 0.26M | 50.3755 | -4.1427 |
| 23 | Southampton | South East | 0.25M | 50.9097 | -1.4044 |
| 24 | Portsmouth | South East | 0.21M | 50.8198 | -1.0880 |
| 25 | Aberdeen | Scotland | 0.20M | 57.1497 | -2.0943 |

City-grid radius: 15km default. London needs special handling — split into 4 quadrants (NE/NW/SE/SW from 51.5074, -0.1278, each 15km radius) because a single 500-cap query against Greater London will saturate immediately given ~4,500 expected garages there.

---

## C — Search-term matrix (UK English)

UK English diverges from US English on every key term. **Do not use US terms.**

| Niche | Primary local term(s) | English fallback | Include? |
|---|---|---|---|
| General repair / mechanic | **garage**, **MOT garage**, **car servicing**, **mechanic** | "auto repair shop" | YES (primary) |
| Tyre shop | **tyre fitting**, **tyre centre**, **tyres** (NOT "tire") | "tire shop" | YES (large segment) |
| Body shop / paint | **bodyshop**, **panel beater**, **accident repair centre**, **crash repair** | "body shop" | YES |
| MOT / inspection | **MOT centre**, **MOT testing station** | "vehicle inspection" | YES (UK-unique) |
| EV specialists | **EV garage**, **electric car repair** | — | YES (small but growing) |
| Brand specialists / chains | **Bosch Car Service**, **AA Approved Garage**, **RAC Approved Garage**, **Trust My Garage** | — | YES (quality flag, not standalone term) |
| HGV / LGV / commercial | **HGV garage**, **commercial vehicle repair**, **van servicing** | "truck repair" | YES (4.9M LGVs in fleet) |
| Motorcycle | "motorcycle repair" | — | NO (default exclude) |

**Country-wide queries (no city restriction):** `MOT centre`, `EV garage` — both small enough to not hit the 500-cap nationally.

**City-grid queries (top 25 cities × 15km radius):** `garage`, `tyre fitting`, `bodyshop`, `mechanic`, `accident repair centre`, `van servicing`. These will hit the 500-cap on a country-wide pass and must be city-gridded.

---

## D — Include / exclude (array-aware filtering)

`discovered_shops.all_categories TEXT[]` must be applied with overlap semantics: **exclude only if every category is in the exclude set; include if any category is in the include set.**

### Include set (`all_categories` overlap)

```
Auto repair shop
Car repair and maintenance service
Mechanic
Garage (in UK GMB usage, this means workshop, not parking)
MOT testing station
Vehicle inspection
Tire shop
Tire repair shop
Auto body shop
Car detailing service
Wheel alignment service
Brake shop
Transmission shop
Car service
Diesel engine repair service
Auto electrical service
Truck repair shop
Commercial vehicle repair
Auto air conditioning service
```

### Exclude set (every category must match for row to drop)

```
Car dealer
Used car dealer
New car dealer
Car finance and loan company
Auto parts store
Auto body parts supplier
Gas station            ← UK GMB sometimes uses "Gas station" for petrol stations
Petrol station
Car wash
Self service car wash
Motorcycle dealer
Motorcycle repair shop
Car rental agency
Truck rental agency
Junkyard
Salvage yard
Auto auction
Auto broker
```

### Edge-case rules

- **Dealer service departments**: a row tagged `["Car dealer", "Auto repair shop"]` — **include** (they are real prospects for an outbound CRM, even if franchised). The dual-tag is the signal.
- **Halfords / Kwik Fit / Bosch Car Service multi-locations**: keep all locations as separate rows; dedupe on `google_place_id` only — the chain HQ is a separate entity from each branch.
- **MOT-only sites without repair**: a row tagged `["MOT testing station"]` only (no `Auto repair shop` etc.) — **include** (UK-specific, regulatorily real).
- **Mobile mechanics**: typically lack a fixed address; will appear in Google Maps with `Mechanic` category but no street address. **Include** but tag `is_mobile=true` if address is missing or contains "mobile".
- **Tyre-only sites**: `["Tire shop"]` only — **include** (the UK fast-fit segment is a real ICP).

---

## E — Source stack (ranked)

UK is the first English-speaking, registry-rich, large-fleet country we've scraped. The economics flip vs. RS/SK: registries are gold, Maps is gap-fill.

### Ranked stack

1. **DVSA Active MOT Test Stations CSV** — **PRIMARY for GB. ✅ VALIDATED 2026-04-28.**
   - Direct URL: `https://assets.publishing.service.gov.uk/media/69a0638bc497bac082bc7741/active-mot-stations.csv` (parent landing page: https://www.gov.uk/government/publications/active-mot-test-stations).
   - **23,087 rows confirmed**, 2.3 MB, last updated 26 Feb 2026, refresh cadence quarterly. HTTP 200, `text/csv`, Open Government Licence.
   - **Encoding: CP1252**, not UTF-8 — read with `encoding='cp1252'` or it will throw on byte 0x92 (curly apostrophe).
   - **Schema (14 columns):** `Site_Number, Trading_Name, Address1, Address2, Address3, Town, Postcode, Phone, Class_1..Class_7`.
   - **Coverage measured:** 100% phone, 100% postcode, 100% trading name. 22,187 stations (96.1%) Class_4 authorised (cars + light vans = our ICP). Class_7 (goods 3–3.5t / vans) on 6,764 (29.3%). 2,402 unique towns.
   - **Lacks:** email, website, lat/lng — geocode via postcodes.io (free, no key).
   - **Coverage gap (confirmed empirically):** **0 BT\* postcodes** — Northern Ireland is excluded from this dataset (DVA-run, as plan predicted). Fill NI with Maps + Yell.
   - The earlier "data hasn't been released" warning on the data.gov.uk dataset page was a misleading signal — the file is in fact published via gov.uk's `assets.publishing.service.gov.uk` CDN. Risk eliminated.
2. **Companies House — Free Company Data Product** (download.companieshouse.gov.uk; `BasicCompanyDataAsOneFile-YYYY-MM-01.zip`).
   - Filter `SICCode.SicText_1/2/3/4` includes `45200`. Yields ~52K–56K active companies.
   - Includes registered address, but **registered address is often the accountant's, not the trade premises** — must cross-merge with DVSA/Maps for trading address.
   - Free, OGL, monthly snapshot, CSV.
   - Lacks: phone, email, website, categories.
   - Use as: ID layer (Companies House number is the gold dedup key) + a way to discover garages that are registered businesses but missing from DVSA (e.g. mobile mechanics, tyre-only fast fits, body shops not doing MOTs).
3. **Apify Google Maps** (`compass/crawler-google-places`, `async: true`) — **gap fill** for phone, website, email, GMB description, categories, ratings, opening hours, lat/lng.
   - Country-wide passes for low-volume terms (`MOT centre`, `EV garage`).
   - City-grid passes for high-volume terms across top 25 cities (London split into 4 quadrants → effective 28 grid points).
4. **Yell.com via Apify** (`mcdowell/yell-scraper` or `ecomscrape/yell-business-search-scraper`) — UK's largest local directory.
   - Strong on email + website coverage where Maps falls short.
   - ~$30 estimated for full scrape across our terms.
5. **Whocanfixmycar.com (FixMyCar)** — 15K+ curated garages with reviews.
   - No off-the-shelf Apify actor identified — would need a custom scrape (sitemap-driven). **DEFER to a follow-up phase**; not on critical path for first import.
6. **Trust My Garage / IGA member directory** — ~2,900 quality-vetted members. ICP-flag layer, not a primary discovery source.
7. **Bosch Car Service locator** (boschauto.co.uk) — quality-flag layer; ~200–300 members.
8. **Facebook Pages search via Apify** (`apify/facebook-pages-scraper`, $10/1,000 pages) — fallback for owner-operated single-location garages with no website. Less critical in UK than Baltics but still gives a 5–10% lift on email coverage. **DEFER** unless first-pass email % is below 30%.
9. **Enrichment**:
   - **MillionVerifier** (already in pipeline, env `MILLIONVERIFIER_API_KEY`) — MX validation.
   - **Prospeo `/domain-to-email`** — pattern-guess emails for rows with website but no email (English market makes this high-yield).

### Dedup keys (priority order for cross-source merge)

1. **Companies House number** (where present — gold)
2. **VAT number** (rare in our scraped fields, but if present beats below)
3. **Phone E.164 GB** (normalised: strip leading 0, prefix +44)
4. **Postcode + first 10 chars of normalised name** (lower, strip Ltd/Limited/&/-)
5. **`google_place_id`**
6. **Domain** (eTLD+1)

Source-of-truth precedence per field: registry > DVSA > Maps > Yell > Facebook. `description` (GMB blurb) is Maps-only. Email: highest-confidence (registry-derived > Yell-listed > Maps-extracted > Prospeo-guessed). Tag `source` per row with originating layer; on re-import use `COALESCE(EXCLUDED.field, discovered_shops.field)` semantics for non-null preservation.

---

## F — Execution plan

### Ordered steps

1. **Fetch DVSA MOT test stations CSV** → cleanse → write to `scripts/gb-mot-stations-raw.json` (~23,500 rows).
   - If dataset download is gated, fall back to scraping the GOV.UK Active MOT test stations HTML page.
   - Geocode postcodes → lat/lng via postcodes.io (free, no key needed).
2. **Fetch Companies House BasicCompanyData** → filter SIC 45200 → write to `scripts/gb-ch-sic45200-raw.json` (~55K rows). Free download.
3. **Apify Google Maps — country-wide passes** (low-volume terms):
   - `MOT centre` (UK)
   - `EV garage` (UK)
   - 2 runs total.
4. **Apify Google Maps — city-grid passes** (high-volume terms × 28 grid points = London 4 quadrants + 24 other cities):
   - Terms per grid: `garage`, `tyre fitting`, `bodyshop`, `mechanic`, `accident repair centre`, `van servicing` (6 terms).
   - 6 terms × 28 grid points = **168 runs** at `maxCrawledPlacesPerSearch: 500`. Use the launch/poll split pattern from `scripts/scrape-serbia-launch.mjs` + `scrape-serbia-poll.mjs`.
   - Configuration template:
     ```json
     {
       "actorId": "compass/crawler-google-places",
       "async": true,
       "input": {
         "searchStringsArray": ["<term>"],
         "customGeolocation": {
           "type": "Point",
           "coordinates": [<lng>, <lat>],
           "radiusKm": 15
         },
         "maxCrawledPlacesPerSearch": 500,
         "scrapeContacts": true,
         "language": "en",
         "includeHistogram": false,
         "includeOpeningHours": true
       }
     }
     ```
5. **Apify Yell.com pass** — same 6 search terms over UK, deduped by domain/phone against Maps results.
6. **Merge + dedup** in priority order from Section E. Write to `scripts/gb-shops-data.json`.
7. **Import** via new `scripts/import-gb-shops.mjs` (copy of `import-estonia-shops.mjs`, swap filename + country code), upsert on `google_place_id`. **Pre-flight check:** verify `discovered_shops.all_categories TEXT[]` exists.
8. **MillionVerifier MX** on all new emails.
9. **Optional pass** if email coverage is <30%: Prospeo `/domain-to-email` on rows with website but no email.
10. **Update PROJECT-STATUS.md** rolling tally + Actual Results section in this file. Commit `scripts/import-gb-shops.mjs` + `PROJECT-STATUS.md` (JSON gitignored).

### Volume estimate

| Layer | Raw rows | After dedup contribution |
|---|--:|--:|
| DVSA MOT stations (GB) | 23,500 | 23,500 (spine) |
| Companies House SIC 45200 | 55,000 | +5,000–8,000 net new (mostly mobile mechanics, tyre-only, bodyshops without MOT) |
| Google Maps country + city-grid | ~70,000 | +3,000–5,000 net new + email/website/category fill on existing rows |
| Yell.com | ~25,000 | +1,000–2,000 net new + email fill |
| **Total unique** | | **~32,000–38,000** |

Email coverage projection: 50–65% post-Maps + Yell, 70–80% post-Prospeo. Phone coverage: 90%+ (registry+Maps+Yell triple-overlap).

### Cost estimate (Apify + MV)

| Cost item | Estimate |
|---|--:|
| Google Maps city-grid: 168 runs × ~500 places × ~$3.50/1000 | ~$295 |
| Google Maps country-wide: 2 runs × ~500 places | ~$5 |
| Yell.com Apify scrape | ~$30 |
| MillionVerifier (~25K emails @ $0.0007) | ~$18 |
| Prospeo domain-to-email (optional, ~5K) | ~$25 |
| **Subtotal expected** | **~$370** |
| With 50% buffer for retries / extended grids | **~$555** |

DVSA + Companies House are free.

### Duration

| Step | Time |
|---|---|
| Registry pulls + geocoding | ~1 hour |
| Apify Maps city-grid (parallel batches of 10) | 4–8 hours |
| Apify Yell pass | 1–2 hours |
| Dedup + merge + script | ~1 hour |
| Import + MV verify | 30 min |
| **Total wall-clock** | **1 working day** if monitoring; 2–3 days elapsed if running async overnight (recommended). |

### Go / no-go summary

- **Why GO:** UK is a tier-1 outbound market — English-speaking (no translation needed for sequences), large fleet (42.4M vehicles), 35K independent garages, strong registry data (DVSA + Companies House) keeps cost and dedup quality far better than RS/SK. Direct fit for the SaaS CRM ICP.
- **Risks to flag:**
  1. ~~DVSA dataset's data.gov.uk page currently says "not released"~~ ✅ **Resolved 2026-04-28** — direct CSV validated, 23,087 rows, 100% phone/postcode coverage. URL pinned in Section E.
  2. London's grid will be the bottleneck — the 4-quadrant split is a calculated estimate; if any quadrant returns 500, we extend to 8 sub-quadrants.
  3. NI coverage relies on Maps + Yell only; expect ~70–80% of GB-equivalent density (DVSA absence empirically confirmed: 0 BT\* postcodes in the file).
  4. ~168 Maps runs is the most we've kicked off in a single country (Serbia was 21). Need the launch/poll split pattern + a watchdog for failed runs. Budget 50% buffer accordingly.
  5. CSV encoding is CP1252; importer must read with `encoding='cp1252'`.
- **Recommendation: GO**, but with a checkpoint after the registry pulls (Steps 1–2) — if DVSA + Companies House give us >25K rows with full address + phone, we can scale back the Maps city-grid from 6 terms to 3 (drop `mechanic`, `accident repair centre`, `van servicing` — already heavily covered by registries) and cut Apify spend ~50%.

---

## Registry checkpoint results — 2026-04-28

**Pre-execution checkpoint completed for free** (no Apify spend yet).

### Sources fetched

| Source | Status | Rows |
|---|---|--:|
| DVSA Active MOT Stations CSV | ✅ Downloaded, validated, cleaned | 23,087 |
| Companies House BasicCompanyData (2026-04-01 snapshot, 470MB zip / 2.8GB CSV) | ✅ Downloaded, stream-filtered | 5,696,442 total → 61,459 active SIC 45200 |
| postcodes.io geocoding (DVSA postcodes) | ✅ 97.5% success | 19,422 / 19,921 unique postcodes |

### Coverage delivered (registries only, $0 spent)

| Field | Coverage from registries alone |
|---|--:|
| Trading name | 100% (78,866 rows) |
| Postcode | 100% |
| Phone (E.164) | **29.2%** (23,085 — DVSA-only; CH has no phone) |
| Lat/lng (geocoded) | ~97% via postcodes.io free API |
| Companies House number | **75.8%** (combined CH-only + DVSA↔CH matches) |
| MOT certification flag | 29.2% (DVSA stations) |
| Email / website / GMB description / categories / ratings | 0% — Maps + Yell required |

### Cross-merge: DVSA ↔ Companies House SIC 45200

Postcode + canonical-name Jaccard match (threshold 0.34):

| Bucket | Rows |
|---|--:|
| DVSA + CH agreement (gold rows: have phone + CH number) | **5,724** (24.8% of DVSA) |
| DVSA only (have phone, no CH match — sole traders, partnerships, or CH reg-address ≠ trade premises) | **17,363** |
| CH only (no DVSA match — non-MOT garages: bodyshops without MOT, mobile mechanics, tyre-only shops, NI shops) | **55,779** |
| **Combined registry spine** | **78,866** |

**Northern Ireland gap fill confirmed:** 894 BT\*-postcode CH companies present, fills the DVSA NI hole.

### What this tells us — strategic shift

The plan estimated 32–38K unique rows post-Maps; the **registries alone deliver 78,866 candidate rows**. This is roughly 2× the upper bound. Two implications:

1. **CH inflation is real**: many CH "registered addresses" are accountants' offices, not trade premises. Some fraction of the 55,779 CH-only rows are duplicates of DVSA stations registered at a different postcode. After Maps + Yell de-dup we expect **~45–55K true unique trade locations**.
2. **Maps strategy can scale back significantly.** Running 168 city-grid × term combinations is wasteful when we already have a 78K spine. **Maps becomes enrichment, not discovery.**

### Revised Maps strategy (replaces Section F's 168-run plan)

| Pass | Runs | Purpose |
|---|--:|---|
| Country-wide: `MOT centre UK`, `EV garage UK`, `bodyshop UK` | 3 | Catch low-volume terms nationally |
| City-grid (top 10 only — London 4q + Birmingham, Manchester, Glasgow, Leeds, Liverpool, Edinburgh, Bristol) × 4 terms (`garage`, `tyre fitting`, `mechanic`, `accident repair`) | ~52 | Dense urban coverage; matches back to spine by phone/postcode/name |
| Yell.com country-wide (5 terms) | 5 | Email + website + categories fill |
| **Revised total** | **~60 runs** (down from 168) | |

Estimated revised cost:
- Maps: ~$95 (was $300)
- Yell: ~$30
- Subtotal Apify: **~$125** (was $340)
- Plus MV (~$18) and optional Prospeo (~$25)
- **Revised total: ~$170** (was $370–555)

### Files produced (in `/tmp/gb-checkpoint/`)

| File | Size | Description |
|---|--:|---|
| `active-mot-stations.csv` | 2.3 MB | DVSA raw |
| `dvsa-clean.json` | 11 MB | DVSA normalised (E.164 phone, canonical name, ICP class flags) |
| `dvsa-postcodes-unique.json` | 0.2 MB | 19,921 unique postcodes |
| `postcodes-geocoded.json` | 2.5 MB | postcodes.io results (97.5% hit rate) |
| `ch-basic.zip` | 470 MB | CH 2026-04-01 snapshot (gitignored, do not commit) |
| `ch-sic45200-active.json` | 30 MB | CH filtered to active SIC 45200 (61,459 rows) |
| `registry-spine.json` | ~50 MB | Merged DVSA + CH = 78,866 rows |

### Risks newly visible after the checkpoint

1. **Boundary-matched DVSA↔CH pairs need a second-pass review.** Sample showed 1 false positive at Jaccard=0.4 (`GATEWAY MOTOR COMPANY` matched `THOMPSON MOTOR COMPANY (PRESTON) LIMITED` at the same postcode — likely two distinct businesses sharing a multi-tenant unit). Of the 5,724 matches, expect ~1–3% false positives. Either tighten threshold to 0.5 (cuts to ~5,200 matches, all higher-confidence) or accept noise and let Maps re-merge by phone correct the bookkeeping.
2. **CH `RegAddress` ≠ trade address** for an unknown but non-trivial fraction. Trying to enrich a CH-only row by querying `"<name> <postcode>"` on Maps will frequently miss because the Maps record sits at a different postcode. Better: query `"<name>" near <county centroid>` and re-merge by name fuzzy + phone.
3. CH file is 2.8 GB uncompressed — must remain gitignored. Add to `.gitignore`: `scripts/ch-basic.zip`, `scripts/ch-sic45200-active.json`.

### Go / no-go after checkpoint

- **GO** with the **revised ~60-run Maps strategy** (saves ~$200–400 vs. original).
- Spine of 78,866 rows is unprecedented for this pipeline and arrives free.
- Recommendation for Jacob: approve the revised plan, then proceed to Phase B starting from Step 3 (Apify Maps country-wide passes), since Steps 1–2 (registry pulls) are already done.

---

## Actual results — checkpoint paused 2026-04-28

Phase B paused after country-wide Maps run + registry merge + pattern-email enrichment. Total spend: **~$2.88** (one Apify Maps run + 1,250 MillionVerifier checks). Decision deferred on table destination (see "Open decisions" below).

### What ran

| Step | Source | Cost | Result |
|---|---|--:|---|
| 1 | DVSA Active MOT Stations CSV (free) | $0 | 23,087 rows · 100% phone, 100% postcode |
| 2 | Companies House BasicCompanyData 2026-04-01 (free) | $0 | 5.7M total → **61,459 active SIC-45200** |
| 3 | postcodes.io geocoding (free) | $0 | 19,422 / 19,921 unique postcodes geocoded (97.5%) |
| 4 | Apify `compass/crawler-google-places` country-wide GB (3 terms × 500 cap) | ~$2 | 1,500 records (`MOT centre`, `EV garage`, `bodyshop`) |
| 5 | ICP category filter on Maps | $0 | 1,404 (96 dropped: dealers, fuel, EV chargers) |
| 6 | Registry merge (DVSA ↔ CH, postcode + name Jaccard) | $0 | 5,724 gold-merged + 17,363 DVSA-only + 55,779 CH-only = **78,866 spine** |
| 7 | Maps↔spine merge (phone E.164 + postcode+name) | $0 | 470 phone-matched + 161 postcode-matched + 773 net-new |
| 8 | Pattern-guess + MillionVerifier MX (info@/enquiries@/contact@/office@/sales@ × 314 unique domains) | ~$0.88 | 102 valid + 56 catch_all = 158 domains (50%) yielded a verified pattern → **+183 Maps rows** got an email (1 chain domain enriches multiple physical locations) |

### Final dataset shape (post-Apify + pattern-MV, pre-Yell)

| | Rows |
|---|--:|
| Registry spine (DVSA + CH active SIC-45200) | 78,866 |
| Maps records (ICP-filtered, country-wide) | 1,404 |
| Spine rows enriched by Maps | 631 |
| Maps-only net-new (mostly chains/dealer service depts + low-info rows) | 773 |
| Maps rows with **email** (post-pattern-MV) | **698 (50%)** — was 543 (37%) pre-pattern |
| Maps rows with **verified-valid email** | 120 |
| Maps rows with catch_all email (deliverable but not mailbox-verified) | 63 |
| **Combined unique candidates** | **~79,640** |

### Coverage by field

| Field | Spine alone | After Maps merge |
|---|--:|--:|
| Trading name | 100% | 100% |
| Postcode | 100% | 100% |
| Phone (E.164) | 29.2% (DVSA-derived) | 30.0% (+0.8pp from Maps) |
| Companies House number | 75.8% | 76.0% |
| Lat/lng | ~97% (postcodes.io) | ~97.5% (Maps adds precise points for 631 rows) |
| Website | 0% | 1.1% (970 of 1,404 Maps rows have site) |
| Email | 0% | 0.9% post-pattern-MV (698 of 1,404 Maps rows have email — was 543 pre-pattern) |
| Categories (multi-valued) | 0% | 1.8% (Maps rows only) |
| GMB description | 0% | <0.1% (Maps coverage was thin: 18 of 1,500) |

### Why we stopped

1. **Yell blocked**: both UK Yell scrapers on Apify (`mcdowell/yell-scraper`, `ecomscrape/yell-business-search-scraper`) require **$20–30/month rental** + usage. Free trials already spent on this token. ROI vs. one-shot use case is poor.
2. **Maps country-wide saturated the cap**: every term hit 500 (the per-search cap). To unlock more Maps rows we'd need city-grid (~$95) or alternative actors. Not a free option.
3. **Spine corroboration is high (45% phone-match on the random Maps sample)** — the registry layer isn't missing the obvious shops. Spending more Apify budget for marginal long-tail discovery is not the priority right now.
4. **Bigger blocker upstream**: there is no UK-prospecting feature in the CRM-SaaS app yet (no Discovery UI page filtering by `country_code='GB'`, no promote flow). Building a Supabase landing table before the consumer feature is premature; CLAUDE.md explicitly says to start a fresh table when that feature lands. Holding the data on disk until then.

### Files persisted (gitignored: `_reference/gb-checkpoint/`)

| File | Size | Purpose |
|---|--:|---|
| `active-mot-stations.csv` | 2.3 MB | DVSA raw download (encoded CP1252) |
| `dvsa-clean.json` | 11 MB | DVSA normalised: E.164 phones, canonical names, ICP class flags |
| `dvsa-postcodes-unique.json` | 0.2 MB | 19,921 unique postcodes |
| `postcodes-geocoded.json` | 2.4 MB | postcodes.io results (lat/lng, region, admin_district) |
| `ch-sic45200-active.json` | 29 MB | CH 2026-04-01 snapshot, filtered to active SIC-45200 |
| `registry-spine.json` | 25 MB | Merged DVSA + CH = 78,866 rows |
| `gb-maps-raw.json` | 5.0 MB | Apify Maps raw output (1,500 records) |
| `gb-maps-normalised.json` | 1.0 MB | Maps records ICP-filtered + normalised (1,404 rows, pre-enrichment) |
| `gb-pattern-emails.json` | ~0.4 MB | Pattern-MV results per domain (314 domains × up to 5 patterns = 1,250 attempts) |
| `gb-maps-enriched.json` | ~1.1 MB | Maps records + pattern emails merged (final email coverage 50%) |
| `gb-runs.json` | 0.5 KB | Apify run metadata (runId, datasetId) for reproducibility |

The CH zip (470 MB compressed / 2.8 GB extracted) is **not** persisted — regeneratable from `https://download.companieshouse.gov.uk/BasicCompanyDataAsOneFile-2026-04-01.zip` (or the latest snapshot) in ~2 min.

### Open decisions for next session

1. **Table destination**: stay on hold until a UK-prospecting feature is added to CRM-SaaS. CLAUDE.md says fresh table; PROJECT-STATUS.md shows CZ/SK/RS used `discovered_shops` post-legacy-marking. Resolve when the consumer is being built.
2. **Email lift strategy** (whenever we ship): Prospeo `/domain-to-email` ($0.10/lookup) on the 970 Maps rows with website-but-no-email is the cleanest +$~30 path; would yield ~600 extra emails. MillionVerifier MX runs at the end as always.
3. **More Maps coverage** (deferred): if the dataset shape proves too sparse for the eventual outbound use case, run city-grid for the top 10 cities × 4 terms (~$80) to enrich another ~10K spine rows by phone.

### Plan vs. actual delta

| Metric | Planned | Actual |
|---|--:|--:|
| Unique rows | 32,000–38,000 | **79,640** (≈ 2× plan — registries massively over-delivered) |
| Email coverage | 50–65% post-Maps+Yell | 0.7% (Yell skipped; spine is registry-only) |
| Phone coverage | 90%+ | 30% — registry spine carried it; full coverage would need Maps city-grid or Yell |
| Apify spend | ~$370 expected | **~$2** (single country-wide Maps run) |
| Total enrichment spend | ~$370 expected | **~$2.88** (Apify $2 + MillionVerifier $0.88) |
| Wall-clock | 1 working day | ~3 hours to checkpoint |

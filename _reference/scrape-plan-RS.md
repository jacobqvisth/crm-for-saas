---
type: scrape-plan
country: Serbia
country_code: RS
status: done  # draft → approved → in-progress → done
created: 2026-04-24
approved: 2026-04-27
scraped: 2026-04-27
---

# Scrape Plan — Serbia (RS)

> Step 0 output of the `scrape` skill. Awaiting Jacob's approval before any Apify credit is spent. **First non-EU country in the pipeline.** Market profile diverges from CZ/SK in three ways that shape the execution: (1) ~17-year average fleet age (oldest in Europe) → much stronger independent-workshop ICP than any market we've scraped; (2) bilingual Latin/Cyrillic script environment; (3) partially "grey-market" aftermarket per industry reporting → expect more Facebook-only shops than CZ, fewer than LV-Latgale.

## A — Country profile

- **Population:** ~6.6M (Serbia proper, excluding Kosovo — Statistical Office of Serbia 2024). Distinct trend vs peers: slight population decline.
- **GDP per capita:** ~$12k nominal / ~$27k PPP (2025 est.) — materially lower than any EU country we've scraped (CZ ~$31k nominal, SK ~$25k, LV ~$22k). Shops are correspondingly more price-sensitive and owner-operated.
- **Registered passenger cars:** **2,476,419** (2025, Statistical Office of Serbia / CEIC). Total registered vehicles all classes: **2,904,511** (Dec 2024), +4.0% YoY. Strong used-import flow from Germany/Italy drives fleet growth.
- **Registered light commercial vehicles:** ~280–350k (derived residual from total minus passenger minus heavy).
- **Cars per 1,000 people:** ~**375** — moved up significantly from 287 (2018 Statista figure). Still lower than CZ (~607) and SK (~479), but high enough to support a dense aftermarket. Cross-check: 2.48M cars / 6.6M pop = 375.
- **EV share of new sales / EV share of stock:**
  - BEV new-sales share: **~1.23%** (Jan–Sep 2025) — +50.5% YoY.
  - BEV stock: **~7,200 units** (<0.5% of fleet) — marginal, workshop demand is ~99.5% ICE.
  - Implication: no dedicated EV-specialist search term this pass.
- **Mandatory inspection regime:** **Tehnički pregled** — **annual** mandatory inspection (unlike the EU 2-year cycle of CZ/SK). Performed at **private operators** regulated by the state. New cars: first inspection up to 2 years after first registration.
  - From **June 2026** (next two months from this plan's date) a new system routes all inspection data directly to the state registry. No impact on scrape methodology but means more inspection stations may list explicit domains in coming months.
- **Import tax / fleet notes:**
  - **Not an EU member.** Import duties + excise + 20% VAT on used imports; grey-market channels meaningful.
  - **Fleet age: ~17 years average** — among the oldest in Europe (CZ ~14 yr, LV ~14 yr). Implication: **the ICP is richer here than in any market we've scraped** — more independent shops per capita, more complex and frequent repair work, older vehicles requiring real mechanical depth rather than dealer-centric service.
- **Dominant brands / aftermarket chains:**
  - **Bosch Car Service** — franchise footprint in Belgrade, Novi Sad, Niš, regional centers. Numerically smaller than CZ's ~dozens-of-locations but present. Will be absorbed by `autoservis` queries.
  - **Inter Cars Serbia** (B2B parts distributor, ~€40–45M revenue) — does not operate own workshops but anchors a franchised independent network (AD Auto / Inter Auto).
  - **KIT Commerce** (~€45–50M revenue, parts + tyres retail, 20+ locations).
  - **Wagen / Wint** (~€40M+ revenue, pure B2B — no shop scrape implications).
  - **Rapidex Trade** (€50–55M, commercial/truck-heavy — out of ICP).
  - **Authorized dealer service** — networks for VW Group (Škoda/VW), Fiat (Kragujevac Fiat plant, formerly Zastava), Renault, Dacia, Hyundai, Kia.
  - **Long tail of small independents** — per industry reporting "over 2,000 companies" in the aftermarket value chain, "complex, fragmented, non-transparent." The bulk of the ICP.
- **Other market quirks:**
  - **Bilingual script environment.** Serbian is written in both Latin and Cyrillic. **Google Maps listings: predominantly Latin script** (shops self-list how customers find them). Cyrillic search terms sometimes return a different subset — we'll run Latin as the primary pass; Cyrillic is a low-cost sanity check if yield looks light.
  - **"Grey market" flag** — industry reporting explicitly calls the aftermarket fragmented, non-transparent, with partial reporting. Expect more shops that are FB-only or tax-informal than in CZ/SK. Pass 1 (Google Maps) will still capture those with GBP listings; Facebook-only shops are a potential Pass-2 gap fill.
  - **Kosovo excluded.** Shops listed with a `countryCode: "xk"` or in municipalities like Priština/Prishtina should be filtered at import — that's a separate (disputed) market.
  - **Regional economic divide:** Vojvodina (north) is richer, more westernized; Central Serbia (Šumadija, Pomoravlje, Raška) is middle-income; Southern Serbia (Jablanica, Pčinja, Pirot, Toplica) is the poorest, with an expectedly thinner shop-density-per-capita on Maps.
  - **Language note:** Serbian, Croatian, and Bosnian are mutually intelligible. A small number of cross-border shops in Sandžak (Novi Pazar area) list in both Serbian and Bosnian — negligible overlap with our search terms.
  - **Fiat-Zastava legacy in Kragujevac** — old Yugoslav fleet (Yugo / Zastava) plus a Stellantis plant creates dense automotive history and a notably high shop-per-capita density around Kragujevac and southern Šumadija.

## B — Administrative geography

### Regions (Upravni okruzi — 24 non-Kosovo districts + Belgrade)

| District | Population | Administrative center | Est. shops |
|---------|-----------|----------------------|-----------|
| Grad Beograd (Belgrade) | ~1,681,000 | Belgrade | ~1,100–1,400 |
| South Bačka | 607,000 | Novi Sad | ~400–520 |
| Nišava | 344,000 | Niš | ~230–300 |
| Raška | 297,000 | Kraljevo | ~200–260 |
| Srem | 283,000 | Sremska Mitrovica | ~190–240 |
| Šumadija | 270,000 | Kragujevac | ~200–260 *(Zastava/Fiat bump)* |
| Mačva | 265,000 | Šabac | ~180–230 |
| South Banat | 260,000 | Pančevo | ~180–230 |
| Zlatibor | 255,000 | Užice | ~170–220 |
| Rasina | 207,000 | Kruševac | ~140–180 |
| Pčinja | 194,000 | Vranje | ~130–170 *(poorer)* |
| Moravica | 189,000 | Čačak | ~130–170 |
| Jablanica | 184,000 | Leskovac | ~120–160 *(poorer)* |
| Pomoravlje | 182,000 | Jagodina | ~120–160 |
| Podunavlje | 176,000 | Smederevo | ~120–160 |
| North Bačka | 160,000 | Subotica | ~110–140 |
| Central Banat | 158,000 | Zrenjanin | ~105–140 |
| Braničevo | 156,000 | Požarevac | ~105–140 |
| West Bačka | 154,000 | Sombor | ~105–135 |
| Kolubara | 154,000 | Valjevo | ~105–135 |
| North Banat | 118,000 | Kikinda | ~80–105 |
| Bor | 101,000 | Bor | ~70–90 |
| Zaječar | 97,000 | Zaječar | ~65–85 |
| Toplica | 77,000 | Prokuplje | ~50–70 |
| Pirot | 77,000 | Pirot | ~50–70 |
| **Total** | **~6,600,000** | | **~4,400–5,900 raw** → **~3,200–4,500 unique** after dedup |

Estimates apply a ~1 shop per 1,300 people ratio — higher than CZ (1:1,400) and SK (1:1,500) because of the 17-year fleet age. Reality check: Belgrade alone will likely land 1,000+ unique shops given the metro area and the 1.68M population.

### Top cities — city-grid targets

Serbia has one mega-city (Belgrade at 1.68M, ~25% of the national population), one mid-major (Novi Sad at 370k), and a fat middle tier of 100–250k cities. Country-wide queries will hit the 500-cap on every primary term — city-grids are essential, and Belgrade will need a **3-way split** (larger than Prague's 2-way).

| City | Population | Lat | Lng | Radius (m) | Expected shops |
|------|-----------|-----|-----|------------|----------------|
| Belgrade (Beograd) | 1,681,000 | 44.7866 | 20.4489 | 20000 | 1,000–1,400 |
| Novi Sad | 369,000 | 45.2671 | 19.8335 | 15000 | 300–420 |
| Niš | 250,000 | 43.3209 | 21.8954 | 12000 | 220–300 |
| Kragujevac | 171,000 | 44.0128 | 20.9114 | 12000 | 180–240 *(Fiat bump)* |
| Subotica | 124,000 | 46.1005 | 19.6674 | 10000 | 100–140 |
| Leskovac | 124,000 | 42.9981 | 21.9461 | 10000 | 95–130 |
| Pančevo | 115,000 | 44.8704 | 20.6400 | 10000 | 95–130 |
| Kruševac | 114,000 | 43.5806 | 21.3267 | 10000 | 95–130 |
| Kraljevo | 110,000 | 43.7258 | 20.6897 | 10000 | 90–125 |
| Novi Pazar | 107,000 | 43.1367 | 20.5122 | 10000 | 85–115 |
| Zrenjanin | 106,000 | 45.3825 | 20.3897 | 10000 | 85–115 |
| Čačak | 106,000 | 43.8914 | 20.3497 | 10000 | 90–125 |
| Šabac | 105,000 | 44.7472 | 19.6908 | 10000 | 85–115 |
| Smederevo | 98,000 | 44.6628 | 20.9283 | 10000 | 80–110 |
| Valjevo | 82,000 | 44.2700 | 19.8897 | 9000 | 65–90 |

Notes:
- **Belgrade gets a 3-way split-by-search-term** — unique in our pipeline. Run three separate geolocation calls against the same 20km grid, each with one of {`autoservis`, `auto servis`, `autolimar`}. This triples the effective cap from 500 → 1,500 in the capital. (Prague needed 2-way; Belgrade is larger than Prague by population.)
- **Novi Sad, Niš, Kragujevac** each get a 2-way split (standard CZ-sized treatment).
- Cities 5–15 get a single-grid call each with the 2-term default set.
- Below ~80k population, rely on the country-wide pass — the 15 grids above cover the top 70% of national population density.
- **Kragujevac over-indexing warning:** applied the Fiat Kragujevac plant + Yugo-fleet legacy uplift. Expect meaningfully higher shop density than population alone suggests.

## C — Search term matrix

Language: **Serbian, Latin script.** Cyrillic variants listed for reference but not run in Pass 1 — Google Maps shops self-list in Latin script >95% of the time, and Latin queries should return the same listings.

| Niche | Primary local term(s) | Cyrillic reference | English fallback | Include? | Notes |
|-------|----------------------|---------------------|------------------|----------|-------|
| General repair / mechanic | `autoservis`, `auto servis`, `automehaničar` | `аутосервис`, `аутомеханичар` | `auto repair`, `car repair shop` | ✅ | `autoservis` dominates; `auto servis` is the spaced variant (Google treats both slightly differently — run both per CZ precedent); `automehaničar` catches small neighbourhood shops |
| Body shop / paint | `autolimar`, `autolakirer` | `аутолимар`, `аутолакирер` | `auto body shop`, `auto paint shop` | ✅ | `autolimar` = sheet-metal / body work (equivalent to CZ `karosárna`); `autolakirer` = paint. Both are common independent specializations in Serbia's old-fleet market |
| Inspection / technical | `tehnički pregled`, `linija tehničkog pregleda` | `технички преглед` | `vehicle inspection` | ❌ | **Separate ICP**. Private operators of `tehnički pregled` are a distinct revenue model; exclude this pass. Multi-service shops that also do inspection will still be caught via `autoservis`. |
| Tyre shop | `vulkanizer`, `vulkanizerska radnja`, `gume` | `вулканизер` | `tire shop` | ❌ | **Excluded this pass** per LV/CZ/SK precedent. Combined shops (auto repair + vulkanizer) still caught via `autoservis` thanks to array-overlap. `vulkanizer` is a Serbian-specific term worth noting — the tyre-shop density is high because of the old fleet. |
| EV specialist | `servis elektromobila`, `elektromobil servis` | `сервис електромобила` | `EV repair` | ❌ | **Skip** — EV stock <0.5% of fleet, expected yield <15 shops. Revisit when fleet EV share crosses 2–3%. |
| Brand / chain specialist | `Bosch Car Service`, `Inter Auto`, authorized dealers | — | — | ➖ | Absorbed by `autoservis` queries — no dedicated pass. |
| Truck / heavy / commercial | `servis kamiona`, `servis teretnih vozila` | `сервис камиона` | `truck repair` | ❌ | **Skipped this pass** per precedent. Revisit if truck ICP becomes a priority. |
| Motorcycle | `moto servis`, `servis motocikala` | — | `motorcycle repair` | ❌ | Not ICP. |
| Car wash | `auto perionica`, `perionica automobila` | — | `car wash` | ❌ | Not ICP. |
| Car dealer | `prodaja automobila`, `auto plac`, `polovni automobili` | — | `car dealer` / `used car lot` | ❌ | Not ICP. Serbia has a dense used-car-dealer market (`auto plac` = used-car lot) thanks to grey imports — filter aggressively in exclude list. |
| Auto electrical | `autoelektričar` | `аутоелектричар` | `auto electrician` | ⚠️ | Include as a secondary term. Often a standalone specialty in Serbia's old-fleet market. Expected yield ~100–200 additional rows not caught by `autoservis`. |

**Country-wide search strings (single actor call):**
1. `autoservis`
2. `auto servis`
3. `automehaničar`
4. `autolimar`
5. `autolakirer`

**City-grid search strings (per city in B, 2 terms each):**
1. `autoservis`
2. `autolimar`

**Belgrade 3-way split grid:** three separate geolocation calls, each with one of {`autoservis`, `auto servis`, `autolimar`} — triples effective cap.
**Novi Sad / Niš / Kragujevac 2-way splits:** two geolocation calls each with {`autoservis`, `autolimar`}.

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
- Muffler shop
- Auto radiator repair service
- Auto air conditioning service
- Auto tune up service
- Oil change service

**Exclude categories (only excluded if *all* of a shop's categories are in this list):**
- Tire shop
- Truck repair shop
- Car dealer
- Used car dealer *(large category in RS — `auto plac` lots)*
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
- Vehicle inspection service *(RS-specific — `tehnički pregled` operators. Keep only if they also carry `Auto repair shop`)*
- Vehicle wrapping service

**Edge cases / judgment calls for RS:**
- **`tehnički pregled` stations** — many will carry only `Vehicle inspection service` + `Auto repair shop` co-tag. Array-overlap keeps co-tagged shops; pure inspection stations are excluded. Expect ~200–300 inspection-only rows to be filtered correctly.
- **`auto plac` (used-car lots)** — heavily present, correctly excluded when their only tags are `Used car dealer` / `Car dealer`. Watch for hybrid plac + repair operations: those survive via overlap and are likely genuine ICP (they do prep/MOT work).
- **Zastava / Fiat ecosystem in Kragujevac** — legacy Yugo specialists and Fiat-authorized independents will have varied category tags. Keep all; flag with a `fiat_specialist` tag at import for ICP tiering.
- **Cyrillic-only shops** — a handful of listings may carry only Cyrillic name/address text. Our import pipeline preserves raw UTF-8, so downstream display is fine. No filtering adjustment needed.
- **Kosovo listings** — exclude any rows with `countryCode: "xk"` or addresses matching `Priština|Prishtina|Prizren|Peć|Peja|Gjakova|Mitrovica (KS)`. Separate disputed market, not in scope.
- **Facebook-only shops** — per the "grey market" industry note, expect these to form a larger gap than in CZ/SK. Tracked as a known Pass-2 candidate; not addressed in this pass.

## E — Data source & tool selection

### Layers evaluated

| Layer | Source | Coverage for RS | Free? | Apify actor? | Decision |
|-------|--------|-----------------|-------|--------------|----------|
| Registry (official) | **APR** (apr.gov.rs — Agencija za privredne registre) | All RS-registered legal entities with šifra delatnosti (Serbian NACE-equivalent) 45.20 = motor vehicle repair | Free web search, paid bulk API | No off-the-shelf actor; form-based search | **Deferred to Pass 2** — best long-tail + VAT-number source but requires a custom scrape |
| Registry (commercial) | **Paragraf Lex**, **Profit.rs** | Decent RS business-data aggregators | Freemium | No dedicated actor | **Deferred** |
| Directory | **Žuti stranci** (yellow pages equivalent), **Kompass.rs** | Category-indexed; emails + phones for many entries | Free browse | Generic scraper | **Optional gap fill** |
| Directory | **Biznispartner.rs**, **Yellowpages.rs** | Smaller/older directories | Free | Generic | Low priority |
| Google Maps | `compass/crawler-google-places` | Good for RS — Belgrade/Vojvodina very well-indexed, southern regions thinner but still useful | $7 / 1,000 places | ✅ Battle-tested across CZ/SK/LT/LV/EE | **Primary source** |
| Facebook Pages | FB scraper | **Higher value in RS than in CZ/SK** due to grey-market shop profile — especially in southern Serbia and smaller towns | Paid | `apify/facebook-pages-scraper` | **Candidate for Pass 2** — skip this pass |
| Enrichment | **Prospeo `/domain-to-email`** | Decent RS coverage (better than Baltics, comparable to SK) | Paid, existing integration | Existing lib | **Run after primary** for rows with website but no email |
| Enrichment | Vibe Prospecting | Weak in RS owner layer (small market) | Paid, MCP connected | — | **Skip** |
| Email verification | **MillionVerifier** via `scripts/lib/email-verify.mjs` | — | Paid, existing pipeline | Existing lib | **Always run last** |

### Ranked source stack (final)

1. **Google Maps (primary)** — country-wide 5-term pass + 15-city grids with Belgrade 3-way / Novi Sad / Niš / Kragujevac 2-way splits. Captures ~3,500–4,800 unique shops.
2. **Prospeo `/domain-to-email` enrichment** — on rows with `website` but no `primary_email`. Expect ~30–40% of scraped rows to have a domain without an email (similar to CZ/SK rates).
3. **MillionVerifier** — verify every row with any email; write `email_status` + `email_verified_at`.
4. **(Deferred to Pass 2)** APR registry custom scrape against šifra 45.20 — best for long-tail rural coverage + VAT numbers for cross-source dedup.
5. **(Deferred to Pass 2)** Facebook Pages scrape — for grey-market / southern-region shops missing from Google Maps.

### Dedup keys (priority order)

1. `google_place_id` (primary — this pass is Maps-only)
2. Normalized domain (strip protocol, `www.`, trailing slash; lowercase)
3. Normalized phone (E.164, **+381** for RS)
4. Lowercased name + city combo (last-resort)

VAT (PIB — Poreski Identifikacioni Broj) is not exposed by Google Maps. APR would add it in Pass 2.

## F — Scrape execution plan

### Source run order

1. **Apify Google Maps — country-wide pass**
   - Input: `countryCode: "rs"`, `searchStringsArray: ["autoservis", "auto servis", "automehaničar", "autolimar", "autolakirer"]`, `maxCrawledPlacesPerSearch: 500`, `scrapeContacts: true`, `language: "sr-Latn"` (Serbian Latin — Google accepts this locale; fallback `"sr"` if it errors), `includeOpeningHours: true`.
   - Expected: ~1,800–2,300 raw rows (`autoservis` and `auto servis` both likely cap at 500; others 300–400 each).
2. **Apify Google Maps — Belgrade 3-way split grids**
   - 3 geolocation runs at `customGeolocation: { type: "Point", coordinates: [20.4489, 44.7866], radiusMeters: 20000 }`, each with one of `["autoservis"]`, `["auto servis"]`, `["autolimar"]`.
   - Expected: ~1,000–1,500 raw rows combined, heavy overlap with pass 1.
3. **Apify Google Maps — Novi Sad / Niš / Kragujevac 2-way split grids**
   - 6 geolocation runs total (3 cities × 2 terms), `customGeolocation` + `radiusMeters` per city from § B.
   - Expected: ~700–1,000 raw rows combined.
4. **Apify Google Maps — remaining 11 city-grid passes (Subotica, Leskovac, Pančevo, Kruševac, Kraljevo, Novi Pazar, Zrenjanin, Čačak, Šabac, Smederevo, Valjevo)**
   - 11 geolocation runs × 2 terms each (`autoservis`, `autolimar`) in a single `searchStringsArray` per run.
   - Expected: ~1,000–1,500 raw rows combined.
5. **Python dedup + normalization** in sandbox — apply dedup cascade from E, filter against include/exclude lists with array-overlap semantics, exclude Kosovo rows by `countryCode === "xk"` and addresses matching the Kosovo city regex. Emit direct-from-dataset reads (no local JSON file) per CZ/SK precedent.
6. **Supabase import** — create `scripts/import-serbia-shops.mjs` from the Slovakia template. Update `INCLUDE_CATEGORY_REGEX` to cover RS-specific tags. Upsert on `google_place_id`. Run against `discovered_shops` on project `wdgiwuhehqpkhpvdzzzl`.
7. **Prospeo `/domain-to-email` enrichment** — target rows with `website IS NOT NULL AND primary_email IS NULL AND country_code = 'RS'`.
8. **MillionVerifier** — `node scripts/verify-emails.mjs --country RS --concurrency 80 --only-null`, chunked in `--limit 400` batches for bash timeout.

### Google Maps passes summary

- **Country-wide terms (500-cap each):** `autoservis`, `auto servis`, `automehaničar`, `autolimar`, `autolakirer` — **1 actor call, 5 terms**.
- **Belgrade split grid:** **3 actor calls** (1 term each, 20km radius).
- **Novi Sad / Niš / Kragujevac split grids:** **6 actor calls** (3 cities × 2 terms).
- **Other 11 cities:** **11 actor calls** (2 terms each, per-city radius from § B).
- **Total: 21 actor calls.**

### Expected outcome

- Total raw rows (pre-dedup): **~4,500–6,300**
- Total unique rows after dedup: **~3,200–4,500**
- Apify credit cost estimate: **~$32–45** at $7 / 1,000 places
- Estimated duration: **1.5–3 hours** (21 runs launched in 3 parallel waves — country-wide + big-city splits, then medium cities)
- Estimated % with email: **35–50%** (lower than CZ's 50%; RS web presence is weaker in southern regions; grey-market drag)
- Estimated % with phone: **88–93%**
- Estimated unique cities: **500–800** (country-wide pass picks up long-tail villages; big metros contribute density not breadth)

### Go / no-go summary

Recommend proceeding. Serbia is roughly **SK-scale by unique-row count** (~3,500–4,500 expected vs SK's 3,573 actual) but with a meaningfully stronger ICP fit because of the 17-year fleet age — independent workshops are more numerous and more revenue-relevant per capita than in any EU market we've scraped. The execution plan is a proven pattern: 5-term country-wide pass + per-city grids + splits for the four largest cities. Belgrade's 3-way split is the only novel mechanic; it's a direct extension of the CZ Prague split that worked cleanly. Apify cost lands at ~$32–45 (below both CZ and SK), duration fits within a 2–3 hour window. **Go.**

**Open flags for Jacob to confirm or redirect:**
1. **Script locale.** Default plan runs **Latin-script** search terms only. If yield from the country-wide pass comes in below ~1,500 rows, we'd follow up with a Cyrillic pass (`аутосервис`, `аутомеханичар`, `аутолимар`) before spinning up more city grids. Cost is ~$5–10 extra. Default is Latin-only; flag if you want Cyrillic included up-front.
2. **`automehaničar` inclusion.** Adds a 5th country-wide term. If budget is tight, dropping it saves ~$2–3 but likely loses ~200–400 small-shop listings. Default: keep it in.
3. **Belgrade 3-way split.** First time we're running a 3-way. Risk: low — Prague 2-way worked cleanly; this is the same pattern with one more call. Cost: one extra Apify run (~$3). Default: run the 3-way.
4. **Kosovo filter.** Plan filters Kosovo out at import. If you'd rather not filter at the scrape layer (keep all rows and tag them), flag it; trivial to change.

---

## Actual results (2026-04-27)

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Total rows (unique, post-dedup) | ~3,200–4,500 | **2,464** | −23% to −45% below plan |
| Raw rows (pre-dedup) | ~4,500–6,300 | 3,566 | −20% to −43% below plan |
| Dup placeId removed | n/a | 851 | — |
| Dup domain/phone/name+city removed | n/a | 251 | — |
| Category-filtered | n/a | 0 | filter is a no-op for RS |
| Kosovo-filtered | n/a | 0 | `countryCode: "rs"` already excluded XK |
| % with email | 35–50% | **14%** (345) | **−21pp to −36pp below plan** |
| % with phone | 88–93% | **90%** (2,222) | ✅ on plan |
| % with website | n/a | 22% (535) | low |
| Unique cities | 500–800 | **465** | −7% below plan low end |
| Apify cost | ~$32–45 | **~$25** (3,566 × $7/1k) | −22% to −44% below plan |
| Duration | 1.5–3 hours | **~1.5 hours** wall clock (country-wide 86 min was slowest) | ✅ within plan |

**Email verification (MillionVerifier, 345 verified at concurrency 80, 33s):**
- valid: **213** (62% of verified, 8.6% of all RS rows)
- risky: 78 (23% of verified)
- catch_all: 31 (9%)
- invalid: 23 (7%)
- unknown: 0

**Run ledger — 21 of 21 succeeded**

| Wave | Label | runId | datasetId | Runtime |
|------|-------|-------|-----------|---------|
| 1 | RS country-wide (5 terms) | evTefJ6khCF4QvZwB | GH2xz9jg4lsis6tBn | 86 min |
| 1 | Belgrade — autoservis | hZIMhsVeL7w2WZsqE | dA6t4lbm0CpxfX6P2 | 6.4 min |
| 1 | Belgrade — auto servis | 9YKgH3K3fQ5uOtZPA | odfcfoTIBusRo3h5C | 3.8 min |
| 1 | Belgrade — autolimar | tSthEWegECm0K7yL1 | 6V9jf9DxvOonx8bIV | 2.4 min |
| 2 | Novi Sad — autoservis | MJ5uFbIydlXbZJp94 | ywENXYN8sdYQ3yE7x | 2.7 min |
| 2 | Novi Sad — autolimar | iev8lYf710QNpborz | IOKRfyuqf67miTtIr | 1.1 min |
| 2 | Niš — autoservis | xbnN3LL8X930eJp15 | 0OJnRLBb0ZUqr391T | 4.8 min |
| 2 | Niš — autolimar | zHLhZFhB00uwx2yXx | emYIflHwqQx9oWKIt | 4.3 min |
| 2 | Kragujevac — autoservis | YCghXYEg6wJktKMUj | NfzQ6GqczLwpzi07p | 0.9 min |
| 2 | Kragujevac — autolimar | 7oHBuKosJgKgemAKG | 50B2UaBG93QtHhG3a | 0.6 min |
| 3 | Subotica | OYoNpkc53iGnrC3kt | ccnYHxWGGxz0Vmswg | 3.9 min |
| 3 | Leskovac | smbGNjShZnBqv2ubU | Xhk8LWxWEasECE7Aj | 3.5 min |
| 3 | Pančevo | OssQeZog1yXqDzKLF | YSR1vrsRkgdx2AG8n | 1.4 min |
| 3 | Kruševac | MjAoqfFf7svVYkirI | ouGDwPUZPh3OecMsj | 3.4 min |
| 3 | Kraljevo | mwKyjAlw92DBGZfF9 | qjf7TEAlRjpb1UG0d | 4.2 min |
| 3 | Novi Pazar | OwAVEj3Lfxitlr9AN | Kfnc1UB6xmDFUdmaZ | 4.2 min |
| 3 | Zrenjanin | TZMfdzKuATUo6HvIt | CRjALJHmFMm6qY3na | 3.8 min |
| 3 | Čačak | MYh53D63juL0GfZr2 | 8zhv19pdb5JccFn23 | 5.4 min |
| 3 | Šabac | wqo00R7oxWgcJ5sbb | 825LndTPvMCDa458a | 4.5 min |
| 3 | Smederevo | QdkMwY9jSBkQH33QQ | steevrWATR98ESAg7 | 5.4 min |
| 3 | Valjevo | yEfx3zFQJgAMkYdDU | t00GM8ljBYJM4nwqM | 2.3 min |

**Per-dataset item yield**

| Dataset | Items |
|---------|-------|
| RS country-wide (5 terms) | 2,028 |
| Belgrade — autoservis | 431 |
| Belgrade — auto servis | 500 (cap) |
| Belgrade — autolimar | 110 |
| Novi Sad — autoservis | 111 |
| Novi Sad — autolimar | 25 |
| Niš — autoservis | 35 |
| Niš — autolimar | 13 |
| Kragujevac — autoservis | 20 |
| Kragujevac — autolimar | 4 |
| Subotica | 57 |
| Leskovac | 16 |
| Pančevo | 35 |
| Kruševac | 10 |
| Kraljevo | 15 |
| Novi Pazar | 21 |
| Zrenjanin | 48 |
| Čačak | 28 |
| Šabac | 17 |
| Smederevo | 21 |
| Valjevo | 21 |
| **Total raw** | **3,566** |

**Lessons for next country:**
- **Email coverage materially lower for non-EU markets.** RS came in at 14%, vs 51% (CZ) / 40% (SK) / 35% (LT/LV/EE). The country profile flagged this risk ("complex, fragmented, non-transparent grey market") but the actual delta vs plan is bigger than expected. **For future non-EU markets (Bosnia, North Macedonia, Albania, Ukraine, Moldova) plan with 10–20% email coverage as the baseline expectation, not 30–50%.**
- **Country-wide pass dominated yield.** 2,028 of 3,566 raw items (57%) came from the country-wide 5-term call. City-grid passes added density only in Belgrade (1,041 raw across the 3 splits) and Novi Sad / Subotica. Niš / Kragujevac grids returned <40 items each — their workshops were already absorbed by country-wide.
- **`auto servis` (spaced) was the only city-grid term to hit the cap.** Belgrade — auto servis returned exactly 500 items. Suggests Belgrade has more `autoservis` listings than Apify could surface — a deeper sub-grid (e.g. by district like Stari Grad / Novi Beograd / Zemun) could unlock another 200–500 rows. Defer to Pass 2.
- **Belgrade 3-way split worked cleanly** — no actor errors, no timeouts. Pattern is now proven for any future capital city >1.5M people.
- **The `customGeolocation` parameter has no `radius` field** — confirmed via input-schema docs. The CZ/SK plan templates wrote `radiusMeters:` which the actor silently ignored. **Update the scrape-plan-template.md to use `locationQuery: "<City>, Country"` instead of `customGeolocation` with radius — simpler, well-supported, and matches actor docs.**
- **`scripts/verify-emails.mjs` and `scripts/lib/email-verify.mjs` were not in the repo** (despite COWORK.md and PROJECT-STATUS.md claiming they existed since 2026-04-22). Built fresh during this run. The new lib has stricter MV result-mapping than the inline code in `src/app/api/discovery/verify-email/route.ts` — handles `result: "invalid"` and `result: "disposable"` explicitly, throws on `result: "error"` (transient API/SMTP failure).
- **Category filter contributed 0 drops in RS** (vs CZ 7, SK 0). The Latin-script search terms map cleanly to Google's category taxonomy. Array-overlap is still right but is purely a safety net for RS-style markets.
- **Kosovo filter contributed 0 drops** — the actor's `countryCode: "rs"` parameter already excluded XK rows at the source. The defensive `address ~ /Priština|Prizren|.../` regex is still worth keeping for future runs that use only `locationQuery`.
- **Prospeo `/domain-to-email` opportunity:** 190 RS rows have `website` but no `primary_email` (535 with website − 345 with email). At Prospeo ~$0.05–0.10 per lookup that's $10–20 to enrich the gap. **Deferred** — not enough scale to justify burning credits without a clear ICP-tier-up plan first. Revisit if/when RS becomes an active outbound market.

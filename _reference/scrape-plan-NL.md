---
type: scrape-plan
country: Netherlands
country_code: NL
status: draft  # draft → approved → in-progress → done
created: 2026-05-21
---

# Scrape Plan — Netherlands (NL)

> Step 0 output of [SCRAPE-PLAYBOOK](SCRAPE-PLAYBOOK.md). **Highest-volume + highest-cost** of the 4 markets. **Registry layer is mostly blocked**: KvK Handelsregister API is paid AND requires a Dutch legal entity for access. Will lean harder on Google Maps + BOVAG + RDW.

## A — Country profile

- **Population:** ~17.8M
- **GDP per capita (nominal USD 2024):** ~$68,219 (World Bank)
- **Passenger cars (Apr 2025):** 9.3M (CBS)
- **LCV fleet (2024):** ~1.1M
- **New passenger cars (2025):** 388,024
- **BEV share new cars (2025):** 40.2% (EAFO)
- **BEV share LCV new (H1 2025):** 72.3%
- **BEV share total fleet (2024):** 6.1%
- **Mandatory inspection regime:** **APK (Algemene Periodieke Keuring)** — petrol: first at year 4, then annual from year 8; diesel/LPG annual from year 3; 30+ year every 2 years. Many BOVAG members are APK-approved → APK ≠ inspection-only chain like in SE/FI.
- **Dominant chains / players:**
  - **BOVAG** — trade association, ~9,000 member entrepreneurs; ~5,000 APK-approved workshop members
  - **Bosch Car Service Netherlands**
  - **Profile Tyrecenter** — major tire+service cooperative (founded 1989)
  - **Euromaster** — Michelin subsidiary
  - **Carglass Nederland** — 55+ centres, glass-only, **EXCLUDE**
  - **AutoBest, VakGarage, AutoCrew** — independent network brands
- **Trade body:** BOVAG (broad — covers dealers, leasing, mobility too; ~5,000 workshop members specifically)
- **Market quirks:**
  - **NL is dense** — highest workshop count per km² of the 4 markets
  - APK is workshop-integrated (not inspection-only chains like SE Bilprovningen) → DON'T blanket-exclude `Vehicle inspection`
  - Carglass dominates glass — strong exclude

## B — Administrative geography

### Top cities (city-grid targets) — 12-city plan

> Density warrants more cities than NO/DK/FI. 19 cities have >130k pop; cap at 12 to keep Apify spend bounded (~$60-90 range). Add Zoetermeer/Leeuwarden/Maastricht if first pass shows gaps.

| City | Pop | Province | Lat | Lng | Radius (km) |
|------|-----|----------|-----|-----|-------------|
| Amsterdam | ~1.19M (urban region) | Noord-Holland | 52.3676 | 4.9041 | 15 |
| Rotterdam | ~660k | Zuid-Holland | 51.9244 | 4.4777 | 12 |
| Den Haag | ~565k | Zuid-Holland | 52.0705 | 4.3007 | 12 |
| Utrecht | ~370k | Utrecht | 52.0907 | 5.1214 | 12 |
| Eindhoven | ~245k | Noord-Brabant | 51.4416 | 5.4697 | 10 |
| Groningen | ~240k | Groningen | 53.2194 | 6.5665 | 10 |
| Tilburg | ~225k | Noord-Brabant | 51.5555 | 5.0913 | 10 |
| Almere | ~220k | Flevoland | 52.3508 | 5.2647 | 10 |
| Breda | ~185k | Noord-Brabant | 51.5719 | 4.7683 | 10 |
| Nijmegen | ~180k | Gelderland | 51.8126 | 5.8372 | 10 |
| Enschede | ~165k | Overijssel | 52.2215 | 6.8937 | 10 |
| Apeldoorn | ~165k | Gelderland | 52.2112 | 5.9699 | 10 |

**Backlog (add if coverage gaps):** Haarlem, Arnhem, Amersfoort, Zaanstad, Den Bosch, Zwolle, Haarlemmermeer.

## C — Search term matrix (Dutch)

| Niche | Primary local term(s) | English fallback | Include? |
|-------|----------------------|------------------|----------|
| General repair | `autobedrijf` (dominant), `garagebedrijf`, `autoreparatie`, `automonteur` | `auto repair` | ✅ |
| Tire | `bandenservice`, `bandencentrum` | `tire shop` | ✅ |
| Body | `autoschadeherstel`, `schadeherstelbedrijf`, `plaatwerk` | `auto body shop` | ✅ |
| Paint | `autospuiterij` | `auto painting` | ✅ |
| APK (mixed-use, not standalone chain) | `APK keuringsstation` | — | ⚠️ Survives via array-overlap if also tagged repair |
| EV | `elektrisch autobedrijf` (emerging) | `EV repair` | ✅ optional |
| Motorcycle / truck | — | — | ❌ |

**Recommended primary set for country-wide pass:** `autobedrijf`, `garagebedrijf`, `bandenservice`, `autoschadeherstel`, `autospuiterij`, `automonteur` (6 terms).

## D — Include / exclude

**Include:** Auto repair shop, Tire shop, Auto body shop, Auto painting, Mechanic.

**Exclude:** Car dealer, Used car dealer, Auto parts store, Gas station, Car wash, Motorcycle repair shop, Car rental agency, **Auto glass shop** (Carglass dominates), Towing service, Truck dealer.

**NL-specific judgment call:**
- **DO NOT blanket-exclude `Vehicle inspection`** — many BOVAG-affiliated repair workshops are also APK-approved and tagged with both. Array-overlap semantics (only excluded if ALL categories are in exclude list) handles this correctly: a `["Vehicle inspection", "Auto repair shop"]` row survives, an `["Vehicle inspection"]`-only row gets dropped — exactly what we want.
- BOVAG member-status will be the cleanest filter for ICP but requires scraping bovag.nl member directory.

## E — Data source & tool selection

### Layers evaluated

| Layer | Source | Coverage | Free? | Decision |
|-------|--------|----------|-------|----------|
| Registry | **KvK Handelsregister** API (SBI code `45.20`) | Comprehensive | ❌ **Paid + requires Dutch legal entity** for access. Free Open Dataset is anonymised (no names/KvK numbers). | ❌ **BLOCKED** — see Section F open questions |
| Registry (proxy) | bolddata.nl / Globaldatabase commercial KvK resellers | Comprehensive | Paid one-time export (~€X) | 🟡 Optional — cost/benefit decision |
| Google Maps | compass/crawler-google-places | Universal | $7/1000 | ✅ **PRIMARY** since registry blocked |
| Yellow pages | telefoonboek.nl / openkvk.nl (mirror) | Partial | Scraping | 🟡 Defer |
| Industry assoc | BOVAG (~5,000 workshop members + 4,000 mobility) | Partial member list public | Scraping | ✅ **Secondary** — scrape for "verified" tier tag |
| RDW APK garage list | rdw.nl open data | Partial (APK-approved only) | Open data | ✅ **Secondary** — cross-reference for APK certification |
| Enrichment | MillionVerifier | Universal | Paid | ✅ Use post-import |

### Ranked source stack (final)

1. **Apify Google Maps** — primary; will be the densest scrape of all 4 countries due to NL urban density.
2. **BOVAG member directory scrape** — secondary; cross-reference with placeId/domain for "verified" tier tag.
3. **RDW APK garage open dataset** — secondary; gives APK-cert tag.
4. **MillionVerifier** — email verification.
5. **KvK commercial proxy** — only if Jacob approves paid export (see open questions).

### Dedup keys

1. KvK-nummer (8-digit) — only if commercial proxy purchased; otherwise unavailable
2. `google_place_id`
3. Normalized domain
4. Normalized phone (E.164, +31 prefix)
5. Normalized name + postal code

## F — Scrape execution plan

### Source run order

1. **Apify country-wide pass** (~1.5 hr): customGeolocation covering NL with 6-term set. NL density → expect heavy 500-cap hits, multiple terms may need north/south split.
2. **Apify city-grid passes** (~1.5 hr, wave-of-5): top 12 cities from Section B.
3. **BOVAG member directory scrape** (~30 min): port of `scrape-servicefinder.mjs` pattern (cheerio, $0).
4. **RDW APK garage open dataset pull** (~10 min).
5. **Import to `discovered_shops`** via `import-netherlands-shops.mjs` (copy of `import-czech-shops.mjs`). Match BOVAG + RDW datasets onto GMaps rows by `(normalized_domain, postal_code)` and `(normalized_name, postal_code)`.
6. **Pattern-MV** (`pattern-mv-nl.mjs`): probe `info@ / contact@ / service@ / garage@ / werkplaats@ <domain>` with chain-domain guard.
7. **MillionVerifier sweep**.

### Expected outcome

- **Total unique rows after dedup:** **5,000–9,000** (highest of the 4 markets)
- **Apify credit cost estimate:** **$60–90** (highest)
- **Estimated duration:** 1.5–2 hours wall-clock
- **Estimated % with email (valid+catch_all):** 40–50% — lower than NO/FI because no registry first-party emails; relies entirely on GMaps + pattern-MV

### Go / no-go summary

**Conditional.** NL has the best market opportunity of the 4 (largest fleet, largest workshop count) but the weakest registry layer. Three viable paths:

- **Path A (default, recommended):** GMaps + BOVAG scrape + RDW open data. ~$70 Apify + free scrapes. No KvK numbers but `bovag_member` tag + `apk_approved` tag give us strong ICP signal.
- **Path B:** Commercial KvK proxy (bolddata.nl etc., ~€200-500 one-time). Adds KvK numbers + first-party contact data → matches NO/FI registry experience.
- **Path C:** Skip NL until we have a Dutch legal entity (improbable near-term) → revisit later.

## Open questions for Jacob

1. **KvK paid export decision.** Path A (GMaps + BOVAG + RDW, free) vs Path B (commercial KvK proxy, ~€200-500 one-time). Path A gives ~85% of the data quality of Path B at zero registry cost. **Default to Path A unless Jacob wants the org-number-cleaner data.**
2. **City grid scope.** 12 cities (~$60) vs 19 cities (~$90) — extra 7 mid-tier cities (Haarlem, Arnhem, Amersfoort, Zaanstad, Den Bosch, Zwolle, Haarlemmermeer) add ~$30 for marginal coverage. Default 12, add if first pass shows gaps.
3. **APK array-overlap dependency.** Plan depends on Apify exposing the full `categories[]` array (not just the primary category) so that array-overlap exclude works correctly. Confirm via small test scrape before full launch.
4. **BOVAG scrape ethics.** Public member directory should be scrapable but check ToS before running.
5. **MEKO chain consolidation in NL.** MEKO presence in NL is lighter than NO/SE — main chains are local (Profile, Euromaster, Bosch CS). Less chain-domain dedup pain expected, but verify after first pass.

---

## Actual results (fill in after scrape completes)

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Total rows | 5,000–9,000 |  |  |
| % with email | 40–50% |  |  |
| % with phone |  |  |  |
| Unique cities | 12+ |  |  |
| Apify cost | $60–90 |  |  |
| Duration | 1.5–2 hr |  |  |

**Lessons for next country:**
-

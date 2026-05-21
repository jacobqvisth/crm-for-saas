---
type: scrape-plan
country: Denmark
country_code: DK
status: draft  # draft → approved → in-progress → done
created: 2026-05-21
---

# Scrape Plan — Denmark (DK)

> Step 0 output of [SCRAPE-PLAYBOOK](SCRAPE-PLAYBOOK.md). Lighter pass than NO — sequenced after NO. **Registry layer is partially blocked** (CVR full API requires email credential request to `cvrselvbetjening@erst.dk` — initiate before launch).

## A — Country profile

- **Population:** ~6.0M (2025)
- **GDP per capita (nominal USD 2024):** ~$71,026 (World Bank)
- **Total registered vehicles (Oct 2024):** 4,727,996 (dst.dk)
- **BEV share new cars (2025):** 68.5% year-avg / 80.95% in December (EAFO)
- **Van BEV share (2025):** 30.9%
- **Mandatory inspection regime:** **Periodisk syn** — first at age 4, then every 2 years; all centres privatised under Færdselsstyrelsen. ~235 synshaller (2025), ~51% single-owner / ~49% chain.
- **Dominant chains:**
  - **AutoMester** — DK's largest independent workshop chain (claims ~400 locations, ~100 surface in the sitemap as of 2026-05-21). ✅ **Per-branch pages confirmed** at `automester.dk/find-vaerksted/{shop-slug}` (named sitemap `automester.dk/sitemap-workshops`, listed in robots.txt — NOT in the default `sitemap.xml`). Branch-specific emails verified (`q8tomj@live.dk` at Q8 Autoværksted Fjerritslev, `info@automester-odense.dk` at Odense). Many workshops also have their own branded sub-sites like `automester-odense.dk/vaerksted/vaerksted-profil`.
  - **AutoMester E+** — EV sub-brand, 170+ locations (same parent, same per-branch sitemap structure)
  - **Din Bilpartner** — FTZ/MEKO, 150+ locations. ✅ **Per-branch sitemap pages** at `dinbilpartner.dk/vaerksteder/{shop-slug}/` (sitemap: `adt_shops-sitemap.xml`). Franchisee-unique emails (e.g. `info@dinbilpartneraarhus.dk`).
  - **Bosch Car Service Denmark** — FTZ/Bosch joint
  - **Super Dæk Service (SDS)** — 60+ tire+workshop locations
  - **Quickpoint** — 31 locations
  - **DEKRA / FDM Test & Tjek / Applus Bilsyn** — inspection-only, **EXCLUDE**
  - **CarPeople, Hella Service Partner, 100% Autotjek, DriveClever, CarNetwork** — FTZ franchise concepts
- **Trade bodies:** DI Bilbranchen (~700 members), AutoBranchen Danmark (ABDK)
- **Market quirks:** Long-running EV-friendly registration tax restructuring; AutoMester+FTZ consolidation = MEKO Group concentration similar to NO

## B — Administrative geography

### Top cities (city-grid targets)

| City | Pop | Region | Lat | Lng | Radius (km) |
|------|-----|--------|-----|-----|-------------|
| Copenhagen (København) | 671,714 / metro 1.36M | Hovedstaden | 55.6761 | 12.5683 | 15 |
| Aarhus | 290,598 | Midtjylland | 56.1629 | 10.2039 | 12 |
| Odense | 182,387 | Syddanmark | 55.4038 | 10.4024 | 10 |
| Aalborg | 120,914 | Nordjylland | 57.0488 | 9.9217 | 10 |
| Esbjerg | 71,921 | Syddanmark | 55.4769 | 8.4501 | 8 |
| Randers | 64,057 | Midtjylland | 56.4607 | 10.0369 | 8 |
| Horsens | 63,162 | Midtjylland | 55.8607 | 9.8503 | 8 |
| Kolding | 62,338 | Syddanmark | 55.4904 | 9.4720 | 8 |
| Vejle | 61,310 | Syddanmark | 55.7058 | 9.5378 | 8 |
| Roskilde | 52,580 | Sjælland | 55.6418 | 12.0876 | 8 |
| Herning | 51,193 | Midtjylland | 56.1359 | 8.9740 | 8 |
| Silkeborg | 50,866 | Midtjylland | 56.1697 | 9.5453 | 8 |

## C — Search term matrix (Danish)

| Niche | Primary local term(s) | English fallback | Include? |
|-------|----------------------|------------------|----------|
| General repair | `autoværksted` (dominant), `bilværksted`, `mekaniker`, `bilreparation` | `auto repair` | ✅ |
| Tire | `dækservice`, `dækskifte`, `dækcenter` | `tire shop` | ✅ |
| Body | `autoskadereparation`, `pladearbejde`, `karrosseri` | `auto body shop` | ✅ |
| Paint | `autolakering`, `bilpolering` | `auto painting` | ✅ |
| EV | `elbilværksted` | `EV repair` | ✅ (emerging) |
| Inspection (chains, exclude) | `synshal`, `periodisk syn` | `vehicle inspection` | ❌ standalone |
| Motorcycle / truck | — | — | ❌ |

**Recommended primary set for country-wide pass:** `autoværksted`, `bilværksted`, `dækservice`, `autoskadereparation`, `autolakering`, `elbilværksted` (6 terms).

## D — Include / exclude

**Include:** Auto repair shop, Tire shop, Auto body shop, Auto painting, Mechanic.

**Exclude:** Car dealer, Used car dealer, Auto parts store, Gas station, Car wash, Motorcycle repair shop, Car rental agency, **Vehicle inspection** (FDM/DEKRA/Applus dominate synshaller), **Auto glass shop** (Carglass dominates), Towing service, Truck dealer.

## E — Data source & tool selection

### Layers evaluated

| Layer | Source | Coverage | Free? | Decision |
|-------|--------|----------|-------|----------|
| Registry | **CVR (Det Centrale Virksomhedsregister)** at virk.dk, NACE code `452` ("Vedligeholdelse og reparation af motorkøretøjer") | Comprehensive | Free basic UI; **full Elasticsearch API requires `cvrselvbetjening@erst.dk` credential request** | 🟡 **Initiate request now** — bureaucratic but free. Fallback: commercial cvrapi.dk (paid) |
| Google Maps | compass/crawler-google-places | Universal | $7/1000 | ✅ Primary if CVR blocked |
| Yellow pages | krak.dk (Eniro-owned) | Decent | Scraping required | 🟡 Defer |
| Industry assoc | DI Bilbranchen (~700 members), AutoBranchen Danmark | Partial | Member list partially public | 🟡 Defer for verified tier |
| Enrichment | MillionVerifier | Universal | Paid | ✅ Use post-import |

### Ranked source stack (final)

1. **CVR Elasticsearch API (if credential approved)** — NACE 452. ~comprehensive list.
2. **Chain enumeration + per-branch harvest** — AutoMester DK (~100 via `/sitemap-workshops`) + Din Bilpartner DK (150+ via `adt_shops-sitemap.xml`). Both have franchisee-unique emails. Together that's ~250 chain workshops with branch-level emails — significantly cheaper than scraping each via Apify GM and contributes the bulk of the chain-affiliated coverage.
3. **Apify Google Maps** — gap-fill for indie shops + the remaining chains we haven't audited yet.
4. **Krak.dk / industry assoc** — only if CVR blocked and GMaps + chain coverage thin.
5. **MillionVerifier** — email verification.

### Dedup keys

1. CVR-nummer (8-digit) — only if CVR pull lands
2. `google_place_id`
3. Normalized domain
4. Normalized phone (E.164, +45 prefix)
5. Normalized name + postal code

## F — Scrape execution plan

### Source run order

1. **(IF CVR credential received)** CVR pull for NACE 452 → `import-cvr-dk-shops.mjs` (port of `import-scb-shops.mjs`)
2. **Apify country-wide pass** with 6-term set
3. **Apify city-grid passes** for the 8 largest cities (København, Aarhus, Odense, Aalborg, Esbjerg, Randers, Kolding, Vejle)
4. **Import to `discovered_shops`** via `import-denmark-shops.mjs` (copy of `import-czech-shops.mjs`)
5. **Pattern-MV** (`pattern-mv-dk.mjs`): probe `info@ / kontakt@ / mail@ / service@ / vaerksted@` with chain-domain guard
6. **MillionVerifier sweep**

### Expected outcome

- **Total unique rows after dedup:** ~3,500–5,000
- **Apify credit cost estimate:** $35–45
- **Estimated duration:** ~1 hour
- **Estimated % with email (valid+catch_all):** 45–55% (digitally mature; lower than NO if CVR pull doesn't land, in line with NO if it does)

### Go / no-go summary

**Conditional on CVR credential.** Initiate request to `cvrselvbetjening@erst.dk` ahead of launch. If approved, DK looks like a 2nd-best registry pull after NO. If blocked, plan B is GMaps + Krak.dk + industry-assoc scraping — workable but more manual.

## Open questions for Jacob

1. **CVR credential request.** Send email to `cvrselvbetjening@erst.dk` now to start the clock, or accept commercial proxy (cvrapi.dk / selskabsinfo.dk) for ~€X one-time export?
2. **MEKO chain consolidation in DK.** AutoMester alone is ~400 locations under one corporate domain. Same chain-domain unique-constraint pattern as NO/SE — confirm dedup retry handles `automester.dk` properly.
3. **AutoMester E+ as separate cohort.** EV sub-brand with 170 locations — worth tagging separately and pitching the EV-specific value prop?

---

## Actual results (fill in after scrape completes)

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Total rows | 3,500–5,000 |  |  |
| % with email | 45–55% |  |  |
| % with phone |  |  |  |
| Unique cities | 12+ |  |  |
| Apify cost | $35–45 |  |  |
| Duration | ~1 hr |  |  |

**Lessons for next country:**
-

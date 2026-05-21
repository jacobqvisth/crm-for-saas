---
type: scrape-plan
country: Norway
country_code: NO
status: draft  # draft → approved → in-progress → done
created: 2026-05-21
---

# Scrape Plan — Norway (NO)

> Step 0 output of the canonical [SCRAPE-PLAYBOOK](SCRAPE-PLAYBOOK.md). Awaiting Jacob approval before Apify spend.
>
> **Headline:** NO is the cleanest registry layer of any country we've done besides Sweden. Brønnøysund (`brreg`) exposes a free, auth-free API for ~6,826 motor-vehicle-repair establishments, **already including email + phone for many rows**. Combined with Google Maps via Apify, expect 7,000–8,500 unique workshops, ~50–60% with verifiable email, total Apify spend ~$50.

## A — Country profile

- **Population:** ~5.62M (2025, SSB)
- **GDP per capita (nominal USD 2024):** ~$86,810 (World Bank) — highest of the 4 markets we're targeting
- **Total registered vehicles (Dec 2025):** 5,516,674 (SSB) — ~1 vehicle per resident
- **Passenger cars (~86% of fleet):** ~3.0M
- **Light commercial vehicles (~12%):** ~430k
- **New-car BEV share (2025):** 95.9% (97.6% in December) — world leader
- **EV share of total fleet (end-2025):** ZEVs overtook diesel in 2025; ~33% of total fleet is ZEV, ~67% still fossil
- **Mandatory inspection regime:** **EU-kontroll / PKK** (Periodisk kjøretøykontroll) — every 2 years after vehicle age 4 for passenger cars; annually for >3.5 t; 5-year for 30+ year veterans. Run by Statens Vegvesen-approved stations.
- **Dominant aftermarket chains:**
  - **MECA** — ~360 NO locations, MEKO Group, largest NO workshop chain
  - **Mekonomen** — second largest, MEKO Group
  - **BilXtra** — NO-only, MEKO Group (Sørensen og Balchen)
  - **AutoMester** — FTZ/MEKO franchise
  - **Vianor** — Nokian/Goodyear tire+service, 100+ NO locations
  - **Fixus** — MEKO Group (smaller in NO than SE/FI)
  - **Bosch Car Service** — international franchise, smaller NO footprint
  - **NAF Senter** — auto-club consumer-facing inspection/test centers, **EXCLUDE** (chain)
- **Market quirks:**
  - Highest EV penetration globally → `elbilverksted` (EV specialist) is a real, growing subsegment; less long-tail demand for engine/exhaust/oil-only shops
  - Population concentrated in Oslo + south coast; Tromsø / Bodø sparse hinterland
  - High Nordic VAT (25% MVA) and labour rates → workshop economics very different from CZ/SK/RS
  - **MEKO Group consolidation = ~30%+ of organised workshops under one corporate roof** → chain-domain dedup will be material; `mekonomenbilverkstad.no`, `bilxtra.no`, `mecaverksted.no`, `fixus.no` will collide heavily on the unique-domain constraint
- **Registered workshop establishments (live brreg count, 2026-05-21):** **7,428 enheter / 6,826 underenheter** under code `95.310` ("Reparasjon og vedlikehold av motorvogner")

## B — Administrative geography

### Counties (15 fylker, post-2024 reform)

| County | Population | Notes |
|--------|-----------|-------|
| Oslo | ~717k | Capital |
| Akershus | ~720k | Re-established 2024 |
| Østfold | ~315k | Re-established 2024 |
| Buskerud | ~270k | Re-established 2024 |
| Innlandet | ~370k | Kept merged (Oppland+Hedmark) |
| Vestfold | ~250k | Re-established 2024 |
| Telemark | ~175k | Re-established 2024 |
| Agder | ~315k | Kept merged |
| Rogaland | ~490k | |
| Vestland | ~640k | Kept merged (Hordaland+Sogn og Fjordane) |
| Møre og Romsdal | ~265k | |
| Trøndelag | ~480k | Kept merged |
| Nordland | ~240k | |
| Troms | ~170k | Re-established 2024 |
| Finnmark | ~75k | Re-established 2024 |

### Top cities (city-grid targets)

Cities >40k pop warrant individual grids to dodge the 500-cap on country-wide passes.

| City | Population | Lat | Lng | Radius (km) | Expected shops |
|------|-----------|-----|-----|-------------|-----------------|
| Oslo | 1,082,575 (urban region) | 59.9139 | 10.7522 | 20 | ~1,000–1,300 |
| Bergen | 269,548 | 60.3913 | 5.3221 | 15 | ~400 |
| Stavanger/Sandnes | 234,757 | 58.9700 | 5.7331 | 15 | ~300 |
| Trondheim | 196,948 | 63.4305 | 10.3951 | 12 | ~300 |
| Drammen | 122,955 | 59.7440 | 10.2045 | 10 | ~150 |
| Fredrikstad/Sarpsborg | 120,332 | 59.2181 | 10.9298 | 12 | ~150 |
| Skien/Porsgrunn | 95,763 | 59.2096 | 9.6090 | 10 | ~120 |
| Kristiansand | 66,576 | 58.1467 | 7.9956 | 10 | ~100 |
| Tønsberg | 55,387 | 59.2674 | 10.4076 | 8 | ~70 |
| Ålesund | 55,386 | 62.4722 | 6.1495 | 8 | ~70 |
| Moss | 49,428 | 59.4356 | 10.6592 | 8 | ~60 |
| Haugesund | 46,359 | 59.4137 | 5.2680 | 8 | ~60 |
| Arendal | 44,856 | 58.4615 | 8.7724 | 8 | ~60 |
| Bodø | 42,831 | 67.2804 | 14.4049 | 8 | ~50 |
| Tromsø | 41,915 | 69.6492 | 18.9553 | 10 (sparse hinterland) | ~60 |

## C — Search term matrix (Bokmål)

| Niche | Primary local term(s) | English fallback | Include? | Notes |
|-------|----------------------|------------------|----------|-------|
| General repair / mechanic | `bilverksted`, `bilmekaniker`, `verksted bil` | `auto repair`, `car workshop` | ✅ | `bilverksted` is dominant — confirmed via brreg + SERP |
| Tire shop | `dekkverksted`, `dekkservice`, `dekkhotell`, `dekk og felg` | `tire shop` | ✅ | `dekkverksted` dominant (Vianor URL slug) |
| Body shop | `bilskadeverksted`, `karosseriverksted`, `karosseri og skadecenter` | `auto body shop` | ✅ | Karosseri widely used standalone |
| Paint | `billakkering`, `billakk`, `autolakering` | `auto painting` | ✅ | `billakkering` most common (1881.no slug) |
| Inspection / EU-kontroll | `EU-kontroll`, `PKK`, `periodisk kjøretøykontroll` | `vehicle inspection` | ⚠️ Mixed | Pulls mainly Mekonomen/Vianor/MECA/NAF — **dominated by chains**. Skip as standalone search; rely on chain workshops already captured by general-repair terms. See Section D for category exclusion rule. |
| EV specialist | `elbilverksted`, `elbil service`, `elbil reparasjon` | `EV repair` | ✅ | Useful as search term to widen discovery. **NOT a separate sequence** (Jacob, 2026-05-21) — absorb into general NO sequence. |
| Truck / heavy | `lastebilverksted`, `tungbilverksted` | `truck repair` | ❌ | Skip — not ICP for Wrenchlane |
| Motorcycle | `motorsykkelverksted` | `motorcycle repair shop` | ❌ | Skip — not ICP |

**Recommended primary set for country-wide pass:** `bilverksted`, `bilmekaniker`, `dekkverksted`, `karosseriverksted`, `billakkering`, `elbilverksted` (6 terms).

## D — Include / exclude list

> **Array-overlap semantics reminder.** A shop is excluded only if **every** category in its `categories[]` array is in the exclude list. A shop tagged `["Vehicle inspection", "Auto repair shop"]` survives even with inspection excluded.

**Include categories (any match → keep):**
- Auto repair shop
- Tire shop
- Auto body shop
- Auto painting
- Mechanic

**Exclude categories (only if *all* of a shop's categories are in this list):**
- Car dealer
- Used car dealer
- Auto parts store
- Gas station
- Car wash
- Motorcycle repair shop
- Car rental agency
- **Vehicle inspection** ← NO-specific addition: PKK stations dominated by chains (NAF Senter, Mekonomen-PKK, Vianor-PKK). Workshops that *also* offer PKK survive thanks to array-overlap semantics.
- Towing service
- Truck dealer
- Auto glass shop ← RYDS Bilglass / Carglass dominated; not ICP

**Edge cases / NO-specific judgment calls:**
- `Electric vehicle charging station` — exclude unless combined with repair signals
- MECA / Mekonomen / BilXtra branches: keep, but expect heavy chain-domain dedup collisions (one corporate domain → many branches)
- **NAF Senter — INCLUDE** (Jacob, 2026-05-21). No name-regex exclusion. They do small repairs alongside PKK.

## E — Data source & tool selection

### Layers evaluated

| Layer | Source | Coverage for NO | Free? | Apify actor available? | Decision |
|-------|--------|-----------------|-------|------------------------|----------|
| Registry | **Brønnøysund Enhetsregisteret** | 7,428 enheter / 6,826 underenheter under code 95.310 | ✅ Free, no auth | N/A (direct REST API) | ✅ **PRIMARY** — build SCB-equivalent integration |
| Google Maps | compass/crawler-google-places | Universal | $7/1000 places | ✅ Yes | ✅ Use for placeId + cert flags + ratings + categories |
| Yellow pages | gulesider.no (Eniro) | Decent | Free with scraping | Custom | ❌ Skip — brreg gives better data |
| **Chain sitemap / search-endpoint harvest (NEW)** | Per-chain XML sitemap OR server-rendered search/list endpoint OR slug-from-name URL pattern | **~1,150 NO workshops across 5 chains** (Mekonomen 279 / BilXtra 270 / MECA 351 / AutoMester ~120 / Vianor ~120) — server-rendered with **franchisee-unique branch emails** | ✅ Free | Custom scraper (cheerio) | ✅ **SECONDARY** — bypasses shared-inbox trap for these chains |
| Industry assoc | NBF (Norges Bilbransjeforbund), ~1,700 members | Partial (brand dealers + larger shops) | Member list partially public | Custom | 🟡 Defer — use for "verified tier" tagging if first scrape leaves gaps |
| Facebook Pages | — | — | — | — | ❌ Skip |
| Enrichment | MillionVerifier (existing wrapper) | Universal | Paid | N/A | ✅ Use for email verification post-import |

### Ranked source stack (final)

1. **Brønnøysund Enhetsregisteret (`brreg`) — primary registry pull.** Free, auth-free REST API. Fetches all 6,826 `underenheter` (establishments) under code `95.310`. Contributes: `organisasjonsnummer`, `navn`, `naeringskode1`, `postadresse`, `forretningsadresse`, `kommune`, `epostadresse`, `mobil`, `aktivitet`. **Critically, many rows already include email + phone** — unlike SCB this is a step beyond what Sweden gave us.
2. **Chain enumeration + per-branch harvest (NEW, 2026-05-21 audit — revised).** Scrape per-branch HTML pages for **5 GREEN chains, ~1,150 workshops total**. Three enumeration routes — use whichever the chain exposes first:
   - **Mekonomen NO** (279): named sitemap `mekonomen.no/workshop-locations-sitemap1.xml`, pattern `/bilverksteder/{city}/{slug}`, confirmed branch emails like `anton@autobjorn.no`
   - **BilXtra NO** (270): pattern `/bilxtraverksted/bilverksted/{city}/{slug}`, SSR Next.js, confirmed `post@adenabilservice.no`
   - **MECA NO** (351): sitemap `meca.no/workshops-sitemap1.xml`, pattern `/bilverksted/{city}/{slug}`. **Live domain is `meca.no` — `mecaverksted.no` is dead.**
   - **AutoMester NO** (~120): two enumeration routes — (a) server-rendered search `automester.no/søk-verksted/?s={postcode}&lat={lat}&lng={lng}` returns the full national list from one query (verified 2026-05-21), or (b) slugify each workshop name → `automester.no/{name-slugified}/`. Branch emails confirmed (`verksted@auto-proffen.no`, `post@sortlandbil.no`).
   - **Vianor NO** (~120, flipped from RED in re-audit): listing `vianor.no/verksteder/`, pattern `/verksteder/vianor-{city-area}/`. Branch emails are city-prefixed `@vianor.com` (e.g. `bryn@vianor.com`, `furuset@vianor.com`, `kokstad@vianor.com`) — **same root domain, but each branch has its own unique inbox** = no shared-inbox trap.

   Builds on the `scrape-servicefinder.mjs` cheerio pattern. Most franchisees use their own domain → also bypasses the chain-domain unique constraint.
3. **Apify Google Maps Scraper — gap-fill + enrichment.** Contributes: `placeId`, website, ratings, review counts, opening hours, all categories (for ICP classification), photo URL, lat/lng coords for routing. Catches indie shops + the 2 RED chains (Bosch CS NO has only city-aggregator pages with no branch contact; NAF Senter NO is centrally operated, branch URLs exist but display only the national `08505` line — no per-branch email exists anywhere on the site). **Note:** Euromaster NO and Fixus NO are removed from the chain list — Euromaster Norway is served by `euromaster.se`, Fixus NO domain is parked at HostUp.
4. **MillionVerifier — email verification.** Universal final stage; valid 90d / invalid 30d / risky 7d cache.

### Dedup keys (priority order)

Built into `scripts/lib/shop-merger.mjs:20-83`:
1. `org_number` (brreg-provided — primary for NO since registry runs first)
2. `google_place_id`
3. Normalized domain (with chain-domain `domain=NULL` retry pattern)
4. Normalized phone (E.164, +47 prefix)
5. Normalized name + postal code
6. Partial org_number + normalized name

## F — Scrape execution plan

### Source run order

1. **brreg bulk pull** (free, ~5 min): fetch all `underenheter` with `naeringskode=95.310` via `https://data.brreg.no/enhetsregisteret/api/underenheter?naeringskode=95.310&size=N` (paginated). Persist to staging at `~/crm-for-saas/scripts/data/brreg-95310.json`. Build `import-brreg-no-shops.mjs` mirroring `import-scb-shops.mjs` — idempotent on `(workspace_id, organisasjonsnummer)`. Pre-claim domains workspace-wide; on 23505 retry with `domain=NULL`.
2. **Chain-sitemap harvest** (~30 min, free): build `scrape-no-chains.mjs` (cheerio, port of `scrape-servicefinder.mjs`). For each of Mekonomen NO / BilXtra NO / MECA NO / AutoMester NO: fetch sitemap → fetch each branch page → extract franchisee name, address, branch email, branch phone, website. Persist to `~/crm-for-saas/scripts/data/no-chains-{brand}.json`. Run BEFORE the Apify GM pass so chain-branch rows already exist when GMaps tries to insert them — GMaps then matches by `google_place_id` and attaches photo/rating to the existing row rather than creating duplicates.
3. **Apify country-wide pass** (~1 hr): `customGeolocation` covering Norway with the 6-term set. Expected ~3,000–5,000 places after Apify-side dedup. `bilverksted` will likely hit the 500-cap and need to be split by region.
4. **Apify city-grid passes** (~1 hr, parallel where memory allows — recall the 60-job concurrent cap from SE pilot, wave-of-5): top 8 cities (Oslo, Bergen, Stavanger/Sandnes, Trondheim, Drammen, Fredrikstad/Sarpsborg, Kristiansand, Tromsø). Same 6-term set + radius from city table.
5. **Import to `discovered_shops`** via copy of `import-czech-shops.mjs` → `import-norway-shops.mjs`. Run order matters: brreg → chain-sitemap → GMaps. After brreg has populated `org_number` + `email` for many rows, the chain-sitemap import overlays branch-specific emails (which override registry generic emails). The GMaps import then uses placeId+phone as the dedup key, attaching `google_place_id` and website to existing rows rather than creating duplicates.
6. **Pattern-MV for website-yes/email-no rows** (`pattern-mv-no.mjs`, port of `pattern-mv-se.mjs`): best-effort probe of `info@ / post@ / firmapost@ / kontakt@ / verksted@ <domain>` (Norwegian conventions). Apply >3-rows-per-domain chain guard. **Companies with no valid mailbox still get imported** (Jacob, 2026-05-21) — they land in CRM as un-emailable rows tagged `needs_email_backfill`; a later workstream finds emails manually.
7. **MillionVerifier sweep**: `node scripts/verify-emails.mjs --country NO --concurrency 80 --only-null --limit 400 --no-snapshot` until exhausted.

### Google Maps passes

- **Country-wide terms (500-cap each):** `bilverksted`, `bilmekaniker`, `dekkverksted`, `karosseriverksted`, `billakkering`, `elbilverksted` (6 terms). `bilverksted` may need to be split by north/south halves if it caps.
- **City-grid terms (run per city from Section B):** same 6 terms per city.

### Expected outcome (revised 2026-05-21 after brreg survey)

- **Total unique rows after dedup:** ~7,000–8,500 (brreg's 6,826 underenheter is the floor — anything above comes from GMaps placeIds that brreg missed or that don't have an org number)
- **Apify credit cost estimate:** ~$50 ($21 country-wide + $28 city grids; assumes ~3,000 effective paid places after dedup)
- **Estimated duration:** 2–2.5 hours wall-clock including brreg pull + chain-sitemap harvest + Apify + import
- **Estimated % with email (REVISED DOWN):** **~45–55% valid+catch_all** after MillionVerifier. Realistic build-up:
  - brreg supplies email for **16.5%** of rows (1,127 of 6,826) — much lower than initial 30% estimate. Of those, ~50% are personal mailboxes (gmail/hotmail/online.no/icloud) — ingest separately.
  - Chain-sitemap supplies branch-unique emails for ~1,150 MEKO-group + Vianor branches (~15% of total)
  - Apify GM scrapes email for ~30-40% of long-tail indies (~1,500 rows)
  - Pattern-MV recovers another ~5-10% from websites-yes/email-no rows
- **Estimated % with phone:** ~80%+ (brreg supplies 32%, GMaps fills the rest)
- **Brreg survey findings (2026-05-21):**
  - 6,807/6,826 (99.7%) have `beliggenhetsadresse.kommune` — geo is clean (top cities: Oslo 383, Bergen 257, Trondheim 194, Kristiansand 151, Lillestrøm 128 …)
  - **Chain-detection via `overordnetEnhet` (parent org) is the canonical signal — NOT name-regex.** Top parents:
    - Carglass AS (110 branches) → out-of-ICP glass, **exclude at import**
    - Norsk Scania (47) + Bertel O. Steen LB (14) + Trucknor (12) + Nordic Last of Buss (15) ≈ 88 truck/heavy → **exclude at import**
    - MEKO Bilverksted AS (30) → tag `meko-group`
    - NAF AS (28), Snap Drive (31), Team Verksted (21), Werksta (16), Tesla bodyshop (21), Bilia (17), Hedin BMW (11), Nordvik (20) → tag as chain branches
  - Noise (Jacob's call = accept): vask/wash (108), bilglass (127), billakk (118) ≈ 5%

### Go / no-go summary

**Recommend proceed.** NO is the second-cleanest country we've done after SE thanks to brreg. The integration cost is one new importer script (`import-brreg-no-shops.mjs`, modeled on `import-scb-shops.mjs`) that we'd want anyway for future Nordic countries. Expected reply rate should match or exceed SE given the better email coverage. Two open questions block 100% confidence:

- **brreg code `95.310` is wider than tight workshops** — a sample query returned a car-wash/polishing business. Expect ~5–10% category noise (mitigate with name+aktivitet regex at import).
- **MEKO chain-domain consolidation** — `mekonomenbilverkstad.no`, `bilxtra.no`, etc. will collide heavily on `companies_domain_workspace_unique`. The PR #170 chain-domain retry pattern handles it, but the resulting "one chain → one company → many branches contacts" data model still has the shared-inbox dedup gotcha ([[project_crm-scb-shared-inbox-dedup]]). **Pre-flight check before bulk enrolling the NO sequence is mandatory.**

## Decisions locked (Jacob, 2026-05-21)

1. **brreg category noise — ACCEPT.** No aktivitet/name regex filter at import. ~5–10% car-wash / detailing rows will land in `discovered_shops` and get filtered downstream via `shop_type` if at all.
2. **EV specialist — NOT a separate sequence.** Absorb `elbilverksted` matches into the general NO sequence. Keep the search term in the country-wide pass for widening discovery.
3. **NAF Senter — INCLUDE.** No name-regex exclusion.
4. **Pattern-MV — best-effort, not a gate.** Companies that still have no valid mailbox **get imported anyway** with `needs_email_backfill` tag — a later workstream finds emails manually / via other means.

## Open question still pending

- **brreg email field ingestion path.** brreg's `epostadresse` is first-party (different from scraped GMaps emails). Confirm the `import-brreg-no-shops.mjs` importer ingests these into `contacts.email` directly without going through MillionVerifier first (they're registry-grade signal, not pattern guesses). Decision needed before the importer script is written.

## Pre-launch chain-dedup audit (2026-05-21)

Snapshot of the prod CRM to size the chain-collision risk before importing NO. Source: live Supabase queries against `wdgiwuhehqpkhpvdzzzl`.

### Current CRM state for NO

- **1 NO company in `companies`** today (essentially clean slate). Importer collisions will be measured against the ~7,000 net-new rows brreg+GMaps will land.

### Chain-domain collision pattern (PR #170 retry) is working as designed

- 7,808 of 11,131 SE companies (70%) have `domain=NULL`. 1,164 of those still have a website set — exactly the "chain root keeps domain, branch loses it" PR #170 pattern.
- GB: 218 of 239 NULL-domain rows have a website set (heavy chain consolidation).
- LT: 181 of 182 NULL-domain rows have a website set (almost all collisions).
- **Implication for NO:** MEKO-group branches (Mekonomen, MECA, BilXtra, Fixus, Din Bilpartner) will land as `domain=NULL` rows with their `website` populated. The branch survives as a row; the domain just doesn't appear on every branch. This is correct behavior.

### Shared-inbox history (top hits, all-time)

Confirmed shared-inbox dedup is a real recurring problem — not a one-off Autoexperten event:

| to_email | times queued | sent | cancelled | category |
|----------|-------------:|-----:|----------:|----------|
| `kundservice@autoexperten.se` | 174 | 35 | 138 | SE 82-branch chain — the canonical incident |
| `info@saulesspektras.lt` | 64 | 29 | 35 | LT — single business duplicated heavily in source |
| `gen.se.gdpr@euromaster.com` | 62 | 8 | 54 | **Euromaster SE GDPR mailbox** — MEKO-adjacent (Michelin), present in all 4 target countries |
| `kundservice@hyundai.se` | 48 | 9 | 38 | Hyundai SE dealer mailbox |
| `limmared@mekopartner.se` | 24 | 6 | 17 | Mekopartner branch — MEKO Group |
| `koncept@meko.com` | 10 | 2 | 8 | MEKO Group corporate |
| `customer.relationship@euromaster.com` | 8 | 5 | 1 | **Euromaster again** — different mailbox same parent |

**Net-new findings vs the existing memory ([[project_crm-scb-shared-inbox-dedup]]):**

1. **Euromaster will repeat the Autoexperten incident in NO** unless guarded for. They operate in NO/DK/FI/NL and route GDPR/customer-service mail to one corporate mailbox. **Add `euromaster.com` to the shared-inbox watchlist before the NO scrape lands.**
2. **MEKO corporate (`meko.com`, `mekopartner.se`) also showing collisions** — chain root mailboxes that get scraped onto every branch's record.

### Random non-ICP that snuck through prior scrapes (cleanup TODO)

`anglingcorrespondence@daera-ni.gov.uk` (UK fisheries gov dept), `donate@opencart.com`, `cycle2.work@halfords.co.uk`, `customerservice@q-park.co.uk`, `evanshalshaw@rbmgrp.com`. **Not blocking for NO** — these are pre-NO data hygiene; flag for the next CRM cleanup pass.

### Pre-NO-launch checklist (derived from audit)

Before running the NO scrape:

1. ☐ **Confirm `import-brreg-no-shops.mjs` uses the `domain=NULL` retry pattern** on `companies_domain_workspace_unique` 23505 — matches `import-scb-shops.mjs:230-244`.
2. ☐ **Pre-flight shared-inbox dedup query** to be run AFTER `discovered_shops` populates and BEFORE bulk enroll (per [[project_crm-scb-shared-inbox-dedup]]):
   ```sql
   SELECT primary_email, COUNT(*) FROM discovered_shops
   WHERE country_code = 'NO' AND primary_email IS NOT NULL
   GROUP BY primary_email HAVING COUNT(*) > 1 ORDER BY 2 DESC;
   ```
3. ☐ **Shared-inbox watchlist domains for NO** (auto-cancel enrollments if `to_email` ends in these): `meko.com`, `mekonomen.no`, `mekonomenbilverkstad.no`, `bilxtra.no`, `mecaverksted.no`, `mecabilservice.no`, `fixus.no`, `dinbilpartner.no`, `automester.no`, `boschcarservice.no`, `vianor.no`, `euromaster.com`, `euromaster.no`, `naf.no`, `nafsenter.no`.
4. ☐ **Bulk enroll via `enrollContacts()`, never SQL** — per [[feedback_enrollcontacts-not-sql]].
5. ☐ **Lemlist-csv tag guard.** No prior NO Lemlist history exists, so this is moot for NO — but apply the same `ALREADY_SEQUENCED_TAGS` guard for any future Norwegian Lemlist import.

---

## Actual results (fill in after scrape completes)

| Metric | Planned | Actual | Delta |
|--------|---------|--------|-------|
| Total rows | 7,000–8,500 |  |  |
| % with email | 50–60% |  |  |
| % with phone | 80%+ |  |  |
| Unique cities | 15+ |  |  |
| Apify cost | ~$50 |  |  |
| Duration | 1.5–2 hr |  |  |
| brreg category-noise % | <10% |  |  |

**Lessons for next country (DK/FI/NL):**
-

---
type: scrape-plan
country: <Country Name>
country_code: <CC>
status: draft  # draft → approved → in-progress → done
created: YYYY-MM-DD
---

# Scrape Plan — <Country Name> (<CC>)

> This plan is the Step 0 output of the `scrape` skill. Jacob reviews and approves it before any Apify credit is spent. Sections A–F must all be filled in.

## A — Country profile

- **Population:**
- **GDP per capita:**
- **Registered passenger cars:**
- **Registered light commercial vehicles:**
- **Cars per 1,000 people:**
- **EV share of new sales / EV share of stock:**
- **Mandatory inspection regime:** (name + cycle, e.g. besiktning every 2 years)
- **Import tax / fleet notes:**
- **Dominant brands / aftermarket chains:**
- **Other market quirks worth flagging:**

## B — Administrative geography

### Regions
| Region | Population | Notable cities | Estimated shops |
|--------|-----------|----------------|-----------------|

### Top cities (city-grid targets)
Cities above ~50k population usually warrant an individual city-grid pass to avoid the 500-cap on country-wide queries.

| City | Population | Lat | Lng | Radius (m) | Expected shops |
|------|-----------|-----|-----|------------|----------------|

## C — Search term matrix

| Niche | Primary local term(s) | English fallback | Include? | Notes |
|-------|----------------------|------------------|----------|-------|
| General repair / mechanic |  |  | ✅ |  |
| Tire shop |  |  |  |  |
| Body shop / paint |  |  |  |  |
| Inspection / MOT |  |  |  |  |
| EV specialist |  |  |  |  |
| Brand / chain specialist |  |  |  |  |
| Truck / heavy / commercial |  |  |  |  |
| Motorcycle |  |  | ❌ |  |

## D — Include / exclude list

> **Array-overlap semantics.** Google Maps returns a `categories[]` array per shop (typically 1–3 tags), not a single label. A shop is **excluded only if every one of its categories is in the exclude list**. A shop with e.g. both `"ATV repair shop"` and `"Auto repair shop"` survives even if `"ATV repair shop"` is excluded. Express decisions below as category-string sets; the filter will be applied to `all_categories`, not to `category`.

**Include categories (any match → keep):**
- Auto repair shop
- (add per country)

**Exclude categories (only if *all* of a shop's categories are in this list):**
- Car dealer
- Used car dealer
- Auto parts store
- Gas station
- Car wash
- Motorcycle repair shop
- Car rental agency
- (add per country with reasoning)

**Edge cases / judgment calls for this country:**
-

## E — Data source & tool selection

### Layers evaluated
| Layer | Source | Coverage for this country | Free? | Apify actor available? | Decision |
|-------|--------|---------------------------|-------|------------------------|----------|
| Registry |  |  |  |  |  |
| Google Maps | compass/crawler-google-places | — | No | Yes | — |
| Yellow pages |  |  |  |  |  |
| Industry association |  |  |  |  |  |
| Facebook Pages |  |  |  |  |  |
| Enrichment (Prospeo / Vibe) |  |  |  |  |  |

### Ranked source stack (final)
1. **(primary)** — what it contributes
2. **(gap fill)** — what it contributes
3. **(ICP-matched)** — what it contributes
4. **(enrichment)** — what it contributes

### Dedup keys
Priority order for merging duplicates across sources:
1. VAT / org number (if registry layer present)
2. `google_place_id`
3. Normalized domain
4. Normalized phone (E.164)

## F — Scrape execution plan

### Source run order
1. <source>: <what it fetches, expected rows, actor + input summary>
2. <source>: ...

### Google Maps passes
- **Country-wide terms (500-cap each):**
- **City-grid terms (run per city from section B):**

### Expected outcome
- Total unique rows after dedup: ~<N>
- Apify credit cost estimate: ~$<X> (Google Maps Scraper = $7 per 1,000 places)
- Estimated duration: <X> hours
- Estimated % with email / phone: <E%> / <P%>

### Go / no-go summary
One-paragraph recommendation for Jacob: should we proceed as planned, or are there open questions?

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

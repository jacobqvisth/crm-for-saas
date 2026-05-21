---
type: playbook
status: active
created: 2026-05-21
updated: 2026-05-21
tags: [scrape, enrich, discovery, icp, apify, scb, mv]
---

# Scrape & Enrich Playbook — canonical pipeline for a new country

> **Purpose.** Single source of truth for how Wrenchlane discovers + enriches + promotes auto-repair workshops in a new country. Distilled from 10 country campaigns (Stockholm pilot → full SE via SCB, EE, LV, LT, SK, RS, CZ, GB; TZ planned). Every step names the exact script to run, the inputs it expects, and the quality gate before moving on.
>
> **Not in scope here:** the Step-0 planning template — that's `scrape-plan-template.md` in this folder. Per-country plans (`scrape-plan-<CC>.md`) live in this folder too and are the runnable inputs to Step 1.
>
> **For contractors (Kundbolaget product), use the separate `scrape-contractors` skill** — different Supabase project (`ugibcnidxrhcxflqamxs`), different ICP. This playbook is auto-repair / Wrenchlane CRM only (`wdgiwuhehqpkhpvdzzzl`).

---

## TL;DR — the 7 steps (was 6; added chain-sitemap layer 2026-05-21)

| Step | What | Output | Authoritative script(s) |
|------|------|--------|--------------------------|
| 0 | Plan + Jacob approves | `scrape-plan-<CC>.md` | `scrape-plan-template.md` |
| 1 | Registry pull (if country has SCB-equivalent) | Org-numbered rows in staging | `import-scb-shops.mjs` (SE), `import-brreg-no-shops.mjs` (NO TBD), `import-prh-fi-shops.mjs` (FI TBD) |
| 2 | **Chain-sitemap harvest** (NEW) — scrape per-branch HTML pages from chain sitemaps for franchisee-unique emails | Branch rows with branch-specific email/phone | Custom cheerio scrapers (port of `scrape-servicefinder.mjs`); see "Chain sitemap layer" below |
| 3 | Launch Apify Google Maps | `scrape_runs` + run IDs file | `start-sweden-runs.mjs` (template), or inline `mcp__Apify__call-actor` |
| 4 | Poll → reconcile → recover | All runs SUCCEEDED | `poll-sweden-runs.mjs`, `reconcile-sweden-runs.mjs`, `retry-pending-sweden-runs.mjs` |
| 5 | Import to `discovered_shops` (with dedup cascade) | Rows in staging | `import-czech-shops.mjs` (canonical template) |
| 6 | Email enrichment + verification | `email_status` populated | `pattern-mv-<cc>.mjs` then `verify-emails.mjs --country <CC>` |
| 7 | Promote to CRM + enroll in sequence | Companies/contacts in CRM, enrolled | Discovery UI → `enrollContacts()` (never SQL) |

---

## Chain sitemap layer (added 2026-05-21)

**Why this exists.** Major auto-repair chains (Mekonomen, BilXtra, MECA, AutoMester, Din Bilpartner, BDS) split into two camps:

- **GREEN — sitemap-friendly:** publish a sitemap of per-branch HTML pages, each with franchisee-unique email + phone (often on the franchisee's own domain, e.g. `post@adenabilservice.no`). Scrape per-branch, get clean branch-level contact data.
- **RED — shared-inbox trap:** route every branch to one corporate mailbox (e.g. `kundservice@autoexperten.se`, `automester@automester.dk`, `gen.se.gdpr@euromaster.com`). If we rely on these emails, we hit one inbox N times and burn the chain instantly.

**Pattern** (`scrape-servicefinder.mjs` is the canonical cheerio template):
1. **Enumerate workshops** — try in this order until one works (revised 2026-05-21 after the audit gap):
   - **(a) Named sitemap from robots.txt.** Fetch `<chain-domain>/robots.txt` first — chains often expose non-default sitemap routes like `sitemap-workshops`, `workshop-locations-sitemap1.xml`, `adt_shops-sitemap.xml`. Don't assume `sitemap.xml`.
   - **(b) Server-rendered search/list endpoint.** Try the locale-appropriate "find a workshop" URL with query params (e.g. `automester.no/søk-verksted/?s=2072&lat=60.25&lng=11.20` returned all 120 NO workshops from one query). The map UI may be JS, but the search results URL is usually plain HTML.
   - **(c) Slug-from-name construction.** If the chain doesn't have (a) or (b) but you have workshop names from anywhere (a partner list, an industry directory, even GMaps), slugify each name → try `<chain-domain>/{slug}/`. AutoMester NO works this way: `Auto Proffen AS` → `/auto-proffen-as/`.
2. **For each branch URL, fetch HTML** → extract name, address, branch email, branch phone, website.
3. **Persist** to `~/crm-for-saas/scripts/data/<cc>-chains-<brand>.json`.
4. **Run BEFORE the Apify GM pass** so branches already exist; GMaps then matches via placeId+phone and attaches photo/ratings rather than creating duplicates.

**Country audit cache (last updated 2026-05-21 — revised after audit-gap correction):**

| Country | GREEN chains (scrape per-branch — branch-unique emails) | RED chains (no branch-level email exists; rely on registry/pattern-MV) |
|---------|---------------------------------------------------------|--------------------------------------------------------------------------|
| **NO** | Mekonomen (279), BilXtra (270), MECA (351) `meca.no/bilverksted/`, AutoMester (~120) via `/søk-verksted/` search-endpoint + `/{name-slug}/` URL pattern, **Vianor (~120) `/verksteder/vianor-{city-area}/` with `{slug}@vianor.com` branch emails** | Bosch CS (JS widget only), NAF Senter (centrally operated, branch URLs exist but only show national `08505` line, no per-branch email anywhere). **Removed from list:** Euromaster NO (no NO entity, served by euromaster.se), Fixus NO (domain parked) |
| **SE** | Mekonomen, BDS (`/verkstad/{slug}`), MECA SE (`/hitta-verkstad/{city}/{slug}`) | **Autoexperten** (canonical trap — only `kundservice@autoexperten.se`), Euromaster SE (regional aggregator only) |
| **DK** | **AutoMester DK (~100 via `/sitemap-workshops` + pattern `/find-vaerksted/{slug}` — flipped from RED in re-audit. Branch emails confirmed: `q8tomj@live.dk`, `info@automester-odense.dk`)**, Din Bilpartner (150+, `/vaerksteder/{slug}` with `info@dinbilpartner{city}.dk`) | (none confirmed RED yet — re-audit if smaller chains surface) |
| **FI** | Mekonomen FI (`/shops/{slug}/` with `huolto@tiikeritarha.fi`) | Fixus FI (aggregator only — not re-audited with new playbook) |
| **NL** | (not audited yet — re-audit using the 3-route enumeration before launch) | (not audited yet) |

**Audit-gap lesson (2026-05-21).** The first NO/DK audit relied on `sitemap.xml` and gave up on JS-rendered map UIs. That missed: (a) AutoMester DK's `/sitemap-workshops` (in robots.txt), (b) AutoMester NO's server-rendered `/søk-verksted/` endpoint, (c) Vianor NO's `/verksteder/` listing. The 3-route enumeration above is the corrected playbook. **For every future country, run through all 3 routes before classifying a chain as RED.**

**Critical correction:** `mecaverksted.no` is dead — MECA NO lives at `meca.no/bilverksted/`. Update any reference using the old domain.

**Trade-off vs Apify GM.** Sitemap scrape is free + delivers branch-unique emails (Apify GM picks up the chain shared inbox). But sitemap scrape only covers chain-affiliated workshops (~15-20% of a country's total). Always run BOTH: chain-sitemap for the chains, Apify GM for the long tail of independent shops.

---

## Step 0 — Plan and get Jacob's approval

Copy `_reference/scrape-plan-template.md` → `_reference/scrape-plan-<CC>.md`. Fill Sections A–F (country profile, geography, search-term matrix, include/exclude categories, source stack, execution plan).

**Quality gate:** Jacob approves before any Apify spend.

**Look at past plans as precedents:**
- `scrape-plan-CZ.md` — the most mature "actual results + lessons learned" template
- `scrape-plan-SK.md` — country-wide + city-grid + brand-anchor pattern
- `scrape-plan-RS.md` — emerging-market template (acknowledges low email coverage)
- `scrape-plan-TZ.md` — non-EU template (Swahili+EN terms, RHD Japanese imports, phone-first)

---

## Step 1 — Launch Apify Google Maps

**Actor:** `compass/crawler-google-places` (universal primary source, used in 9 of 10 countries).

**Canonical input shape** (see `~/crm-for-saas/scripts/start-sweden-runs.mjs:74-93`):
```js
{
  searchStringsArray: ["bilverkstad", "däckverkstad", ...],
  countryCode: "SE",
  customGeolocation: { lat, lng, radius: 50000 },
  maxCrawledPlacesPerSearch: 500,
  scrapeContacts: true,
  language: "en",
}
```

**Two ways to launch:**
- **Inline (preferred for new countries):** `mcp__Apify__call-actor` with `async: true`. Simpler, one tool call per pass. Pattern documented in `_prompts/cowork-prompt-sk-scrape-kickoff.md:34-90`.
- **Launcher script:** Copy `start-sweden-runs.mjs` → `start-<country>-runs.mjs`, persist `{ label, cell, term, runId, datasetId, status, stats }` to a runs JSON file. Use this when you need to relaunch / retry partial failures.

**Design constraints, learned the hard way:**
1. **500-cap per search.** Country-wide queries hit it on big countries (CZ country-wide truncated at 2,000/4×500; Praha 1,000/2×500). Plan every search term per city assuming the 500 ceiling.
2. **`city:` parameter geocodes silently wrong.** Kladno (5th-largest CZ city) returned 0 rows when sent as `"city: Kladno"`. Fallback: `searchStringsArray: ["autoservis Kladno"]` works. Default to `customGeolocation` with explicit lat/lng/radius (canonical 11-cell SE grid in `start-sweden-runs.mjs:46-61`).
3. **Apify concurrent-memory cap.** Phase 1 SE pilot hit it at job 32/60 → forced wave-of-5 orchestration in Phase 2 (`orchestrate-stockholm-gapfill.mjs:61`). Cap parallel launches.
4. **Regional `locationQuery: "<region>, Latvia"` doesn't work.** Google Maps treats admin regions as text, not geometry. LV regional passes returned 0/0/1/18 rows. Use city grids, not regions.

---

## Step 2 — Poll, reconcile, recover

**Sequential triplet** (canonical for Sweden, generalizes):
1. `node scripts/poll-sweden-runs.mjs` — polls every 30s until all runs SUCCEEDED/FAILED.
2. `node scripts/reconcile-sweden-runs.mjs` — recovers orphan Apify runs that lost their runId due to shared-state races. Matches runs back to records via `input.searchStringsArray + customGeolocation.coordinates`. **This script saved a full SE batch from re-running.**
3. `node scripts/retry-pending-sweden-runs.mjs` — relaunches anything still pending/failed.

**Gotcha:** the runs JSON format (`{ label, cell, term, runId, datasetId, status, stats }`) is the de-facto contract across `start → poll → reconcile → import`. Keep the shape identical when copying to a new country.

**Quality gate:** every grid run completes SUCCEEDED. Re-launch any 0-row city with the searchString-fallback pattern from Step 1.

---

## Step 3 — Import to `discovered_shops`

**Canonical template:** `~/crm-for-saas/scripts/import-czech-shops.mjs`. Copy → `import-<country>-shops.mjs`, swap dataset IDs, country label, country_code.

**6-step dedup cascade** (built into `scripts/lib/shop-merger.mjs:20-83`) — runs in this priority order:
1. `google_place_id`
2. `org_number` (registry ID if present)
3. Normalized domain
4. Normalized phone (E.164)
5. Normalized name + postal code
6. Partial org_number + normalized name

CZ proved this cascade catches **+19% extra duplicates** beyond placeId alone. Don't skip layers.

**Chain regex tagger** (`scripts/lib/se-chains.mjs`): update for the country's chains (Mekonomen / Speedy / Autoexperten for SE; Praha-equivalent for CZ; etc.). Adds `chain_name` tag for later analysis.

**Inspection-chain regex filter** is a must-have (`import-sweden-shops.mjs:66-71`): Bilprovningen / Carspect / Opus / DEKRA / Applus / Svensk Bilprovning / A-katsastus aren't ICP — they dirty the staging table if not filtered at import time.

**Chain-domain INSERT collision pattern** (verified 2026-05-11 in PR #170): `companies_domain_workspace_unique` enforces one company per (workspace, domain). For chains like Mekonomen with 25 branch rows sharing one domain: on INSERT 23505 unique-violation, retry with `domain=NULL`. Never overwrite an existing non-null `domain` on UPDATE. Pattern in `import-scb-shops.mjs:230-244`.

**Quality gate:** unique row count within ±20% of plan. Chain breakdown printed and reviewed. ICP-shop-type histogram looks sane.

---

## Step 4 — Registry enrichment (if available)

Today only Sweden has this layer (SCB Företagsregistret SNI 95311 xlsx). If the country has a public business registry with workshop tagging, build the equivalent.

**Sweden flow:**
1. `node scripts/enrich-from-scb.mjs` — matches existing `discovered_shops` rows by name OR email-domain, pre-claims domains workspace-wide, attaches `org_number / cfar_number / län / employee_size_band / marketing_opt_out / nix_blocked / is_sole_proprietor`.
2. `node scripts/import-scb-shops.mjs` — imports net-new rows from SCB that weren't found in Apify GM. Idempotent on `(workspace_id, cfar_number)`.

**Compliance fields are load-bearing.** Every send path MUST gate on `marketing_opt_out=false AND nix_blocked=false`. Solo-proprietor flag affects GDPR treatment (natural person, not legal entity).

**Lib helper:** `scripts/lib/scb-parse.mjs` handles xlsx → normalized rows. Re-use for any registry with similar structure.

---

## Step 5 — Email enrichment + verification

Two sub-steps:

### 5a. Pattern-MV for website-yes / email-no rows

`scripts/pattern-mv-se.mjs` (and `pattern-mv-gb.mjs`): probes `info@ / kontakt@ / service@ / verkstad@ / bokning@<domain>` against MillionVerifier, stops at first valid hit.

**Chain-domain guard is critical** (`pattern-mv-se.mjs:38, 97-103`): skip domains shared by >3 rows in the same country. Otherwise the chain root-mailbox gets pasted onto every branch — exactly what caused the Autoexperten shared-inbox mess (see Step 6).

### 5b. MillionVerifier sweep

```bash
node scripts/verify-emails.mjs --country <CC> --concurrency 80 --only-null --limit 400 --no-snapshot
```

Loop the command until `--only-null` is empty (chunked at 400 for bash-timeout safety).

**Lib helper:** `scripts/lib/email-verify.mjs:22-67` — MillionVerifier v3 wrapper, throws on provider error (don't swallow). Freshness cache: valid 90d / invalid 30d / risky 7d.

**Deprecated:** Prospeo's `/email-verifier` was deprecated Feb 2026 and silently mapped everything to "unknown", poisoning ~100 rows. Do not re-introduce.

**Quality gate:**
- **Mature digital markets (SE/GB/CZ/SK):** ≥50% `valid+catch_all` of rows-with-email.
- **Emerging markets (RS/TZ/parts of Balkans):** baseline drops to ~10-15%. Don't gate the country on the EU benchmark.

---

## Step 6 — Promote to CRM + enroll

### 6a. Promote via Discovery UI

Use `/discovery` → "Select All Matching + Verify Emails + Promote". Filter:
- `shop_type IN ('auto_repair','tire_combo','auto_body')` — see `src/lib/shop-types.ts:14`. `auto_glass` deliberately removed 2026-05-06.
- `email_status IN ('valid','catch_all')`
- `crm_company_id IS NULL`

For one-off backfills: `node scripts/backfill-promote-icp-by-shop-type.mjs --country <CC> --workspace <uuid>`.

**Promote inherits `email_status` from the shop** (`src/lib/discovery/promote.ts:169`). Bulk implementation prefetches once for thousands: `src/app/api/discovery/promote/route.ts`.

### 6b. Shared-inbox dedup pre-flight

**Mandatory before any bulk enrollment.** Run this in Supabase SQL:
```sql
SELECT to_email, count(*)
FROM email_queue
WHERE sequence_id = '<id>' AND status = 'scheduled'
GROUP BY to_email
HAVING count(*) > 1
ORDER BY count(*) DESC;
```

If you see N>1 rows for any email, you have chain-branch shared-inbox dupes. Pattern:
- 82 Autoexperten branches share `kundservice@autoexperten.se` → enrolled as 82 contacts → same inbox got 82 emails over a day.
- 2026-05-20 Sverige cleanup: 196 cancelled, 434 already-sent (caught too late).

**Cleanup recipe:** cancel losers, set `email_status='shared_inbox_removed'`, then re-source direct-named emails via Lemlist history if available (`scripts/import-meko-lemlist-direct-emails.mjs` rescued 234 Meko-group direct emails).

### 6c. Bulk-enroll — `enrollContacts()` only

**NEVER SQL-insert into `sequence_enrollments`.** Direct INSERT leaves orphans invisible to the cron because `enrollContacts` ALSO creates the matching `email_queue` row + picks sender/variant + computes `scheduled_for`. Caught 2026-05-19 after a bulk SQL insert left 1,091 SCB rows enrolled-but-invisible.

**Correct pattern** (`scripts/bulk-enroll-se-sverige.mjs`): use `tsx` to import `enrollContacts` from app code and pass an authenticated Supabase client. Pre-fetch the eligible sender pool once and round-robin in JS by index (PR #102 fix for the `getNextSender` same-sender trap).

**Quality gate post-enroll:** spot-check `email_queue.scheduled_for` distribution. Watch the first 30 sends for bounce spike or low open rate — if either, pause and audit.

---

## Cross-cutting gotchas (load-bearing in every step)

1. **PostgREST `.in()` URL limit (~1000 UUIDs).** Chunk at 200 (see `cz-diagnose.mjs:62-76`).
2. **PostgREST `.limit(N)` is silently capped at `db-max-rows=1000`.** Use `pageAll<T>` helper for large reads with stable `.order()`.
3. **`activities` insert errors are silently swallowed everywhere except `logVisit`** (PR #248 trap). Wrap with error-checking helper for any scrape-related activity logging.
4. **`contacts_lead_status_check` allow-list:** only `new | contacted | qualified | customer | churned`. CLAUDE.md's `engaged` and `unqualified` are STALE — they 23514.
5. **`lemlist-csv` is an `ALREADY_SEQUENCED_TAGS` member.** If you re-import Lemlist history, contacts tagged `lemlist-csv` are guarded from re-enrollment. Don't strip the tag to "fix" enrollment — it's intentional.
6. **Inline Apify (`mcp__Apify__call-actor`) and launcher scripts both work, but never mix them in the same campaign.** The runs JSON file is the contract — inline runs don't populate it.

---

## What's missing today (open follow-ups)

1. **Registry layer for non-SE countries.** EE/LV/LT/CZ/SK all have business registries; none integrated yet. SCB pattern (`enrich-from-scb.mjs` + `import-scb-shops.mjs`) is portable — port it country-by-country as ROI demands.
2. **Auto-generated runs JSON from inline Apify calls.** Currently inline calls work but you lose the start→poll→reconcile loop. A small wrapper that persists `runId/datasetId` to disk after `call-actor async: true` would unify the two patterns.
3. **Shared-inbox detection at promote time, not post-enroll.** Today the dedup query runs after enrollment. Promote step could pre-cluster by `(workspace, normalized_domain)` and warn if N>1 contacts map to the same `to_email`.
4. **`scrape` skill doesn't yet know about SCB, shared-inbox dedup, `enrollContacts` vs SQL, or `lemlist-csv` tag.** Skill update queued — see `_prompts/update-scrape-skill.md`.

---

## Authoritative file references

**Scripts (`~/crm-for-saas/scripts/`):**
- `start-sweden-runs.mjs:74-93` — canonical Apify launch input
- `lib/shop-merger.mjs:20-83` — 6-step dedup cascade
- `lib/email-verify.mjs:22-67` — MillionVerifier wrapper
- `lib/scb-parse.mjs` — SCB parser
- `lib/se-chains.mjs` — chain regex tagger
- `pattern-mv-se.mjs:38,97-103` — chain-domain guard
- `bulk-enroll-se-sverige.mjs` — correct bulk enrollment pattern
- `import-czech-shops.mjs` — canonical importer template
- `verify-emails.mjs` — parameterized MV sweeper

**App (`~/crm-for-saas/src/`):**
- `lib/discovery/promote.ts:48` — single-row promote
- `app/api/discovery/promote/route.ts` — bulk promote
- `lib/shop-types.ts:14` — ICP shop-type allow-list

**Per-country precedents (this folder):**
- `scrape-plan-CZ.md` — best "actual results + lessons" example
- `scrape-plan-template.md` — Step-0 starting point

**Vault prompts (`_prompts/`):**
- `cowork-prompt-sk-scrape-kickoff.md` — inline `call-actor` pattern
- `cc-prompt-select-all-and-verify-before-promote.md` — Discovery UI promote flow
- `update-scrape-skill.md` — open skill update
- `phase-4-servicefinder-dorunner-PLAN.md`, `phase-5-promote-PLAN.md` — Kundbolaget-specific (SE contractor product); superseded for CRM use, archive after confirming nothing else references them.

---

## Change log

- **2026-05-21** — Initial canonical playbook, distilled from 10 country campaigns. Author: Cowork session.

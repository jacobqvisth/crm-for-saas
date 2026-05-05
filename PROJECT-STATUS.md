# CRM Project Status
Last updated: 2026-05-05 (workshop CRM schema + import existing customers from app #115; Sweden Stockholm metro Apify scrape — 2,492 unique workshops, 51% email)

## Cowork Session Startup (READ THIS FIRST)

You are Cowork — the architecture and planning agent for this CRM project. At the start of every new session:

1. **Request the project folder**: `/Users/jacobqvisth/crm-for-saas/` (use `request_cowork_directory`)
2. **Sync the repo**: Use Desktop Commander (`mcp__Desktop_Commander__start_process`) to run `cd /Users/jacobqvisth/crm-for-saas && git pull origin main`
3. **Read this file** (`PROJECT-STATUS.md`) to understand current state
4. **Read `CLAUDE.md`** for architecture and conventions
5. **Check `docs/prompts/`** to see which phases have prompts written
6. **Tell Jacob** what phase we're on and what's next

### Tools You Have
- **Desktop Commander** (`mcp__Desktop_Commander__start_process`): Run terminal commands on Jacob's Mac. Use this for git pull/commit/push, npm commands, and anything that needs the real filesystem. This is how you push to GitHub.
- **Cowork file tools** (Read, Write, Edit, Bash): Read/write files in the mounted project folder. Use for editing docs, prompts, and config files.
- **Supabase MCP**: Direct access to the Supabase project (execute SQL, list tables, manage migrations).
- **Vercel MCP**: Check deployments, logs, project status.
- **Gmail MCP**: Access Jacob's email for testing and reference.
- **Google Calendar MCP**: Check Jacob's schedule.
- **Chrome tools**: Browser automation if needed for testing.

### Key Rule
Always commit and push via Desktop Commander before telling Jacob to start a CC session. The command pattern:
```bash
cd /Users/jacobqvisth/crm-for-saas && git add [files] && git commit -m "message" && git push origin main
```

## Owner
Jacob Qvisth (jacob@wrenchlane.com / jacob.qvisth@gmail.com)

## Architecture
- **Stack**: Next.js 16 + Supabase + Tailwind CSS 4 + Vercel + Inngest + Gmail API
- **Repo**: https://github.com/jacobqvisth/crm-for-saas.git
- **Local path**: /Users/jacobqvisth/crm-for-saas/
- **Supabase project**: wdgiwuhehqpkhpvdzzzl
- **Google Cloud project**: crm-for-saas (Client ID: 79989913085-8ca2mlpo4629n83nbrr0o7cds5jrp3ao.apps.googleusercontent.com)

## Build Phases
| Phase | Description | Status | PR |
|-------|-------------|--------|-----|
| 1 | Scaffolding + Auth + Dashboard layout | ✅ Merged | #1 |
| 2 | Contacts + Companies + CSV Import | ✅ Merged | #2 |
| 3 | Deals Pipeline (Kanban board) | ✅ Merged | #4 |
| 4 | Gmail Integration (OAuth, sending engine) | ✅ Merged | #5 |
| 5 | Email Sequences (Lemlist-like builder + Inngest) | ✅ Merged | #6 |
| 6 | Email Tracking (open pixel, click wrapping) | ✅ Merged | #7 |
| 7 | Contact Lists + Smart Lists | ✅ Merged | #8 |
| 8 | Dashboard + Reports | ✅ Merged | #9 |
| 9 | Production Deployment + Vercel | ✅ Complete | — |
| QA | Playwright E2E test suite | ✅ Complete — 34/34 tests passing against production | #10 |
| PR #11 | Bug fix: Gmail connect errors, enrollment UX, contact-to-sequence flow | ✅ Merged | #11 |
| Hotfixes | Post-QA production hardening (see below) | ✅ Deployed to main | — |
| 10 | Campaign execution infrastructure | ✅ Merged | #13 |
| 12a | Prospector (contact discovery via Prospeo.io) | ✅ Merged | #14 |
| 14 | Inbox + Reply Management | ✅ Merged | #15 |
| 12b | Prospector: Bug Fix + Search UI Upgrade | ✅ Merged | #16 |
| 12c | Prospector: Complete API rebuild (verified field names + enum values) | ✅ Merged | #17 |
| 12d | Prospector: Bilingual job title search (EN + local language) | ✅ Merged | #18 |
| 12e | AI Prospector Filter (ICP scoring via Claude Haiku + Settings page) | ✅ Merged | #19 |
| 15 | Sequence Reliability: OOO detection, company stop, threading, pause/resume | ✅ Merged | #20 |
| 16 | Smart Throttling & Circuit Breaker: send jitter, bounce circuit breaker, send limits admin | ✅ Merged | #21 |
| 17 | Compliance & DNC: suppressions table, GDPR erasure, DNC management page, CSV import | ✅ Merged | #22 |
| Schema 25 | Extended contacts + companies — address, country_code, all_emails[], all_phones[], instagram_url, facebook_url, language, tags, notes, is_primary, parent_company_id, phone, website, google_place_id, rating, review_count, category | ✅ Applied | — |
| Discovery page | Shop Discovery UI (`/discovery`) — browse/filter discovered_shops, promote to CRM, skip | ✅ Merged | #30 |
| Discovery promote fix | Full Phase 25 field mapping in promote route (address, country_code, all_emails, language, tags, etc.) | ✅ Merged | #31 |
| Phase 25 UI | Contact + Company detail pages: all Phase 25 fields editable (location, social links, tags, notes, array chips, is_primary, parent company, Google Maps data) | ✅ Merged | #32 |
| Email verification (data) | MX-based email verification run on all 1,035 EE emails: 1,022 valid, 13 invalid. `email_valid` + `email_check_detail` columns added to `discovered_shops`. Scrape skill updated with Step 8 (auto-verify after every future import). | ✅ Done | — |
| Email verification UI | Discovery page: ✅/❌ badges on email column, "Verified email" filter checkbox, import guard that auto-skips `email_valid=false` shops and reports count in toast | ✅ Merged | #33 |
| 18 | Multi-Sender Selection & Sender Pinning — sender picker in all enrollment flows, sender pinning per enrollment, preflight capacity info, sender breakdown analytics | ✅ Merged | #34 |
| 19 | Multi-User Workspace — domain-based auto-join (@wrenchlane.com auto-joins existing workspace), Team Settings page, user avatar in sidebar, "Connected by" on Gmail cards | ✅ Merged | #35 |
| Sequence UX 1 | Duplicate sequence with country + language selection (dialog w/ country→default-language auto-select; suffix appended to name e.g. "Cold Outreach (Estonia — Estonian)") | ✅ Pushed direct to main (no PR) | 2cd3979 |
| Sequence UX 2 | Threading hint + Delete sequence — non-first email steps show "Re: <prior subject>" preview + Threaded reply badge; editor helper explains blank subject = same Gmail thread; DELETE /api/sequences/[id] with FK-ordered cascade + type-name-to-confirm modal | ✅ Merged | #37 |
| Sequence UX 3 | Sequence detail UX clarity — Launch Campaign → Enroll List, Activate/Pause → Start/Pause Sending (promoted to top bar), Pause All behind ⋯ menu, amber paused banner, sending-status strip (sender/next send/last sent), Contacts tab 5→9 cols (Company, Last activity, Next send, Sent + Step as "2/5 · Email") | ✅ Merged | #38 |
| Workflow migration | CC now owns merge+deploy+test loop. GitHub Actions CI added as safety net. Vercel auto-deploy reconnected. | ✅ Merged | #42 |
| Latvia scrape | 973 shops (35% email, 94% phone, 46 cities). Import script `scripts/import-latvia-shops.mjs` with CSDD filter. | ✅ Merged | #43 |
| Country filter (contacts + lists) | Country filter/column/sort on /contacts + Country field in list builder | ✅ Merged | #44 |
| Dynamic list fix | Centralized dynamic list membership (`resolveListContactIds`), correct counts + enrollment end-to-end | ✅ Merged | #46 |
| Sequence: change sender | Show real per-sequence sender in header + Change Sender modal | ✅ Merged | #48 |
| Sequence duplicate translate | Translate email steps when duplicating a sequence | ✅ Merged | #49 |
| Draft enrollment fix | Draft-sequence enrollments silently failing to queue emails | ✅ Merged | #50 |
| Estimated send times | Show estimated send times in sequence contacts tab | ✅ Merged | #51 |
| Phase SE-Stockholm-2/3/4a/4b/5 | Swedish contractor pipeline against Result Insurance DB (`ugibcnidxrhcxflqamxs`) — SF migration + gap-fill scrape + cert-flag + description enrichment + SF/DoRunner national + promote discovered_shops → contractor_directory | ✅ Merged | #52, #53, #55, #58, #59 |
| Discovery: select-all-matching + verify | Gmail-style "select all N matching" on /contacts + verify emails in /discovery before promote (Prospeo, `email_status`/`email_verified_at` cols) | ✅ Merged | #56 |
| Chore: mark legacy | `discovered_shops` marked legacy in CLAUDE.md (Swedish directory pipeline moved to result-insurance) | ✅ Merged | #60 |
| Slovakia scrape | 3,573 shops (40% email, 92% phone, 683 cities). Import script `scripts/import-slovakia-shops.mjs`. | ✅ Merged | #62 |
| Prospeo → MillionVerifier | Swap `verify-email` routes for contacts + discovery (Prospeo `/email-verifier` deprecated Feb 2026) — env var `MILLIONVERIFIER_API_KEY` | ✅ Merged | #63 |
| Email status badge + MV copy | Show verified status badge in contacts table + update UI copy to MillionVerifier | ✅ Merged | #65 |
| Bulk promote fix | Rewrite promote route with bulk ops — fixes Supabase 1k row cap + Vercel 10s timeout | ✅ Merged | #66 |
| Contacts filter bar upgrade | Email status / source / language / has-phone filters + flag emojis | ✅ Merged | #67 |
| Contacts page rewrite | Full rewrite — local filter state, Discovery-style layout, new columns | ✅ Merged | #68 |
| Rich email editor (TipTap) | Replace plain textarea in sequence/template editors with TipTap — B/I/U, lists, links, variable chips, placeholder, character count, iframe preview with Gmail-safe CSS, plain-text → HTML migration on load | ✅ Shipped direct | 15d2f08 |
| Rich email editor: images | Inline image upload (toolbar + drag-drop + paste) + URL embed with Google Drive share-link normalization. New `/api/email-images/upload` route + public `email-images` storage bucket. | ✅ Merged | #69 |
| Serbia scrape (RS) | 2,464 unique shops · 14% email · 90% phone · 465 cities. First non-EU country. 21 Apify runs ($25). MV-verified: 213 valid / 78 risky / 31 catch_all / 23 invalid. New scripts: `scrape-serbia-launch.mjs`, `scrape-serbia-poll.mjs`, `import-serbia-shops.mjs`, `verify-emails.mjs`, `lib/email-verify.mjs`. | ✅ Done | — |
| UK/GB scrape (batch 1) | 1,404 unique shops · 50% email (445 valid + 155 catch_all) · 96% phone · 313 cities. **First English-speaking market.** Registry-led pipeline (new pattern): DVSA Active MOT Stations CSV (23,087 free) + Companies House SIC 45200 (61,459 free) + 1 Apify Maps country-wide run + pattern-MV (`info@`/`enquiries@`/`contact@`/etc) on the 314 domains missing email. Spend: $3.17. 78,866-row registry spine kept on disk in `_reference/gb-checkpoint/` (gitignored, regeneratable). Scripts: `scripts/import-gb-shops.mjs`. Plan + audit trail: `_reference/scrape-plan-GB.md`. | ✅ Done | #76, #79 |
| UK/GB scrape (batch 2 city-grid) | **+7,151 net-new shops** (8,555 GB total) via 32 Apify Maps runs across London (4 quadrants) + Birmingham + Manchester + Glasgow + Leeds × {garage, tyre fitting, mechanic, accident repair centre} at 15km radius. Then MV-verified all new emails + pattern-MV on the 1,630 new domains missing email. **GB sendable inventory after batch 2: 2,901** (2,383 valid + 518 catch_all). Batch 2 spend: ~$62 (Apify $55.73 + MV $1.67 + pattern-MV $4.86). New scripts: `scripts/scrape-gb-launch.mjs`, `scripts/scrape-gb-poll.mjs`, `scripts/import-gb-citygrid.mjs`, `scripts/pattern-mv-gb.mjs`. | ✅ Done | #84 |
| UK/GB scrape (batch 3 tier-2 city-grid) | **+3,193 net-new shops** (11,674 GB total) via 20 Apify Maps runs across Liverpool + Edinburgh + Bristol + Cardiff + Belfast × {garage, tyre fitting, mechanic, accident repair centre} at 15km. Belfast specifically fills the DVSA gap (NI is excluded from the MOT register). Then MV-verified 1,101 new emails + pattern-MV on 1,794 new domains missing email. **Final GB sendable inventory: 4,026** (3,287 valid + 739 catch_all). Batch 3 spend: ~$33 (Apify $26.09 + MV $0.77 + pattern-MV $5.86). New scripts: `scripts/scrape-gb-batch3-launch.mjs`, `scripts/import-gb-batch3.mjs`. **Cumulative UK pipeline spend: ~$98**. | ✅ Done | this session |
| Workshop CRM schema + wl-app customer import | Extends `companies` + `contacts` for workshop/customer state. New tables: `subscriptions` (Stripe history) + `usage_events` (generic event stream, future-proofed for the dashboard merge). Source-of-truth IDs: `companies.wl_workshop_id` (dashboard UUID) + `contacts.wl_user_id` (Cognito sub), unique-but-nullable. Imports the 333-row existing-customers CSV → 255 companies + 316 contacts + 132 subscriptions. 25 Lemlist prospects auto-cross-linked to existing customers. Fix-up migration (`20260505010000`) added `companies.source` + converted partial unique indexes to full (PostgREST upsert). | ✅ Merged | #115 |
| Sweden Stockholm metro scrape | **2,492 unique workshops · 51% email · 92% phone · 80% website · 106 cities · 345 chain-tagged.** 11-cell county-wide grid (4 city-core 15km + 4 inner-ring 20km + 3 county-fringe 25-30km) × 5 search terms (`bilverkstad`, `bilreparation`, `mekaniker`, `däckverkstad`, `bilservice`) = 55 async Apify runs, all SUCCEEDED. New schema migration `20260505020000_discovered_shops_extras.sql` adds the freebie GMaps fields: `google_maps_url`, `description`, `permanently_closed`, `temporarily_closed`, `price_level`, `additional_info` JSONB, `plus_code`, `popular_times`, `linkedin_url`, `twitter_url`, `youtube_url`. MX-verified 1,331 new emails: 1,315 valid (98.8%), 16 invalid. 33 new prospect↔customer cross-links. Apify spend: ~$15. New scripts: `start-sweden-runs.mjs`, `retry-pending-sweden-runs.mjs`, `poll-sweden-runs.mjs`, `reconcile-sweden-runs.mjs`, `import-sweden-shops.mjs`, `verify-emails-se.mjs`. | ✅ Done | this session |
| **Next** | Options: (A) Sweden full-country scrape — Göteborg, Malmö-Lund, mid-size cities (Uppsala, Västerås, Örebro, Linköping, Norrköping, Jönköping, Borås, Eskilstuna, Halmstad, Växjö, Karlstad), mid-north (Gävle, Sundsvall, Falun, Östersund), far north (Umeå, Skellefteå, Luleå, Kiruna), south residuals (Kalmar, Karlskrona, Kristianstad, Visby) — ~20 more cells, est. $80-150 Apify, ~6,000-8,000 more workshops; (B) CI red-on-main fix (add `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` as GH secrets); (C) Apply pattern-MV recipe to CZ/SK/RS rows with website-but-no-email; (D) Phase 26 A/B testing; (E) Bosnia/N.Macedonia/Albania scrape | 🔜 | — |

### Discovered_shops rolling tally (Supabase `wdgiwuhehqpkhpvdzzzl`)
Verified via SQL on 2026-04-29 — 27,792 total rows:
| Country | Total | With Email | With Phone | Cities |
|---|--:|--:|--:|--:|
| United Kingdom (GB) | 11,674 | 4,949 (42%) | ~10,650 (91%) | ~570 |
| Czech Republic (CZ) | 6,295 | 3,227 (51%) | 5,721 (91%) | 1,050 |
| Slovakia (SK) | 3,573 | 1,414 (40%) | 3,271 (92%) | 683 |
| Serbia (RS) | 2,464 | 345 (14%) | 2,222 (90%) | 465 |
| Lithuania (LT) | 1,999 | 701 (35%) | 1,833 (92%) | 322 |
| Latvia (LV) | 973 | 340 (35%) | 916 (94%) | 46 |
| Estonia (EE) | 814 | 335 (41%) | 758 (93%) | 251 |
| **Sweden (SE)** | **3,295** | **1,998 valid (61%)** | ~3,033 (92%) | 106 (Stockholm metro only — full-country pending) |

## Bugs Fixed (not by CC)
- RLS infinite recursion on workspace_members — replaced self-referencing policies with auth.uid() + SECURITY DEFINER helpers
- Auth callback inserting non-existent 'slug' column — removed from insert
- Generated TypeScript types had 'slug' instead of 'domain' and 'google_workspace_domain'
- Middleware only protected /dashboard/* — updated to protect all app routes
- Nested duplicate directory /crm-for-saas/crm-for-saas/ — deleted

## Post-QA Hotfixes (merged to main after PR #10, before Phase 10)
All committed directly to main or via PR #11:
- PR #11: Gmail OAuth callback error handling improved; enrollment UX fixes; added "Enroll in Sequence" from contact detail page
- `contact_lists.type` column renamed to `is_dynamic` (boolean) — fixed all affected queries
- Fixed nullable `sequence_enrollments` types and stale workspace_id filters
- Fixed Gmail env vars trimming (trailing newline caused OAuth 400)
- Fixed sequence enrollment for paused sequences; added Enrolled stat counter
- Fixed cron routes (`process-emails`, `check-replies`, `reset-daily-sends`) to use service-role client (bypass RLS)
- Fixed RLS bypass for all Gmail lib functions (send, token-refresh, sender-rotation)
- Fixed false-positive open tracking from Gmail/Google link-preview scanners
- Auto-insert 3-day delay before every new email step in sequence builder

## Database
18 CRM tables with RLS + 1 Cowork staging table (no RLS):
workspaces, workspace_members, contacts, companies, pipelines, deals, deal_contacts, activities, contact_lists, contact_list_members, gmail_accounts, email_templates, sequences, sequence_steps, sequence_enrollments, email_queue, email_events, unsubscribes, **discovered_shops**

Key RLS note: workspace_members uses special non-recursive policies. Do NOT add policies that self-reference workspace_members directly.

### discovered_shops (staging table)
Managed by Cowork — not exposed in the CRM UI yet. Stores shops found via Apify/Vibe Prospecting before they are promoted to `contacts`/`companies`.
- **Schema**: name, google_place_id, address, city, country_code, lat/lng, phone, website, domain, primary_email, all_emails[], all_phones[], instagram_url, facebook_url, category, rating, review_count, opening_hours, source, status, crm_company_id, crm_contact_id, scraped_at
- **Status values**: new | enriched | imported | skipped
- **Source values**: google_maps | vibe_prospecting | manual
- **Current data**: 2813 shops across Estonia + Lithuania (scraped 2026-04-02 via Apify Google Maps Scraper)
  - Estonia (EE): 814 shops — 93% phone, 41% email, 251 cities
  - Lithuania (LT): 1999 shops — 92% phone, 33% email, 322 cities
- **Import script**: `scripts/import-estonia-shops.mjs` (run with `node scripts/import-estonia-shops.mjs`)

## Env Vars (.env.local)
- NEXT_PUBLIC_SUPABASE_URL ✅
- NEXT_PUBLIC_SUPABASE_ANON_KEY ✅
- NEXT_PUBLIC_APP_URL ✅
- GOOGLE_CLIENT_ID ✅
- GOOGLE_CLIENT_SECRET ✅
- ENCRYPTION_KEY ✅
- CRON_SECRET ✅
- SUPABASE_SERVICE_ROLE_KEY ✅ (added Phase 6)

## Process & Sync

### Agents
- **Cowork**: Architecture, planning, prompts, debugging, docs. Reads/writes local folder.
- **Claude Code (CC)**: Builds features from prompts in the Claude desktop app (Code mode). One new session per phase. Creates branches, commits, pushes, opens PRs.

### Sync Sequence
1. `git pull origin main` — sync local with GitHub
2. Cowork writes changes (prompts, docs, CLAUDE.md updates) and pushes to main
3. CC starts new session — reads from GitHub, gets everything
4. CC builds on a new branch → opens PR → merges it → Vercel auto-deploys
5. `git pull origin main` — sync local again before Cowork writes next time

**Rule: always pull before writing, always push before CC starts.**

### CC-Owned Merge + Deploy Loop (as of 2026-04-14)

CC now owns the full build-test-merge-deploy cycle. After every session:
1. CC merges its own PR with `gh pr merge --squash`
2. Vercel auto-deploys on push to main (reconnected 2026-04-14)
3. GitHub Actions CI runs E2E tests as an async safety net
4. CC appends to `cc-session-log.md`

Cowork reads `cc-session-log.md` to stay in sync. Cowork no longer merges PRs or runs Vercel deploys.

### CC Session Practice
- Always start a new CC session for each phase/prompt
- CC reads CLAUDE.md automatically for project conventions
- CC creates a new branch, never commits to main directly

## Deployment
- **Vercel project**: crm-for-saas (team: jacobqvisths-projects)
- **Production URL**: https://crm-for-saas.vercel.app
- **GitHub**: https://github.com/jacobqvisth/crm-for-saas (auto-deploys on push to main — reconnected 2026-04-14)
- **Cron jobs** (vercel.json): process-emails (*/5 min), check-replies (*/30 min), reset-daily-sends (midnight UTC)

### Phase 12a — Pre-CC checklist (can run in parallel with Phase 10)
1. **Sign up at prospeo.io** to get an API key (free trial available, then ~$25/mo)
2. **Add `PROSPEO_API_KEY`** to `.env.local` in the repo
3. **Add `PROSPEO_API_KEY`** as environment variable in Vercel (Settings → Environment Variables)
4. **CC prompt:** `docs/prompts/phase12a-prospector.md`

### Phase 12a — What CC builds
- `/prospector` page with filter panel (country, job title, industry, company size) + results table
- `POST /api/prospector/search` — server-side proxy to Prospeo search endpoint
- `POST /api/prospector/add-contacts` — enriches selected contacts (reveals emails) then saves to Supabase
- Sidebar nav item (Search icon)
- DB migration: `source` column on contacts table

### Phase 10 — Pre-CC checklist (Jacob does these first)
1. **Connect a Gmail account** via Settings → Email in the production app (required for pre-flight checks to pass)
2. **Load real contacts** via CSV import — start with 100–200 Swedish workshop owners, not the full list
3. ~~Disconnect GitHub auto-deploy~~ — already disconnected ✅
4. **CC prompt:** vault `02_Projects/wrenchlane-crm/_prompts/cc-prompt-phase-10.md`

### What Phase 10 CC session builds
- ~~Bounce detection in `check-replies` cron~~ — **already built in Phase 6, skip this step**
- Campaign launch modal (select list → pre-flight checklist → confirm → enroll)
- Pre-flight API: `GET /api/sequences/[id]/preflight?listId=...` (Gmail check, missing data counts, send estimate)
- Sequence analytics page: **build from scratch** (current page is a `<PlaceholderPage>`) — use existing `sequence-analytics-tab.tsx` component + add stat cards + enrollment table
- Bounce suppression in `process-emails` (contact status check — not yet added)
- New E2E spec: `e2e/campaign-launch.spec.ts`

## Contact Discovery Pipeline (Cowork-managed)

The CRM is being populated via a multi-stage discovery pipeline managed entirely by Cowork. **This is separate from CC builds** — Cowork runs scrapes, enriches data, and populates `discovered_shops`. CC builds the UI to surface it.

### Architecture
```
Stage 1: Apify Google Maps Scraper  →  discovered_shops table (status: 'new')
Stage 2: Vibe Prospecting enrichment →  discovered_shops table (status: 'enriched')
Stage 3: Promote to CRM             →  contacts + companies tables (crm_company_id set)
Stage 4: Enroll in sequences        →  via CRM UI
```

### How Cowork runs a country scrape
1. Use `mcp__Apify__call-actor` with actor `compass/crawler-google-places`
2. Input: `searchStringsArray` (local language terms + English), `locationQuery` = country name, `countryCode` = ISO code, `maxCrawledPlacesPerSearch` = 200, `scrapeContacts` = true, `skipClosedPlaces` = true, `async` = true
3. Wait for completion via `mcp__Apify__get-actor-run` (runId from step 2)
4. Fetch results via `mcp__Apify__get-actor-output` (datasetId from run result) in batches of 500
5. Save raw JSON to `scripts/[country]-shops-data.json` (on Jacob's machine via Python)
6. Run `node scripts/import-[country]-shops.mjs` via Desktop Commander to push to Supabase
7. Update discovered_shops count in this file

### Search terms by country
- **Estonia (EE)**: `auto repair`, `car workshop`, `autoteenindus`, `autoremonttöökoda`, `autoremonditeenindus`
- **Sweden (SE)**: `bilverkstad`, `autoverkstad`, `bilservice`, `auto repair`
- **Finland (FI)**: `autokorjaamo`, `autohuolto`, `korjaamo`, `auto repair`
- **Latvia (LV)**: `autoserviss`, `auto remonts`, `auto repair`
- **Lithuania (LT)**: `autoservisas`, `automobilių remontas`, `auto repair`
- **Norway (NO)**: `bilverksted`, `bilservice`, `auto repair`
- **Denmark (DK)**: `autoværksted`, `bilværksted`, `auto repair`
- **United Kingdom (GB)**: `MOT centre`, `EV garage`, `bodyshop` (registry-led — most rows came from DVSA + Companies House before any Maps query)

### discovered_shops data by country (SQL-verified 2026-04-28)
| Country | Scraped | Total | With Email | With Phone | Unique Cities | Status |
|---------|---------|-------|------------|------------|---------------|--------|
| Estonia (EE) | 2026-04-02 | 814 | 335 (41%) | 758 (93%) | 251 | ✅ In Supabase |
| Lithuania (LT) | 2026-04-02 | 1,999 | 701 (35%) | 1,833 (92%) | 322 | ✅ In Supabase |
| Latvia (LV) | 2026-04-15 | 973 | 340 (35%) | 916 (94%) | 46 | ✅ In Supabase |
| Czech Republic (CZ) | 2026-04-22 | 6,295 | 3,227 (51%) | 5,721 (91%) | 1,050 | ✅ In Supabase |
| Slovakia (SK) | 2026-04-22 | 3,573 | 1,414 (40%) | 3,271 (92%) | 683 | ✅ In Supabase |
| Serbia (RS) | 2026-04-27 | 2,464 | 345 (14%) | 2,222 (90%) | 465 | ✅ In Supabase (first non-EU; MV: 213 valid / 78 risky / 31 catch_all / 23 invalid) |
| United Kingdom (GB) | 2026-04-28 / -29 | 11,674 | 4,949 (42%) | ~10,650 (91%) | ~570 | ✅ In Supabase. **First English-speaking market.** Three-batch scrape: country-wide + tier-1 city-grid (London 4q + Birmingham/Manchester/Glasgow/Leeds) + tier-2 city-grid (Liverpool/Edinburgh/Bristol/Cardiff/Belfast). **Sendable inventory: 4,026** (3,287 valid + 739 catch_all). Total spend ~$98 (Apify $84 + MV $2.73 + pattern-MV $11.60). |
| **Total** | — | **27,792** | **11,311 (41%)** | **~25,371 (91%)** | **~3,387** | — |
| Sweden (SE) | — | — | — | — | — | 🔜 Not started (result-insurance SE directory is a separate project/DB) |

### Import scripts (in `/scripts/`)
- `scripts/import-estonia-shops.mjs` — Estonia (814 shops, reads local JSON data file)
- `scripts/import-lithuania-shops.mjs` — Lithuania (1999 shops, fetches from Apify dataset 96U2txGRRVKHyBPsF, needs APIFY_TOKEN env var)
- `scripts/import-latvia-shops.mjs` — Latvia (973 shops, fetches 12 Apify datasets, filters CSDD, needs APIFY_TOKEN env var)
- `scripts/import-slovakia-shops.mjs` — Slovakia (3,573 shops, 12 Apify runs)
- `scripts/import-serbia-shops.mjs` — Serbia (2,464 shops, 21 Apify runs; reads dataset IDs from `scripts/serbia-runs.json`; Kosovo filter included)
- `scripts/scrape-serbia-launch.mjs` + `scripts/scrape-serbia-poll.mjs` — Serbia run launcher + poller (one-shot pattern, can be templated for future countries)
- `scripts/import-gb-shops.mjs` — UK/GB batch 1 (1,404 shops, country-wide; reads `_reference/gb-checkpoint/gb-maps-final.json`). Plan + reproducibility: `_reference/scrape-plan-GB.md`.
- `scripts/scrape-gb-launch.mjs` + `scripts/scrape-gb-poll.mjs` — UK/GB batch 2 city-grid run launcher + poller (32 runs across 8 grid points × 4 terms).
- `scripts/import-gb-citygrid.mjs` — UK/GB batch 2 importer (reads dataset IDs from `scripts/gb-runs.json`, dedups by google_place_id against existing GB rows).
- `scripts/scrape-gb-batch3-launch.mjs` — UK/GB batch 3 launcher (20 runs across Liverpool/Edinburgh/Bristol/Cardiff/Belfast × 4 terms; writes `scripts/gb-runs-batch3.json`).
- `scripts/import-gb-batch3.mjs` — UK/GB batch 3 importer (reads `gb-runs-batch3.json`).
- `scripts/pattern-mv-gb.mjs` — pattern-guess (info@/enquiries@/contact@/office@/sales@) + MillionVerifier across all GB rows with website-but-no-email. Idempotent — re-running only enriches new rows.
- `scripts/verify-emails.mjs` — parameterized MillionVerifier runner (`--country <CC>`, `--only-null`, `--limit N`, `--concurrency 20|80`, `--dry-run`, `--no-snapshot`). Built 2026-04-27 from spec.
- `scripts/lib/email-verify.mjs` — MV wrapper used by `verify-emails.mjs`. Throws loudly on `result: error` and unrecognized result values (no silent "unknown" mapping). Built 2026-04-27.
- Data files: `scripts/[country]-shops-data.json` (generated by Cowork, gitignored). Serbia uses `scripts/serbia-runs.json` (run ledger, not gitignored — small file).

### Vibe Prospecting enrichment workflow (when ready)
Use `mcp__Vibe_Prospecting__fetch-entities` with `naics_category: {"values": ["8111"]}` and `company_country_code: {"values": ["[ISO]"]}` to find owner/manager contacts for shops already in discovered_shops. Export to CSV, map to discovered_shops, update status to 'enriched'.

### Promoting to CRM
When ready to start campaigns: run a Cowork SQL script to batch-insert `discovered_shops` (status = 'enriched' or 'new') into `companies` + `contacts` tables with `source = 'prospector'`, then set `crm_company_id` / `crm_contact_id` on the discovered_shops row and update status to 'imported'.

---

## Roadmap
See `docs/roadmap.md` for the full post-Phase-8 plan. Summary:
- **Phase 9**: Production deployment + real data loading ✅ COMPLETE
- **Phase QA**: ✅ Complete. 34/34 Playwright E2E tests passing against production.
- **Phase 10**: Campaign execution infrastructure ✅ COMPLETE — campaign launch modal, preflight API, analytics page, bounce suppression
- **Phase 12a**: Prospector — contact discovery via Prospeo.io ✅ COMPLETE — PR #14
- **Phase 12b**: Prospector upgrade — bug fix (headcount_range enum), seniority filter, tag-input, multi-select size, fixed industry values ✅ COMPLETE — PR #16
- **Phase 12c**: Prospector complete rebuild — verified all Prospeo API field names and enum values from docs. Fixed person_location_search, industry values, headcount format. Added company_keywords, verified-email-only toggle, max-per-company. ✅ COMPLETE — PR #17
- **Phase 12d**: Prospector bilingual job titles — English-only suggested chips with auto translation labels (e.g. "Verkstadsägare (SV)"), "local language only" checkbox. 11 countries × 8 titles. ✅ COMPLETE — PR #18
- **Phase 12e**: AI Prospector Filter — Claude Haiku scores selected profiles as good/maybe/poor against workspace ICP. Settings page at /settings/ai-filter with ICP prompt editor. Smart Reveal toggle skips poor fits on reveal. 39/39 E2E tests passing. ✅ COMPLETE — PR #19
- **Phase 15**: Sequence Reliability — OOO auto-detection (multilingual), company-level stop (pause other contacts at same company on reply), per-enrollment pause/resume, email threading (In-Reply-To/References), sequence health badges. 39/39 E2E passing. ✅ COMPLETE — PR #20
- **Phase 11**: Sender warmup + deliverability ⏸ Skipped for now (ops-heavy, revisit when scaling)
- **Phase 14**: Inbox + Reply Management ✅ COMPLETE — PR #15
- **Phase 16**: Smart Throttling & Circuit Breaker — send jitter (1 email/sender/cron run, reschedule rest with 30-120s random delays), bounce rate circuit breaker (auto-pause at >8% with ≥20 sends), send limits admin panel (per-account status, resume button, workspace defaults). 39/39 E2E passing. ✅ COMPLETE — PR #21
- **Phase 17**: Compliance & DNC — unified `suppressions` table (email + domain blocking, reason tracking, soft deletes), auto-add on unsubscribe + bounce, pre-send suppression gate, preflight warning, Prospector suppression check, GDPR "Delete & Forget" on contacts, Settings → Compliance page with DNC management + CSV bulk import. Also fixed `/contacts/import` prerender. 39/39 E2E passing. ✅ COMPLETE — PR #22
- **Phase 18**: Multi-Sender Selection & Sender Pinning — sender account picker in all enrollment modals, sender pinning per enrollment (all emails in a sequence use the same sender), preflight capacity info (total daily capacity + estimated days to send), sender breakdown in sequence analytics. 39/39 E2E passing. ✅ COMPLETE — PR #34
- **Phase 19**: Multi-User Workspace — domain-based auto-join (any @wrenchlane.com Google login lands in existing workspace), Team Settings page showing members + their Gmail accounts, user avatar/name in sidebar, "Connected by [Name]" on Gmail account cards. 39/39 E2E passing. ✅ COMPLETE — PR #35

### Phase 14 — Pre-CC Checklist
1. Make sure PRs #13 and #14 are both merged to main
2. Run `git pull origin main` in local repo to sync
3. No env vars needed for this phase — all infra is already in place
4. **CC prompt:** `docs/prompts/phase14-inbox.md`

### Phase 14 — What CC builds
- DB migration: new `inbox_messages` table + `gmail_thread_id` column on `email_queue`
- Fixes the reply detection bug in `check-replies` cron (replies were never actually being detected)
- Stores Gmail thread ID when sending emails (process-emails cron update)
- `/inbox` page: conversation list (left panel) + thread view + reply composer (right panel)
- Category tagging: Interested / Not Interested / OOO / Other
- "Mark Interested" → auto-sets contact lead_status to 'qualified'
- Unread count badge in sidebar nav
- 3 E2E smoke tests

## Route Structure
Routes use (dashboard) route group — URLs are /contacts, /deals, /sequences etc. (NOT /dashboard/contacts).

## Workspace
- workspace_id: d946ea1f-74b4-492e-ae6a-d50f59ff04f0
- user_id: efbb6895-cd62-467b-b2dd-d164ec25a7fd
- domain: wrenchlane.com

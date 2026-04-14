# CRM Project Status
Last updated: 2026-04-14 (Workflow migration: CC now owns merge+deploy+test loop. GitHub Actions CI added. Vercel auto-deploy reconnected. PR #42)

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
| **Next** | Scrape more countries (SE, FI, LV, LT, NO, DK) via Apify + enrich owner contacts via Vibe Prospecting | 🔜 | — |

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

### discovered_shops data by country
| Country | Scraped | Total | With Email | With Phone | Unique Cities | Status |
|---------|---------|-------|------------|------------|---------------|--------|
| Estonia (EE) | 2026-04-02 | 814 | 335 (41%) | 758 (93%) | 251 | ✅ In Supabase |
| Lithuania (LT) | 2026-04-02 | 1999 | 667 (33%) | 1833 (92%) | 322 | ✅ In Supabase |
| Sweden (SE) | — | — | — | — | — | 🔜 Next |

### Import scripts (in `/scripts/`)
- `scripts/import-estonia-shops.mjs` — Estonia (814 shops, reads local JSON data file)
- `scripts/import-lithuania-shops.mjs` — Lithuania (1999 shops, fetches from Apify dataset 96U2txGRRVKHyBPsF, needs APIFY_TOKEN env var)
- Data files: `scripts/[country]-shops-data.json` (generated by Cowork, gitignored)

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

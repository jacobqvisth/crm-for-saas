# CRM Project Status
Last updated: 2026-03-31 (Phase 10 merged — campaign launch + analytics live)

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
| **12a** | **Prospector (contact discovery via Prospeo.io)** | **CC prompt written — ready to run in parallel with Phase 10** | — |

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
18 tables with RLS, all created via Supabase migrations:
workspaces, workspace_members, contacts, companies, pipelines, deals, deal_contacts, activities, contact_lists, contact_list_members, gmail_accounts, email_templates, sequences, sequence_steps, sequence_enrollments, email_queue, email_events, unsubscribes

Key RLS note: workspace_members uses special non-recursive policies. Do NOT add policies that self-reference workspace_members directly.

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

### Sync Sequence (strict order)
1. `git pull origin main` — sync local with GitHub
2. Cowork writes changes (prompts, docs, CLAUDE.md updates)
3. Commit and push — so GitHub has Cowork's changes
4. CC starts new session — reads from GitHub, gets everything
5. CC builds on new branch → PR
6. Jacob merges PR on GitHub
7. `git pull origin main` — sync local again before next round

**Rule: always pull before writing, always push before CC starts.**

### CC Session Practice
- Always start a new CC session for each phase/prompt
- CC reads CLAUDE.md automatically for project conventions
- CC creates a new branch, never commits to main directly

## Deployment
- **Vercel project**: crm-for-saas (team: jacobqvisths-projects)
- **Production URL**: https://crm-for-saas.vercel.app
- **GitHub**: https://github.com/jacobqvisth/crm-for-saas (auto-deploys on push to main)
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

## Roadmap
See `docs/roadmap.md` for the full post-Phase-8 plan. Summary:
- **Phase 9**: Production deployment + real data loading ✅ COMPLETE (2 manual steps still needed — see above)
- **Phase QA**: ✅ Complete. 34/34 Playwright E2E tests passing against production. Prompt: vault `02_Projects/wrenchlane-crm/cc-prompt-phase-qa.md`
- **Phase 10**: First real email campaign ✅ COMPLETE — campaign launch modal, preflight API, analytics page, bounce suppression
- **Phase 11**: Sender warmup + deliverability
- **Phase 12a**: Prospector — contact discovery via Prospeo.io ← READY (run parallel with Phase 10)
- **Phases 12-16**: Enrichment, AI writer, inbox, meetings, analytics

## Route Structure
Routes use (dashboard) route group — URLs are /contacts, /deals, /sequences etc. (NOT /dashboard/contacts).

## Workspace
- workspace_id: d946ea1f-74b4-492e-ae6a-d50f59ff04f0
- user_id: efbb6895-cd62-467b-b2dd-d164ec25a7fd
- domain: wrenchlane.com

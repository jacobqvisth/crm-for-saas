# Claude Code Instructions

This file tells Claude Code how to work on this project.

## Project Overview

Self-hosted CRM with email sequencing (like HubSpot Sales + Lemlist) for a SaaS company. Manages 10,000+ contacts, tracks company users, and sends automated email sequences through Google Workspace.

**Tech stack:** Next.js 16 (App Router) + Supabase (PostgreSQL) + Tailwind CSS 4 + Vercel + Inngest + Gmail API

## Workflow

**CC owns the full build-test-merge-deploy cycle. Do not wait for Cowork to merge.**

Each CC session follows this loop:

1. `git fetch origin && git rebase origin/main` on a new branch
2. Build the feature
3. Local checks: `npm run build`, `npm run lint`, `npx tsc --noEmit`, `npm run test:e2e:smoke`
4. Push branch, open PR (`gh pr create`), merge immediately (`gh pr merge --squash --repo jacobqvisth/crm-for-saas`)
5. Vercel auto-deploys on every push to `main` — wait up to 90 s and verify the deploy URL is live (`curl -I https://crm-for-saas.vercel.app`)
6. Append to `cc-session-log.md`: phase/task, date, PR #, branch, bullet list of what was built, build status, deploy URL, anything skipped or notable
7. Done. No hand-off to Cowork needed.

**Cowork's role** is now only: write prompts (in the vault, not this repo), update `PROJECT-STATUS.md` based on `cc-session-log.md`, fix-forward if CI fails (check with `gh run list --branch main --limit 5`).

**GitHub Actions CI** runs on every push to `main` and every PR — it's a safety net, not a gate. CC does not wait for it. If it fails, fix forward in the next session.

## Autonomy

Work as autonomously as possible. Do not ask for clarification on small decisions — make a reasonable choice and move on. Only stop and ask when:
- You are about to do something irreversible that affects production data
- A task requires credentials or secrets you don't have
- You are genuinely blocked and cannot proceed without a decision from Jacob

For everything else: make a decision, document it briefly in your commit message, and keep going.

## Permissions

You have full permission to run any of the following without asking:
- Any shell or bash commands (`ls`, `cat`, `find`, `mkdir`, `cp`, `mv`, `rm`, etc.)
- Any npm/npx commands (`npm install`, `npm run build`, `npm run lint`, `npm run test:e2e`, `npx playwright`, etc.)
- Any git commands (`git status`, `git add`, `git commit`, `git push`, `git pull`, `git branch`, `git log`, etc.)
- Any file read/write/edit operations anywhere in this project

You do NOT need to ask permission before running these. Just run them.

## Git Rules

- **Always create a new branch** for each task. Never commit directly to `main`.
- Branch naming: `feature/short-description`, `fix/short-description`, or `chore/short-description`
- Commit frequently with clear messages describing what changed and why
- Push the branch, open a PR (`gh pr create`), then merge it yourself (`gh pr merge --squash --repo jacobqvisth/crm-for-saas`)
- **Always fetch and rebase on latest `origin/main`** before starting work

## Architecture — IMPORTANT

### Route Structure
This app uses a `(dashboard)` route group for layout only. Routes are:
- `/dashboard` → `src/app/(dashboard)/dashboard/page.tsx`
- `/contacts` → `src/app/(dashboard)/contacts/page.tsx`
- `/companies` → `src/app/(dashboard)/companies/page.tsx`
- `/deals` → `src/app/(dashboard)/deals/page.tsx`
- `/sequences` → `src/app/(dashboard)/sequences/page.tsx`
- `/lists` → `src/app/(dashboard)/lists/page.tsx`
- `/templates` → `src/app/(dashboard)/templates/page.tsx`
- `/settings` → `src/app/(dashboard)/settings/page.tsx`

**Routes are NOT prefixed with `/dashboard/`.** The sidebar links use `/contacts`, `/deals`, etc. The middleware protects all these routes (see `src/lib/supabase/middleware.ts`).

### Supabase Clients
- **Browser (client components):** `import { createClient } from "@/lib/supabase/client"`
- **Server (server components, API routes):** `import { createClient } from "@/lib/supabase/server"`
- Do NOT create new Supabase clients. Use these existing ones.

### Workspace Context
- Client components get `workspaceId` via the `useWorkspace()` hook from `@/lib/hooks/use-workspace`
- **Always guard with `if (!workspaceId) return;`** and show a toast error — never fail silently
- All Supabase queries on workspace-scoped tables must filter by `workspace_id`

### RLS (Row-Level Security)
- All 18 tables have RLS enabled
- Most tables use: `workspace_id IN (SELECT get_user_workspace_ids())`
- `get_user_workspace_ids()` is a SECURITY DEFINER function — it bypasses RLS internally
- **`workspace_members` table has special policies** — do NOT add policies that self-reference `workspace_members` directly (causes infinite recursion). Use `user_id = auth.uid()` or SECURITY DEFINER helper functions instead.

### Database Schema
All tables already exist in Supabase. Do NOT create new tables or run migrations unless explicitly asked. The tables are:
- **Core CRM:** workspaces, workspace_members, contacts, companies, pipelines, deals, deal_contacts, activities
- **Legacy staging:** discovered_shops (unused in this project). The contractor-directory scrape pipeline now lives in jacobqvisth/result-insurance against Supabase project ugibcnidxrhcxflqamxs. Do **not** write to this table from crm-saas jobs. If a CRM-prospecting scrape feature is ever added here, start a fresh table rather than reusing this schema.
- **Lists:** contact_lists, contact_list_members
- **Email:** gmail_accounts, email_templates, sequences, sequence_steps, sequence_enrollments, email_queue, email_events, unsubscribes

### contacts — full field list
id, workspace_id, email (required), first_name, last_name, phone, title, city, country, country_code, address, postal_code, company_id (FK → companies), is_primary, status, lead_status, source, email_status, email_verified_at, seniority, linkedin_url, instagram_url, facebook_url, all_emails TEXT[], all_phones TEXT[], language, tags TEXT[], notes, last_contacted_at, custom_fields JSONB, created_at, updated_at

Key notes:
- One contact → one company (company_id nullable). No multi-company associations.
- `is_primary` marks the primary contact at a company (boolean, default false)
- `language` = 2-letter locale code: et, sv, fi, lv, lt, no, da — determines which sequence variant to enroll in
- `all_emails` / `all_phones` = extra emails/phones scraped from website; `email` is the one used by sequences
- `tags` = free-form array e.g. ['owner', 'decision-maker', 'vip']
- `source` = 'csv' | 'discovery' | 'manual' | 'prospeo'

### companies — full field list
id, workspace_id, name (required), domain, website, phone, address, city, postal_code, country, country_code, industry, category, description, employee_count, annual_revenue, revenue_range, founded_year, linkedin_url, instagram_url, facebook_url, google_place_id, rating DECIMAL(3,1), review_count, tech_stack TEXT[], parent_company_id (FK → companies self-ref), tags TEXT[], notes, custom_fields JSONB, created_at, updated_at

Key notes:
- `parent_company_id` = self-referencing FK for chain/franchise hierarchy (e.g. Mekonomen AB → local Mekonomen shops). One level deep is enough.
- `google_place_id` = ties company back to Apify scrape source
- `rating` / `review_count` = Google Maps rating, useful for ICP scoring
- `category` = shop type: 'auto repair', 'tire shop', 'bodywork', etc.
- `tags` = free-form array e.g. ['chain', 'franchise', 'independent', 'vip', 'skip']

### Supabase Project
- Project ID: `wdgiwuhehqpkhpvdzzzl`
- The `update_updated_at` trigger exists on all tables — `updated_at` is auto-maintained

## Code Conventions

- TypeScript everywhere — no `any` types unless truly unavoidable
- Use Tailwind CSS v4 for all styling
- Use the existing Supabase clients from `src/lib/supabase/` — do not create new clients
- Keep components in `src/components/`, pages in `src/app/(dashboard)/`
- Use Zod for any form validation or API input validation
- Use `react-hot-toast` for user-facing notifications (success, error)
- Use `lucide-react` for all icons
- Use `@hello-pangea/dnd` for drag and drop (already installed)
- Use `date-fns` for date formatting (already installed)
- Use `papaparse` for CSV parsing (already installed)

## What Not to Touch

- `.env.local` — never modify or read secrets
- `src/middleware.ts` — only modify if explicitly asked
- Database schema — propose changes via a migration file, don't run them automatically

## Before Finishing a Task

- Make sure the app builds without errors (`npm run build`)
- Run the linter (`npm run lint`) — uses `eslint src/` (note: `next lint` was removed in Next.js 16)
- Run type check (`npx tsc --noEmit`)
- If E2E tests exist: run `npm run test:e2e:smoke` (if a dev server is running) to catch obvious regressions before committing
- If you added a new page or feature, briefly describe how to test it in the PR
- **Append a session summary to `cc-session-log.md`** — this is how Cowork (the planning agent) knows what you built. Include: phase/task name, date, PR number, branch, bullet list of what was built, build status, and any notable decisions or skipped items. Keep it factual and brief.

## Testing

The QA phase is complete. The project has a Playwright E2E test suite with 33 tests — all passing against production.

**Running tests:**
```bash
# Smoke tests (no auth, ~5s) — run locally during development
npm run test:e2e:smoke

# Full suite against production
TEST_BASE_URL=https://crm-for-saas.vercel.app npm run test:e2e

# View HTML report
npm run test:e2e:report
```

Tests live in `e2e/`. The test user is created via Supabase service role (not Google OAuth).
Do NOT commit `e2e/.auth/user.json` — it contains session tokens and is gitignored.

## Build Phases (for reference)

- Phase 1: Scaffolding + Auth + Dashboard layout ✅
- Phase 2: Contacts + Companies + CSV Import ✅
- Phase 3: Deals Pipeline (Kanban board) ✅
- Phase 4: Gmail Integration (OAuth, sending engine) ✅
- Phase 5: Email Sequences (Lemlist-like builder + Inngest execution) ✅
- Phase 6: Email Tracking (open pixel, click wrapping, unsubscribe) ✅
- Phase 7: Contact Lists + Smart Lists ✅ (PR #8)
- Phase 8: Dashboard + Reports ✅ (PR #9)
- Phase 9: Production Deployment + Vercel ✅
- Phase QA: Playwright E2E test suite ✅ 33/33 tests passing (PR #10)

**Core build + deployment complete.** See `docs/roadmap.md` for active and upcoming phases.

## Maintenance Cadence

Before signing off on any session, run these checks:

1. `npm run build` — must pass with 0 errors
2. `npm run lint` — fix any new warnings introduced by this session
3. `npx tsc --noEmit` — no type errors

Every 3–4 phases, a dedicated health check session runs: lint to zero, dead code removal, `npm audit`, `npx depcheck`, git branch cleanup, env var audit, TODO sweep, and CLAUDE.md freshness check.

## Key Files

- `CLAUDE.md` — CC reads this automatically. Project conventions and architecture.
- `PROJECT-STATUS.md` — Cowork's persistent memory. Updated after each phase.
- `cc-session-log.md` — CC appends a summary here after every session. Cowork reads this at startup to know what was last built.
- CC prompts are stored in Jacob's planning vault and pasted in at session start — they are not in this repo.
- `docs/icp/` — ICP research, personas, market data for email content.

---

## Vercel Build Cost Optimization (added 2026-04-22)

### Ignored Build Step (ignoreCommand)
The **crm-for-saas** Vercel project has this command set in project settings:
```
git diff HEAD^ HEAD --quiet -- src/ public/ package.json package-lock.json next.config.ts next.config.js next.config.mjs tsconfig.json middleware.ts middleware.js
```
Builds are SKIPPED when only docs/, scripts/, supabase/, _reference/, cc-session-log.md, etc. change.
Builds run when src/, public/, or config files change.

### Build Machine
Switched from **Turbo** to **Standard** (cheaper). Change back in Vercel project settings if builds are slow.

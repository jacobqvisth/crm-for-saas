# Claude Code Instructions

This file tells Claude Code how to work on this project.

## Project Overview

Self-hosted CRM with email sequencing (like HubSpot Sales + Lemlist) for a SaaS company. Manages 10,000+ contacts, tracks company users, and sends automated email sequences through Google Workspace.

**Tech stack:** Next.js 16 (App Router) + Supabase (PostgreSQL) + Tailwind CSS 4 + Vercel + Inngest + Gmail API

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
- Any TypeScript/Node commands needed for development

You do NOT need to ask permission before running these. Just run them.

## Development Workflow

This project uses two AI agents coordinated by Jacob:

- **Cowork** (Claude in Cowork mode): Architecture, planning, prompts, debugging, database management, docs. Reads/writes directly to the local repo folder.
- **Claude Code** (CC, Claude desktop app in Code mode): Builds features from prompts. Creates branches, commits, pushes, opens PRs. Each phase = one new CC session.

### The Sync Sequence (IMPORTANT)

The local folder, GitHub, and both agents must stay in sync. This is the strict order:

1. **Before Cowork writes anything:** `git pull origin main` to get latest from GitHub
2. **Cowork writes** (prompts, CLAUDE.md updates, docs, etc.)
3. **Commit and push** Cowork's changes so they're on GitHub
4. **CC starts a new session** — it reads from GitHub, so it gets everything
5. **CC builds** on a new branch, opens a PR
6. **Jacob merges** the PR on GitHub
7. **`git pull origin main`** to sync local folder before Cowork touches anything again

Breaking this sequence causes conflicts. The rule: **always pull before writing, always push before CC starts.**

### Git Rules for CC

- **Always create a new branch** for each task. Never commit directly to `main`.
- Branch naming: `feature/short-description`, `fix/short-description`, or `chore/short-description`
- Commit frequently with clear messages describing what changed and why
- After completing a task, push the branch and open a PR to `main`
- In the PR description, briefly summarize what was done and if there is anything Jacob should review or decide
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
- **Lists:** contact_lists, contact_list_members
- **Email:** gmail_accounts, email_templates, sequences, sequence_steps, sequence_enrollments, email_queue, email_events, unsubscribes

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

**Core build + deployment complete.** Phase 10 (campaign execution infrastructure) prompt is ready. See `docs/roadmap.md` for Phases 10-16.

## Maintenance Cadence

Before signing off on any session, run these checks:

1. `npm run build` — must pass with 0 errors
2. `npm run lint` — fix any new warnings introduced by this session
3. `npx tsc --noEmit` — no type errors

After every deploy, the full E2E suite must pass:
```bash
TEST_BASE_URL=https://crm-for-saas.vercel.app npm run test:e2e
```

Every 3–4 phases, a dedicated health check session runs: lint to zero, dead code removal, `npm audit`, `npx depcheck`, git branch cleanup, env var audit, TODO sweep, and CLAUDE.md freshness check.

## Key Files

- `CLAUDE.md` — CC reads this automatically. Project conventions and architecture.
- `PROJECT-STATUS.md` — Cowork's persistent memory. Updated after each phase.
- `docs/prompts/` — All CC build prompts archived here.
- `docs/icp/` — ICP research, personas, market data for email content.

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

## Git Workflow

- **Always create a new branch** for each task. Never commit directly to `main`.
- Branch naming: `feature/short-description`, `fix/short-description`, or `chore/short-description`
- Commit frequently with clear messages describing what changed and why
- After completing a task, push the branch and open a PR to `main`
- In the PR description, briefly summarize what was done and if there is anything Jacob should review or decide

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
- Run the linter (`npm run lint`)
- If you added a new page or feature, briefly describe how to test it in the PR

## Build Phases (for reference)

- Phase 1: Scaffolding + Auth + Dashboard layout ✅
- Phase 2: Contacts + Companies + CSV Import ✅
- Phase 3: Deals Pipeline (Kanban board) ← NEXT
- Phase 4: Gmail Integration (OAuth, sending engine)
- Phase 5: Email Sequences (Lemlist-like builder + Inngest execution)
- Phase 6: Email Tracking (open pixel, click wrapping, unsubscribe)
- Phase 7: Contact Lists + Smart Lists
- Phase 8: Dashboard + Reports

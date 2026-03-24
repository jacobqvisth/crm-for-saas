# CRM Project Status
Last updated: 2026-03-24 (Phase 7 merged)

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
| 8 | Dashboard + Reports | ⏳ Pending | — |

## Bugs Fixed (not by CC)
- RLS infinite recursion on workspace_members — replaced self-referencing policies with auth.uid() + SECURITY DEFINER helpers
- Auth callback inserting non-existent 'slug' column — removed from insert
- Generated TypeScript types had 'slug' instead of 'domain' and 'google_workspace_domain'
- Middleware only protected /dashboard/* — updated to protect all app routes
- Nested duplicate directory /crm-for-saas/crm-for-saas/ — deleted

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

## Route Structure
Routes use (dashboard) route group — URLs are /contacts, /deals, /sequences etc. (NOT /dashboard/contacts).

## Workspace
- workspace_id: d946ea1f-74b4-492e-ae6a-d50f59ff04f0
- user_id: efbb6895-cd62-467b-b2dd-d164ec25a7fd
- domain: wrenchlane.com

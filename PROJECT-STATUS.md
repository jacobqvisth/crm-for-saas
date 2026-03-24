# CRM Project Status
Last updated: 2026-03-24

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
| 5 | Email Sequences (Lemlist-like builder + Inngest) | 🔄 In Progress | — |
| 6 | Email Tracking (open pixel, click wrapping) | ⏳ Pending | — |
| 7 | Contact Lists + Smart Lists | ⏳ Pending | — |
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

## Process
- Cowork (this session) handles: planning, prompts, database fixes, debugging, architecture
- Claude Code handles: building features from prompts, creating branches/PRs
- Each phase: new CC session → paste prompt → CC builds on new branch → PR → merge → next phase
- CC reads CLAUDE.md for project conventions and architecture context

## Route Structure
Routes use (dashboard) route group — URLs are /contacts, /deals, /sequences etc. (NOT /dashboard/contacts).

## Workspace
- workspace_id: d946ea1f-74b4-492e-ae6a-d50f59ff04f0
- user_id: efbb6895-cd62-467b-b2dd-d164ec25a7fd
- domain: wrenchlane.com

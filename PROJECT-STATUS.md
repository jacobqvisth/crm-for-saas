# CRM Project Status
Last updated: 2026-03-26 (Phase 9 in progress — deployed to Vercel)

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
| 9 | Production Deployment + Vercel | 🔄 In Progress | — |

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

## Deployment
- **Vercel project**: crm-for-saas (team: jacobqvisths-projects)
- **Production URL**: https://crm-for-saas.vercel.app
- **GitHub**: https://github.com/jacobqvisth/crm-for-saas (auto-deploys on push to main)
- **Cron jobs** (vercel.json): process-emails (*/5 min), check-replies (*/30 min), reset-daily-sends (midnight UTC)
- **Google OAuth redirect URI to add**: https://crm-for-saas.vercel.app/api/auth/callback/google
- **Supabase auth redirect to add**: https://crm-for-saas.vercel.app/auth/callback

## Roadmap
See `docs/roadmap.md` for the full post-Phase-8 plan. Summary:
- **Phase 9**: Production deployment + real data loading ← IN PROGRESS
- **Phase 10**: First real email campaign
- **Phase 11**: Sender warmup + deliverability
- **Phases 12-16**: Enrichment, AI writer, inbox, meetings, analytics

## Route Structure
Routes use (dashboard) route group — URLs are /contacts, /deals, /sequences etc. (NOT /dashboard/contacts).

## Workspace
- workspace_id: d946ea1f-74b4-492e-ae6a-d50f59ff04f0
- user_id: efbb6895-cd62-467b-b2dd-d164ec25a7fd
- domain: wrenchlane.com

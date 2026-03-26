# Cowork Session Startup — Wrenchlane CRM
*Read this at the start of every Cowork session on this project.*

---

## Step 1: Orient yourself

Read these files in order before doing anything else:

```bash
# 1. Vault bootstrap (tools, conventions, all projects)
/Users/jacobqvisth/Documents/First Vault/_System/cowork-instructions.md

# 2. Vault persistent memory (current focus, last session, decisions)
/Users/jacobqvisth/Documents/First Vault/CLAUDE.md

# 3. CRM current state (phases, architecture, deployment, env vars)
/Users/jacobqvisth/crm-for-saas/PROJECT-STATUS.md

# 4. CC's instruction file (architecture rules, RLS, coding conventions)
/Users/jacobqvisth/crm-for-saas/CLAUDE.md

# 5. Which prompts have been written (tells you where the build is)
ls /Users/jacobqvisth/crm-for-saas/docs/prompts/
```

Then sync the repo:
```bash
cd /Users/jacobqvisth/crm-for-saas && git pull origin main
```

---

## Step 2: Understand the current project state

**Production:** https://crm-for-saas.vercel.app
**GitHub:** https://github.com/jacobqvisth/crm-for-saas (auto-deploy on push to main)
**Supabase:** `wdgiwuhehqpkhpvdzzzl`
**Stack:** Next.js 16 + Supabase + Tailwind CSS 4 + Inngest + Gmail API

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Scaffolding + Auth + Dashboard | ✅ |
| 2 | Contacts + Companies + CSV Import | ✅ |
| 3 | Deals Pipeline (Kanban) | ✅ |
| 4 | Gmail Integration | ✅ |
| 5 | Email Sequences + Inngest | ✅ |
| 6 | Email Tracking | ✅ |
| 7 | Contact Lists + Smart Lists | ✅ |
| 8 | Dashboard + Reports | ✅ |
| 9 | Production Deployment | ✅ |
| **QA** | **Playwright E2E test suite** | **Next** |
| 10 | First real email campaign | Planned |

**Two manual steps Jacob still needs to complete (Phase 9):**
1. Supabase → Auth → URL Config → add: `https://crm-for-saas.vercel.app/auth/callback`
2. Google Cloud Console → OAuth 2.0 → add redirect URI: `https://crm-for-saas.vercel.app/api/auth/gmail/callback`

---

## Step 3: Agent roles and workflow

### Who does what
| Task | Who |
|------|-----|
| Architecture, planning, prompt writing | Cowork |
| Writing CC prompts | Cowork |
| Supabase SQL/migrations | Cowork (via Supabase MCP) |
| Building features | Claude Code (CC) |
| Merging PRs | Jacob |
| Deploying to Vercel | GitHub auto-deploy on push to main |
| Running E2E tests after deploy | Cowork (once QA phase complete) |
| Updating docs and vault | Cowork |

### The sync sequence (strict order — do not skip steps)
1. `git pull origin main` — sync local with GitHub before touching anything
2. Cowork writes changes (prompts, docs, CLAUDE.md updates)
3. Commit and push — so GitHub has Cowork's changes
4. CC starts a new session — reads from GitHub
5. CC builds → opens PR
6. Jacob merges PR on GitHub
7. `git pull origin main` — sync again before next Cowork session

**Always pull before writing. Always push before CC starts.**

---

## Step 4: How to write a CC prompt

Store prompts in `docs/prompts/` inside this repo (e.g., `docs/prompts/phase-qa.md`).

Every CC prompt must include:

1. **Context block** — what already exists: tables, API routes, pages, env vars. Write it out explicitly. CC should not have to infer state from the codebase.
2. **Goal** — one sentence: what Jacob can do when this phase is done.
3. **Numbered steps** — each step = one file, component, or route. Include exact file paths and code scaffolding.
4. **Database migrations** — create the SQL file; tell CC NOT to run it (Cowork runs migrations via Supabase MCP).
5. **Environment variables** — list any new ones needed; tell CC to add them to `.env.local` comments.
6. **Final Verification** — last numbered step. CC must run `npm run build && npm run lint`. If E2E tests exist: `npm run test:e2e:smoke`. CC describes how to manually verify the feature.
7. **Deliverable** — user-facing: "Jacob can now do X."

See `docs/prompts/phase-qa.md` and `docs/process-audit.md` for the reference format.

---

## Step 5: Before telling Jacob a phase is done

- [ ] Prompt written and committed to `docs/prompts/`
- [ ] Any Supabase migrations applied via Supabase MCP (if needed)
- [ ] Any new env vars added to Vercel (via Vercel MCP or documented for Jacob)
- [ ] `git pull origin main` after Jacob merges the PR
- [ ] *(Once QA phase complete)* Run `TEST_BASE_URL=https://crm-for-saas.vercel.app npm run test:e2e` and verify all pass
- [ ] Update `PROJECT-STATUS.md` with phase status and next steps
- [ ] Update vault `CLAUDE.md` current focus section

---

## Step 6: Key files and paths

| File | Purpose |
|------|---------|
| `/Users/jacobqvisth/crm-for-saas/CLAUDE.md` | CC's instruction file. Contains architecture rules, RLS notes, coding conventions. |
| `/Users/jacobqvisth/crm-for-saas/PROJECT-STATUS.md` | Cowork's persistent memory. Update after every session. |
| `/Users/jacobqvisth/crm-for-saas/docs/prompts/` | All CC build prompts (phase1.md–phase8.md, phase-qa.md, ...) |
| `/Users/jacobqvisth/crm-for-saas/docs/process-audit.md` | Gap analysis vs. job-app platform. Read before major decisions. |
| `/Users/jacobqvisth/crm-for-saas/docs/roadmap.md` | Post-Phase-9 roadmap (Phases 10–16) |
| `Vault: 02_Projects/wrenchlane-crm/` | Vault notes for this project |
| `Vault: _System/cowork-instructions.md` | Master bootstrap file (all projects) |

---

## Key architectural rules (quick reference)

- Routes use `(dashboard)` group: URLs are `/contacts`, `/deals`, etc. — NOT `/dashboard/contacts`
- RLS: most tables use `get_user_workspace_ids()` SECURITY DEFINER function
- `workspace_members` has special non-recursive policies — do NOT add self-referencing policies
- Always use `useWorkspace()` hook in client components for `workspaceId`
- Supabase clients: `@/lib/supabase/client` (browser) or `@/lib/supabase/server` (server)
- Do NOT run migrations directly — create SQL files, apply via Supabase MCP

---

*Last updated: 2026-03-26 by Cowork (Process Audit session)*

# Cowork Session Prompt — Process Audit & CRM Alignment

> Paste this at the start of a new Cowork session.
> Purpose: Investigate how the Job Application Platform is built and operated end-to-end,
> document what's different from the CRM project, and produce a concrete upgrade plan
> for how the CRM should work going forward.

---

## What This Session Is About

You are picking up two active projects. The CRM project (Wrenchlane CRM for SaaS) just completed
Phase 9 (production deployment) in the previous session. Before continuing with Phase 10, we want
to pause and audit the *process* — not the code.

The Job Application Platform was built by the same people (Jacob + Cowork + CC) but developed
a more mature workflow over 7+ phases. It has things the CRM doesn't: automated E2E testing,
structured session startup files, worktree-based CC workflow, post-deploy test verification,
and a rich Vault-based planning structure. The CRM evolved more organically.

This session's job: **read and understand how the job application project actually works at every
step, from planning through to deploying and verifying**, then produce a gap analysis and a
concrete set of changes to bring the CRM workflow up to the same standard.

---

## Step 1 — Read Your Persistent Memory

Before anything else, access the vault:

1. Request access to `/Users/jacobqvisth/Documents/First Vault/`
2. Read `_System/cowork-instructions.md` — this is the master session bootstrap file
3. Read `CLAUDE.md` in the vault root — Cowork's persistent memory across projects
4. Then request access to `/Users/jacobqvisth/crm-for-saas/` for the CRM project
5. Read `PROJECT-STATUS.md` in the CRM root — the current state of the CRM

---

## Step 2 — What Was Built in the Previous CRM Session

The previous Cowork session (from which this prompt was generated) did the following:

### Phases 1–8 (core build, prior sessions):
- Phase 1: Scaffolding, auth, dashboard shell
- Phase 2: Contacts + Companies + CSV import
- Phase 3: Deals Pipeline (Kanban board with drag-and-drop)
- Phase 4: Gmail Integration (OAuth, token refresh, send engine)
- Phase 5: Email Sequences (Lemlist-style sequence builder + Inngest-based execution)
- Phase 6: Email Tracking (open pixel, click wrapping, unsubscribe handling)
- Phase 7: Contact Lists + Smart Lists
- Phase 8: Dashboard + Reports (date range selector, charts, email performance, pipeline section)

All phases built by Claude Code (Sonnet), each from a prompt in `docs/prompts/`. All merged
to main. CC created branches, opened PRs, Jacob merged.

### Phase 9 (this session — production deployment):
- Vercel project created: `crm-for-saas` (team: `jacobqvisths-projects`)
- Repo linked to GitHub: `jacobqvisth/crm-for-saas` (auto-deploys on push to main)
- All 8 environment variables set on Vercel (with `printf` not `echo` to avoid trailing newline issue)
- `vercel.json` created with 3 cron jobs (process-emails every 5min, check-replies every 30min, reset-daily-sends at midnight UTC)
- Cron route files fixed to export both GET and POST handlers (Vercel crons send GET requests)
- App is live at: **https://crm-for-saas.vercel.app**

### Two manual steps Jacob still needs to do:
1. **Supabase dashboard** → Authentication → URL Configuration → add redirect URL:
   `https://crm-for-saas.vercel.app/auth/callback`
2. **Google Cloud Console** → OAuth 2.0 Credentials → add Authorized Redirect URI:
   `https://crm-for-saas.vercel.app/api/auth/gmail/callback`

### Key facts about the CRM right now:
- **Production URL:** https://crm-for-saas.vercel.app
- **GitHub:** https://github.com/jacobqvisth/crm-for-saas
- **Supabase project:** `wdgiwuhehqpkhpvdzzzl`
- **Tech stack:** Next.js 16 (App Router) + Supabase + Tailwind CSS 4 + Vercel + Inngest + Gmail API
- **No E2E test suite** — this is the biggest gap vs. the job application platform
- **Prompts stored in:** `docs/prompts/` (inside the git repo)
- **CC workflow:** CC creates a branch, commits, opens PR → Jacob merges → git pull → next phase

---

## Step 3 — Investigate the Job Application Platform Process

Now read and understand how the job application project works at every step.
Read these files in order:

1. `/Users/jacobqvisth/Documents/First Vault/02_Projects/job-application-platform/build-plan.md`
   → The master build document. Phases 0–7+. Contains the full workflow diagram (Cowork + CC).
   Pay particular attention to the "Build Workflow" section and "Session workflow" steps.

2. `/Users/jacobqvisth/Documents/First Vault/02_Projects/job-application-platform/cowork-session-start-phase5.md`
   → An example of how a Cowork session is kicked off — what gets read, what gets planned,
   how a CC prompt gets written.

3. `/Users/jacobqvisth/Documents/First Vault/02_Projects/job-application-platform/cowork-session-next-phase-planning.md`
   → A strategic planning session prompt — how architecture decisions are made between phases.

4. `/Users/jacobqvisth/Documents/First Vault/02_Projects/job-application-platform/cc-prompt-phase-5.md`
   → One complete CC prompt. Study its structure: context, goals, database schema,
   exact components to build, API routes, final verification steps.

5. `/Users/jacobqvisth/Documents/First Vault/02_Projects/job-application-platform/cc-prompt-phase-qa.md`
   → The QA prompt. This is the entire Playwright E2E test suite setup.
   Note: the CRM has nothing like this.

6. `/Users/jacobqvisth/Documents/First Vault/02_Projects/job-application-platform/cc-prompt-phase-7a.md`
   → A more recent prompt showing how the format has evolved.
   (If it doesn't exist yet, read cc-prompt-phase-6.md instead.)

7. The `_System/cowork-instructions.md` file you already read has detailed notes under
   "Conventions" and "CC Prompt Conventions" that reflect lessons learned across both projects.
   Re-read those sections now with the job application project context in mind.

Also use Desktop Commander to check:
- `cat /Users/jacobqvisth/job-application-platform/CLAUDE.md` — CC's instructions for that project
- `ls /Users/jacobqvisth/job-application-platform/e2e/` — the actual E2E test files
- `cat /Users/jacobqvisth/job-application-platform/package.json | grep -A5 '"scripts"'` — how tests are run

---

## Step 4 — Produce the Process Audit Report

After reading everything above, produce a written report covering:

### Section A: How the Job Application Platform Process Works (Step-by-Step)

Walk through the complete lifecycle of a single phase in the job application project:

1. **Session startup** — how Cowork orientates itself (what files it reads, in what order)
2. **Strategic planning** — how decisions about *what* to build next are made
3. **Prompt writing** — how a CC prompt is structured, what it always includes, how it's stored
4. **CC builds** — exactly what CC does (worktree? branch? how it commits, how it hands back)
5. **Cowork merges** — how Cowork takes CC's work and integrates it
6. **Deployment** — how the deploy happens (CLI vs. auto-deploy, who runs it)
7. **Testing & verification** — how E2E tests work, what gets verified, what happens if tests fail
8. **Documentation** — what gets updated in the vault and in the repo after each phase
9. **Handoff to next phase** — how state is preserved for the next session

Be specific. Quote the actual commands, file paths, and conventions you discovered.

### Section B: How the CRM Process Currently Works

Walk through the equivalent lifecycle for the CRM, based on what you've read:

1. Session startup (what Cowork reads)
2. Planning (how phases are designed)
3. Prompt storage and structure
4. CC workflow (branch, commit, PR)
5. Deployment (what happened in Phase 9)
6. Testing (what exists — spoiler: nothing automated)
7. Documentation
8. State preservation between sessions

### Section C: Gap Analysis

A direct comparison of the two projects. For each gap, rate severity:
- 🔴 Critical — causes real risk of broken deploys or lost work
- 🟡 Important — causes friction or missed bugs
- 🟢 Nice-to-have — efficiency improvement

| Gap | Job App Platform | CRM For SaaS | Severity |
|-----|-----------------|--------------|----------|
| E2E test suite | Playwright, 65 tests, run on production after every deploy | None | 🔴 |
| CC workflow | Worktrees (`.claude/worktrees/`), Cowork merges | Branch + PR, Jacob merges | 🟡 |
| ... | ... | ... | ... |

Fill in all gaps you find, not just these examples.

### Section D: Recommended Changes for the CRM

For each gap you rated 🔴 or 🟡, produce a concrete recommendation:

- What exactly needs to change
- Who does it (Cowork, CC, or Jacob)
- How long it will take (rough estimate)
- Whether it should be done *before* continuing to Phase 10 or can be deferred

### Section E: Phase 10 Readiness

Based on your audit, answer:
1. Is the CRM ready to start Phase 10 right now, or should we fix the process gaps first?
2. What is the single most important thing to add before running the next CC prompt?
3. If we were to add a QA phase to the CRM (like the job application platform had between Phase 3 and Phase 4), what would it look like? Sketch the Playwright test plan — what are the most critical user flows to cover?

---

## Step 5 — Produce the Deliverables

After the report, produce these concrete files:

### Deliverable 1: `docs/cowork-session-startup.md` (in the CRM repo)

A structured session startup file for the CRM project, equivalent to
`cowork-session-start-phase5.md` in the job application project. It should tell any
future Cowork session exactly what to read, in what order, and what the current state is.
Model it closely on the job application project's format.

### Deliverable 2: Updated `_System/cowork-instructions.md` in the vault

Update the Job Application Platform entry to reflect that Phase 5 and 6 are now complete
(they already are per the build-plan, but the vault bootstrap file may be stale — check and fix).
Also update the CRM entry to reflect Phase 9 complete and production URL:
`https://crm-for-saas.vercel.app`.

### Deliverable 3: `docs/prompts/phase-qa.md` draft (in the CRM repo)

Write a first draft of a QA phase prompt for the CRM. This would tell CC to:
- Install Playwright
- Write E2E tests for the most critical CRM flows (login, contacts CRUD, CSV import, deal
  pipeline drag-and-drop, sequence builder, Gmail connect)
- Configure tests to run against both localhost and the production URL
- Set up `npm run test:e2e` and `npm run test:e2e:smoke` scripts
- Generate an HTML report with screenshots on failure

Base this closely on `cc-prompt-phase-qa.md` from the job application project but
adapted for the CRM's routes, tech, and existing test infrastructure (there is none).

### Deliverable 4: Recommendation memo (short)

A direct, opinionated 1-page recommendation: should we run the QA phase before Phase 10,
or run Phase 10 and QA in parallel? What are the risks of each path?
Jacob can read this and make the call.

---

## Step 6 — Commit and Push

After producing the deliverables:

1. Commit all new files to the CRM repo via Desktop Commander:
   `cd /Users/jacobqvisth/crm-for-saas && git add docs/ && git commit -m "Add process audit docs and QA phase draft prompt" && git push origin main`

2. Update `PROJECT-STATUS.md` to reflect that this session happened and what was produced.

3. Update `_System/cowork-instructions.md` in the vault with current project states.

---

## Tone & Approach

Be direct and analytical. The goal of this session is not to plan features — it is to
strengthen the engineering process around the CRM before the next build phase. Think like
a tech lead who has just joined a project and wants to understand how it runs before
touching the codebase.

Do not skip the gap analysis. The job application project took months to develop the
current process — the CRM can benefit from those lessons immediately.

Jacob's preference: concrete recommendations over options menus. Make a call, explain why,
move on.

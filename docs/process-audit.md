---
type: process-audit
created: 2026-03-26
updated: 2026-03-26
session: Process Audit & CRM Alignment
---

# Process Audit Report — CRM vs. Job Application Platform
*Written by Cowork on 2026-03-26. Purpose: understand the mature workflow that evolved across 7+ phases of the job application project, identify where the CRM falls short, and produce concrete recommendations before Phase 10.*

---

## Section A: How the Job Application Platform Process Works (Step-by-Step)

This is the reference implementation. Every step below is extracted directly from the actual files in the repo and vault — not inferred.

### 1. Session Startup
Cowork reads files in this order at the start of every session:

1. `/Users/jacobqvisth/Documents/First Vault/_System/cowork-instructions.md` — master bootstrap file with project list, tool inventory, conventions, and CC prompt rules
2. `/Users/jacobqvisth/Documents/First Vault/CLAUDE.md` — persistent memory: current priority, last session summary, next steps, key decisions
3. `/Users/jacobqvisth/Documents/First Vault/02_Projects/job-application-platform/build-plan.md` — the canonical phase tracker: what's complete, what's next, the workflow diagram, and the full phase definitions
4. `/Users/jacobqvisth/job-application-platform/CLAUDE.md` — CC's instruction file, read via Desktop Commander. Contains: tech stack, permissions, file structure, env vars, coding conventions

This gives Cowork two layers of context: vault-level (strategy, state) and repo-level (conventions, architecture).

### 2. Strategic Planning
Between major phases, a dedicated `cowork-session-next-phase-planning.md` prompt is written and pasted into a fresh Cowork session. This prompt:
- Loads all research files, feature brainstorms, and strategic analysis
- Poses 3-4 concrete questions (personal vs. product path, feature priority, phase definition)
- Produces: a strategic recommendation, a feature priority stack, a Phase N definition, and an updated build plan section

This is a distinct session type — not a building session. The output is a committed decision and a phase definition, not code.

### 3. Prompt Writing
CC prompts are stored in the **vault** at `02_Projects/job-application-platform/cc-prompt-phase-X.md`. This separates them from the git repo (Cowork authors them in Obsidian). Each prompt follows a consistent structure:
- **Frontmatter**: type, tags, created, updated
- **Context section**: current state (which tables exist, which API routes exist, which pages exist, which env vars are present). This is explicitly written out — CC doesn't have to infer anything.
- **Goal**: one-sentence summary of what Phase N delivers
- **Numbered Steps**: each step corresponds to a file, route, or component. Steps contain full TypeScript code scaffolding, exact file paths, and SQL migrations to create (not run).
- **Important Notes**: edge cases, third-party API quirks, integration warnings
- **Deliverable**: a user-facing description of what Jacob can do when the phase is done
- **E2E test step**: always included as a numbered step — CC writes tests as part of the phase

Prompt length: 200–400+ lines, typically. This is by design — CC gets all context it needs without having to read the whole codebase.

### 4. CC Builds
CC runs in Claude desktop app (Code mode), one new session per phase. It works in a **worktree** — a git working tree on a separate branch (`claude/<name>`), isolated from main. CC:
- Reads `CLAUDE.md` automatically at session start
- Creates the worktree/branch, never commits to main directly
- Builds in numbered steps matching the prompt
- Runs `npm run build` and `npm run lint` before committing
- Opens a PR with a summary of what was built

### 5. Cowork Merges
Cowork — not Jacob — owns the merge step:
```bash
git merge claude/<branch-name> && git push origin main
```
This runs via Desktop Commander. The reason: Cowork immediately follows the merge with a deploy and E2E run. Jacob is not in the loop between merge and verification.

### 6. Deployment
GitHub auto-deploy is **disconnected**. Every deploy is explicit:
```bash
vercel --prod --yes
```
Run by Cowork via Desktop Commander, always from the main branch after merging. This gives Cowork control over deploy timing — it never deploys without running tests afterward.

### 7. Testing & Verification
After every deploy, Cowork runs:
```bash
TEST_BASE_URL=https://job-application-platform-lake.vercel.app npm run test:e2e
```
65 Playwright tests across 11 spec files. If any tests fail:
1. Cowork reads the failure output
2. Fixes the issue (either directly or via a targeted CC prompt)
3. Redeploys
4. Re-runs tests
5. Only tells Jacob "done" when all tests pass

The `npm run test:e2e:smoke` variant (no auth) runs against localhost during CC development as a fast check.

Four test scripts exist in `package.json`:
- `test:e2e` — full suite against production or TEST_BASE_URL
- `test:e2e:ui` — interactive Playwright UI mode
- `test:e2e:smoke` — public pages only, no auth, fast
- `test:e2e:report` — open the HTML report

### 8. Documentation
After each phase:
- `build-plan.md` phase status row updated: `✅ COMPLETE` with link to prompt file
- `cowork-instructions.md` "Current state" line updated for the job-app project
- Vault `CLAUDE.md` "Current Focus" and "Next steps" sections updated
- The CC prompt file committed in the vault is the durable record of what was built and why

### 9. Handoff to Next Phase
State is preserved in two places:
- **`build-plan.md`** — the authoritative phase tracker (what's done, what's next, DB schema evolution, workflow diagram)
- **Vault `CLAUDE.md`** — current focus, last session context, strategic decisions made

A new Cowork session can reconstruct the full project state from these two files alone.

---

## Section B: How the CRM Process Currently Works

### 1. Session Startup
Cowork reads:
1. `cowork-instructions.md` (vault bootstrap)
2. `PROJECT-STATUS.md` (CRM's combined state + conventions file)
3. `CLAUDE.md` in the CRM repo

There is no vault-level build document equivalent to `build-plan.md`. The phase tracker lives inside `PROJECT-STATUS.md` as a table, mixed in with architecture notes, env vars, and workflow rules.

### 2. Planning
Phases are defined inside `PROJECT-STATUS.md`. There are no separate strategic planning session prompts. Phase decisions were made organically during build sessions, not in dedicated planning sessions.

### 3. Prompt Storage and Structure
Prompts are stored in the **git repo** at `docs/prompts/phase{N}.md`. This diverges from the job-app convention (vault-based) and means prompts aren't in Obsidian for wikilinks/search. There's also no explicit convention document for prompt structure.

**Correction made this session:** Phase QA prompt and all future prompts are now stored in the vault at `02_Projects/wrenchlane-crm/cc-prompt-phase-X.md`, matching the job-app convention. The existing phase 1–8 prompts remain in the repo as historical artifacts.

### 4. CC Workflow
CC creates a branch → commits → opens PR → **Jacob merges on GitHub**. Then `git pull origin main`. Cowork is not in the merge loop — Jacob is the integration step between CC's work and what goes to production.

### 5. Deployment
GitHub auto-deploy: push to main → Vercel auto-deploys. No explicit deploy step. Cowork can verify status via Vercel MCP, but doesn't control when the deploy fires.

### 6. Testing
Nothing automated. CC runs:
- `npm run build` — TypeScript/build validation
- `npm run lint` — linting

No Playwright. No smoke tests. No post-deploy verification. The `package.json` has four scripts: `dev`, `build`, `start`, `lint` — no `test:e2e` anything.

### 7. Documentation
`PROJECT-STATUS.md` updated after each session. Vault `CLAUDE.md` has a brief "Current Focus" line. No vault build plan document.

### 8. State Preservation
`PROJECT-STATUS.md` is the single source of truth. It covers phases, architecture, env vars, deployment info, and agent roles in one file. This works but creates a monolithic doc that gets harder to navigate as the project grows.

---

## Section C: Gap Analysis

| Gap | Job App Platform | CRM For SaaS | Severity |
|-----|-----------------|--------------|----------|
| E2E test suite | Playwright, 65 tests, 11 spec files, run on production after every deploy | None | 🔴 Critical |
| Post-deploy verification gate | Automated E2E run blocks Cowork from declaring "done" | No gate — deploy fires and Cowork moves on | 🔴 Critical |
| test:e2e npm scripts | 4 scripts (test:e2e, ui, smoke, report) | Not present | 🔴 Critical |
| CLAUDE.md testing instruction | CC told to run `npm run test:e2e:smoke` as final step | Not mentioned | 🔴 Critical |
| Merge ownership | Cowork merges worktrees directly, controls deploy timing | Jacob merges PRs on GitHub; deploy fires automatically | 🟡 Important |
| Deploy method | Explicit `vercel --prod --yes` via Desktop Commander | GitHub auto-deploy (fire-and-forget on push to main) | 🟡 Important |
| Vault build document | `build-plan.md` — full phase history, workflow diagram, strategic decisions | Phases embedded in `PROJECT-STATUS.md` only | 🟡 Important |
| Session startup file | `cowork-session-start-phase5.md` — dedicated template per major phase | Not present; `PROJECT-STATUS.md` doubles as startup guide | 🟢 Nice-to-have |
| Strategic planning prompts | Dedicated `cowork-session-next-phase-planning.md` for architectural decisions | None — decisions made ad hoc | 🟢 Nice-to-have |
| Prompt file location | Vault (Obsidian-linked, searchable) | Repo `docs/prompts/` (legacy phases 1–8). Corrected: new prompts now go in vault. | 🟢 Fixed |

---

## Section D: Recommended Changes

### 🔴 Gap 1: No E2E test suite
**What to change:** Run a QA phase (this document's Deliverable 3) before Phase 10. CC installs Playwright and writes tests for all critical CRM flows.
**Who:** CC (from `docs/prompts/phase-qa.md` prompt)
**Effort:** 1 CC session (~2 hours)
**When:** Before Phase 10. Non-negotiable. Phase 10 will be the first real email campaign — sending emails to real contacts without being able to verify the app is healthy is unacceptable.

### 🔴 Gap 2: No post-deploy verification
**What to change:** After Phase QA is complete, add this rule to Cowork's workflow: after every deploy, run `TEST_BASE_URL=https://crm-for-saas.vercel.app npm run test:e2e` via Desktop Commander. Block on results. Only tell Jacob it's done when tests pass.
**Who:** Cowork (behavioral change, documented in cowork-instructions.md)
**Effort:** 5 minutes to document; 0 extra effort per deploy once tests exist
**When:** Immediately after Phase QA

### 🔴 Gap 3: No test scripts in package.json
**What to change:** Add `test:e2e`, `test:e2e:ui`, `test:e2e:smoke`, `test:e2e:report` scripts. Playwright init does this automatically, but the phase-qa prompt should explicitly require it.
**Who:** CC (in Phase QA prompt)
**Effort:** Included in Phase QA
**When:** Phase QA

### 🔴 Gap 4: CLAUDE.md has no testing instruction
**What to change:** Add a section to `CLAUDE.md` telling CC: "Before finishing any phase, run `npm run build && npm run lint`. If a dev server is running, also run `npm run test:e2e:smoke`."
**Who:** Cowork (can do this now)
**Effort:** 5 minutes
**When:** Now, this session

### 🟡 Gap 5: Jacob owns the merge step
**What to change:** Evaluate switching to the worktree merge model. **Recommendation: keep Jacob-merges for now.** The CRM uses GitHub auto-deploy (push to main = deploy). Until we switch to explicit CLI deploys, having Cowork merge directly would be equivalent to having Cowork deploy without review. The PR model gives Jacob a lightweight review gate, which is appropriate for a production CRM that will touch real contacts. Revisit when E2E tests give us more confidence.
**When:** Deferred

### 🟡 Gap 6: GitHub auto-deploy is fire-and-forget
**What to change:** Disconnect GitHub auto-deploy. Switch to explicit `vercel --prod --yes` via Desktop Commander, same as the job-app workflow. This lets Cowork control deploy timing and gate on E2E results before declaring success.
**Who:** Jacob (one click in Vercel dashboard to disconnect GitHub integration) then Cowork updates documentation
**Effort:** 10 minutes
**When:** Before Phase 10 (needed to support post-deploy testing gate)

### 🟡 Gap 7: No vault build document
**What to change:** The phase history in `PROJECT-STATUS.md` is sufficient for now. What's missing is a workflow diagram and a statement of "done" for each phase. Consider creating a `docs/build-plan.md` in the repo after Phase QA to house the phase timeline and workflow diagram. Not blocking Phase 10.
**When:** Deferred until after QA phase

---

## Section E: Phase 10 Readiness

### 1. Is the CRM ready to start Phase 10 right now?
**No.** Phase 10 is "First Real Email Campaign" — sending sequences to 10,000+ contacts. Running this without any automated verification that the app is working correctly is a real risk. A silent bug in the sequence enrollment, email queue, or Gmail OAuth refresh could result in no emails going out, duplicate emails, or worse. The QA phase takes one CC session. That's worth doing first.

The two Phase 9 manual steps (Supabase redirect URL, Google OAuth redirect URI) also still need to be completed by Jacob before any email auth flow will work in production.

### 2. Single most important thing before the next CC prompt
**Run the QA phase.** One CC session, one Playwright test suite, and the entire "deploy and pray" model becomes "deploy and verify." Everything else can wait.

### 3. Playwright test plan for a CRM QA phase

If we were to add a QA phase equivalent to the job-app's `cc-prompt-phase-qa.md`, here are the critical flows to cover:

**Smoke (no auth required):**
- Login page loads without console errors
- Unauthenticated users are redirected to `/login`
- All protected routes redirect to `/login`

**Auth & workspace setup:**
- E2E test user can log in via Supabase magic link
- Dashboard loads after login
- Sidebar navigation renders

**Contacts — the most-used feature:**
- Contacts list page loads
- Can add a contact (name, email, company)
- New contact appears in the list
- Can edit a contact
- Can delete a contact
- CSV import: upload a CSV, contacts appear in the list

**Companies:**
- Companies list page loads
- Can create a company
- Company detail page loads

**Deals Pipeline:**
- Deals page loads with Kanban columns (To Contact, Meeting Scheduled, etc.)
- Can create a deal
- Deal appears in the correct column
- *(Skip drag-and-drop in E2E — too flaky, verify visually)*

**Sequences:**
- Sequences list page loads
- Can create a sequence (name, type)
- Can add a step (email, delay)
- Sequence builder saves without error

**Gmail:**
- Settings > Email page loads
- "Connect Gmail" button is visible

**Lists:**
- Lists page loads
- Can create a contact list
- Can view list members

**Email tracking API:**
- `GET /api/track/open/[id]` returns 200 (pixel endpoint should never 404)
- `GET /api/track/click/[id]` returns 302 (redirect without crash)

**API health checks (no auth, verify status codes not content):**
- Unauth access to `/api/contacts` returns 401/403 not 500
- Cron endpoint without CRON_SECRET returns 401

**Expected test count: ~30–40 tests across 8 spec files.**

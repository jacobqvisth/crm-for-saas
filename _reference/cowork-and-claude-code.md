---
type: reference
created: 2026-04-07
tags: [workflow, cowork, claude-code, architecture]
---

# How Cowork and Claude Code Work Together

This document explains the two-agent workflow used in this project, what each tool does best, and why the split exists. Read this whenever you need to understand the development process or decide where a task belongs.

---

## The Two Agents

This project uses two AI agents, both powered by Anthropic's Claude, but running in very different environments:

**Cowork** (Claude in the desktop app, Cowork mode) is the architect, planner, and operations manager. It runs Claude Opus 4.6 — the most capable model — and has access to a wide ecosystem of MCP integrations (Supabase, Gmail, Calendar, Desktop Commander, Vercel, Chrome, etc.). Cowork reads and writes files through mounted folders from Jacob's Mac, and runs shell commands in a sandboxed Linux environment.

**Claude Code** (CC, Claude in the terminal) is the builder. It runs on Jacob's Mac natively, with direct access to the full filesystem, the macOS toolchain (Xcode, simulators, Expo, etc.), and git. By default CC uses Sonnet 4.6, though it can be configured to use other models. CC reads CLAUDE.md automatically when it starts a session and follows the conventions defined there.

---

## What Each Tool Does Best

### Cowork excels at

- **Architecture and planning** — designing systems, writing specs, breaking work into phases
- **Writing CC prompts** — detailed, self-contained build instructions that CC can execute without ambiguity
- **Supabase management** — creating tables, running SQL, deploying Edge Functions, checking RLS policies (via Supabase MCP)
- **PR review and merging** — reading diffs, spotting bugs, pushing fixes, merging via `gh` on Jacob's Mac (via Desktop Commander MCP)
- **Cross-system coordination** — sending emails (Gmail MCP), checking calendar, managing Vercel deployments, browsing the web
- **Research** — web search, reading documentation, analyzing competitors, writing reports
- **Document generation** — Word docs, spreadsheets, presentations, PDFs (via skills)
- **State management** — maintaining COWORK.md as the single source of truth across sessions
- **Spawning sub-agents** — launching parallel workers for independent tasks (e.g., one reviews code while another researches a topic)

### Claude Code excels at

- **Building features** — writing code, creating files, implementing full prompts end-to-end
- **Native toolchain** — running `npx expo start`, testing on iOS simulators, building with Xcode, anything that requires macOS
- **Git workflow** — creating branches, committing, pushing, opening PRs — all natively, no workarounds
- **Debugging** — running the app, seeing real error output, iterating on fixes with the actual development server
- **Testing** — running Playwright E2E tests, Jest unit tests, type checking, linting — all on the real environment
- **Large refactors** — CC can read and modify dozens of files in one session with full filesystem access

### Neither tool alone covers everything

Cowork can't run Expo or test on a phone. CC can't query Supabase directly, send emails, or manage Vercel deployments. The two-agent workflow combines their strengths.

---

## The Development Cycle

Every feature follows this loop:

```
1. Cowork plans    → writes architecture, creates DB tables, writes CC prompt
2. CC builds       → creates branch, writes code, runs checks, opens PR
3. Cowork reviews  → reads PR diff, pushes fixes, merges, verifies CI
4. Cowork updates  → updates COWORK.md, pulls main on Jacob's Mac
```

### The Sync Sequence (Critical)

The local folder, GitHub, and both agents must stay in sync. This is the strict order:

1. **Before Cowork writes anything:** `git pull origin main` to get latest from GitHub
2. **Cowork writes** (prompts, docs, CLAUDE.md updates, etc.)
3. **Commit and push** Cowork's changes so they're on GitHub
4. **CC starts a new session** — it reads from GitHub, so it gets everything
5. **CC builds** on a new branch, opens a PR
6. **Cowork handles the full merge/deploy loop** — Jacob does not need to do anything
7. **`git pull origin main`** to sync local folder before Cowork touches anything again

Breaking this sequence causes git conflicts. The rule: **always pull before writing, always push before CC starts.**

---

## Technical Differences

| | Cowork (desktop app) | Claude Code (terminal) |
|---|---|---|
| **Model** | Opus 4.6 | Sonnet 4.6 (default, configurable) |
| **Runs where** | Sandboxed Linux container | Jacob's Mac natively |
| **File access** | Mounted folders from Mac (read/write) | Full filesystem, direct |
| **Shell** | Linux sandbox (Node, npm, Python, git) | macOS (everything installed) |
| **Git** | Via Desktop Commander MCP on Jacob's Mac | Native — branch, commit, push, PR |
| **MCP integrations** | Supabase, Gmail, Calendar, Desktop Commander, Vercel, Chrome, Apify, etc. | Configurable, fewer by default |
| **Testing** | `npm run build`, `npx tsc`, lint (in sandbox) | Full: Expo, simulators, Playwright, device testing |
| **Context** | Reads COWORK.md, memories, mounted files | Reads CLAUDE.md, git history, full repo |
| **Sub-agents** | Can spawn parallel agents (opus/sonnet/haiku) | Single session, sequential |
| **Strengths** | Planning, MCPs, coordination, research, docs | Building, testing, native toolchain, git |

---

## Sub-Agents (Cowork Feature)

Cowork can spawn sub-agents — independent worker processes that run in parallel. Each gets its own fresh context and can use a different model.

**When to use sub-agents:**
- Two independent research tasks (e.g., explore mobile app structure AND web app data patterns)
- Review code while simultaneously checking CI status
- Any tasks that don't depend on each other's output

**Model selection for sub-agents:**
- **Opus** — complex reasoning, architecture decisions, thorough code review
- **Sonnet** — standard coding tasks, moderate complexity
- **Haiku** — simple lookups, file copying, documentation updates

Sub-agents cannot interact with Jacob or ask questions. They run autonomously and return results to Cowork, which coordinates.

---

## When to Use What

**Use Cowork when:**
- Planning a new feature or phase
- Creating or modifying Supabase tables, RLS policies, Edge Functions
- Writing CC prompts
- Reviewing and merging PRs
- Sending emails or checking calendar
- Managing Vercel deployments
- Doing research or competitive analysis
- Generating documents (Word, Excel, PDF, PowerPoint)
- Any task that needs multiple MCP integrations

**Use CC (paste prompt) when:**
- Building a feature from a prompt
- Writing code across multiple files
- Running the app and testing interactively
- Debugging with real error output
- Creating git branches and PRs
- Running E2E tests
- Anything that needs the native macOS toolchain

**Either could work, but prefer Cowork for:**
- Quick file edits that don't need testing
- Updating CLAUDE.md or documentation
- Small bug fixes where you already know the fix

**Either could work, but prefer CC for:**
- Any change that should be tested before merging
- Multi-file refactors
- Adding new dependencies (`npm install`)

---

## Key Files

- **COWORK.md** — Cowork's state file. Read at session start, updated at session end. Contains current state, what's been done, what's next. This is the handoff document between Cowork sessions.
- **CLAUDE.md** — CC's instruction file. Read automatically when CC starts. Contains project architecture, code conventions, what not to touch, and the verification checklist.
- **cc-session-log.md** — CC appends a summary after every session. Cowork reads this to know what CC built.
- **_prompts/** — CC prompt files written by Cowork. Self-contained build instructions.
- **MEMORY.md** — Cowork's persistent memory index. Survives across sessions.

---

## Why This Split Works

The split isn't arbitrary — it follows from the technical constraints:

1. **Cowork has the MCPs** — Supabase, Gmail, Vercel, Desktop Commander. These are configured in the Cowork environment and aren't available to CC by default.
2. **CC has the native toolchain** — Expo, Xcode, simulators, the real Node.js environment on macOS. Cowork's sandbox is Linux.
3. **Opus plans, Sonnet builds** — Opus (Cowork) is better at architecture and nuanced decisions. Sonnet (CC) is fast and excellent at executing well-defined tasks.
4. **State management** — Cowork maintains COWORK.md as the single source of truth. If both agents tried to manage state, they'd conflict.
5. **Jacob doesn't need to be in the middle** — Cowork writes the prompt, CC executes it, Cowork reviews and merges. Jacob kicks off each step but doesn't need to manually coordinate.

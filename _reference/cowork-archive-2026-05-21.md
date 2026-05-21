---
type: archive
status: archived
original_path: First Vault/02_Projects/wrenchlane-crm/COWORK.md
recovered_from: in-session read 2026-05-21 ~15:24 UTC
recovered_lines: 1-100 (file was ~800 lines / 30 KB total)
note: |
  This is a partial recovery. The full file was overwritten in place when the
  Cowork→single-CC layout was collapsed on 2026-05-21. The first 100 lines
  below were read into this session's context BEFORE the rewrite and are
  byte-accurate. Lines 100–~800 (older "Current State" snapshots and session
  history) were NOT captured in context; their content overlaps with
  cc-session-log.md in the repo. To recover the full original, open
  Obsidian → Settings → File Recovery → COWORK.md and restore the snapshot
  from before 2026-05-21 15:25 UTC.
---

# COWORK.md (recovered first 100 lines, original frontmatter preserved)

```
---
type: system
status: active
tags: [cowork, project-instructions, wrenchlane-crm]
created: 2026-03-27
updated: 2026-05-21T10:30Z
---

# Cowork Project: Wrenchlane CRM

> This file is read automatically at the start of every Cowork session for this project.
> Keep it lean. Full vault context lives in [[../../CLAUDE.md]].

## Folder Structure

This project uses **two separate folders**. Both must be mounted in every Cowork session.

| Folder | Mount name | Purpose | Who writes |
|--------|-----------|---------|------------|
| Obsidian planning | `02_Projects--wrenchlane-crm` | Prompts, plans, research, strategy | Cowork |
| Git repo | `jacobqvisth--crm-for-saas` | Source code, CLAUDE.md, cc-session-log | CC (+ Cowork reads) |

**Rules:**
- `cc-session-log.md` lives in the **git repo only**. Cowork reads it there. CC appends to it.
- `_prompts/` lives in the **planning folder only**. Jacob pastes prompts into CC manually.
- Planning docs live in the **planning folder only**.
- `CLAUDE.md` lives in the **git repo only**. It's CC's instruction file.
- When writing a CC prompt that references codebase files, Cowork should read from the git repo folder to get accurate paths and current state.

## ⚠️ Prompt Safety Check — Are You In The Right Project?

**Before acting on any prompt**, verify it belongs to this project.

**This project is:** Wrenchlane CRM
- Repo: `~/crm-for-saas/`
- Supabase ref: `wdgiwuhehqpkhpvdzzzl`
- Production: `https://crm-for-saas.vercel.app`
- Key concepts: CRM, outbound sales, contacts, companies, sequences, campaigns, email warmup, Inngest, Gmail OAuth, Prospector, bounce suppression, analytics

**Red flags — stop and ask Jacob if the prompt mentions:**
- A different Supabase project ref (e.g. `gvfixrxpwmdslsiftmtv` → that's the job app)
- A different repo path (`~/job-application-platform/`, `remix-of-remix-of-project-ignition`)
- Job app concepts: job applications, kanban tracker, screening answers, ATS extension, Teamtailor/Varbi/Jobylon/Greenhouse, JobTechDev API, Platsbanken, Answer Library
- Workshop concepts: diagnostics, vehicles, inspections, repair orders, Lovable

**If any red flag appears, stop and ask before doing anything:**
> "This prompt mentions [X] — are you sure this is for the **Wrenchlane CRM**, not another project?"

---

## Session Startup Checklist
1. Read `cc-session-log.md` from the **git repo folder** — what CC last built, merged, and deployed
2. Sanity-check CI: `gh run list --branch main --limit 5 --repo jacobqvisth/crm-for-saas` — green = move on; red = plan a fix-forward prompt
3. Check `_inbox/` — process any files Jacob dropped there
4. Tell Jacob current state + what's ready

## Branch Cleanup (After Merging PRs)

GitHub automatically deletes the remote branch when a PR is merged (enabled in repo settings). After merging, just clean up the local worktree:

```bash
git worktree remove ~/.claude/worktrees/<name> --force
git branch -d claude/<name>
```

This keeps the CC sidebar clean (sessions go from branch icon → ○).

---

## What This Is

Self-hosted CRM for outbound sales — HubSpot Sales + Lemlist alternative. Built for Wrenchlane's own use first, then productized for Swedish workshop/auto businesses.

**Production:** https://crm-for-saas.vercel.app
**Repo:** `~/crm-for-saas/` (git pull before every session)
**Supabase:** project ref `wdgiwuhehqpkhpvdzzzl`
**Tech:** Next.js 16, Supabase, Tailwind CSS 4, Inngest, Gmail API, Vercel

---

## Current State

**Snapshot taken 2026-05-21 against repo HEAD `1062beb` (PR #285). Read `cc-session-log.md` in the repo for line-level detail on any PR mentioned below.**

- **Today (2026-05-21) — stats + UX polish:**
  - **PR #284** — `email-stats audit`: exclude OOO from reply rate; paginate dashboard reads (was silently capped at 1000); per-stat tooltips
  - **PR #282** — `/contacts` "Last contacted" column repointed to `last_emailed_at` (was blank for rows matching the "Has been emailed" engagement filter; the two fields are independent — `last_contacted_at` only writes on replies via check-replies cron; `last_emailed_at` writes on outbound via process-emails cron)
  - **PR #280** — trace + DNC for `kundtjanst@skelleftea.se`
  - **PR #279** — bulk-enroll script + Lemlist Meko import + `enrollContacts` client param
  - **Open:** **PR #286** (`feat/sequence-enrolled-pagination-search`) — paginate + search Enrolled tab; not yet merged

- **2026-05-20 → 2026-05-21 — list-state persistence + inbox/companies UI sprint (PRs #266–#277):**
  - **PR #277** — filters/sort/page/scrollY persist across back-nav on `/contacts` + `/companies` via sessionStorage (workspace-keyed, tab-scoped, SSR-safe). New `src/lib/list-state.ts` helper.
  - **PR #276** — Add Note + Log Call were silently failing → fixed
  - **PR #275** — contact list Name cell shows linked "No name" instead of "—"
  - **PR #273** — **`/companies` page rewrite** for design parity with `/contacts`: 18 customizable drag-reorderable columns, 7 MultiSelect filters + 2 checkbox filters + debounced search, sortable headers, lifecycle/customer-status pills, contacts/deals counts, App-workshop badge. New `src/components/companies/column-config.ts` + `column-customizer.tsx`. Bulk actions deliberately skipped (easy follow-up).
  - **PR #272 / #270** — `email_sent` activity log shows which sender sent each email (company tab + dashboard feed)
  - **PR #269** — drag-resizable inbox panels (240–720px, double-click to reset, localStorage-persisted)
  - **PR #267** — editable AI product knowledge page in Settings
  - **PR #266** — recipient mailbox (Magnus/Hans/etc.) shown in inbox list + thread header
```

---

## Status of remaining content (lines 100 onward)

The full file was ~30 KB (~800 lines). Lines 100+ contained, in order from the structure visible in the IndexedDB snapshot chunk I extracted today:

- **Older "Current State" entries** — running history of state snapshots from earlier weeks. All of this overlaps with `cc-session-log.md` in the repo (which has the per-PR detail).
- **Architecture notes / project rules** — most of these are duplicated in `~/crm-for-saas/CLAUDE.md`. The fragments visible in the IndexedDB chunk show: middleware notes, RLS rules, Supabase client conventions, route structure, contacts/companies field lists. CLAUDE.md is authoritative for all of these.
- **"Today" entries from prior days** — visible markers in the chunk include references to PR #258 (CTA tracking), Sverige campaign ops, the Lemlist prior-outreach cleanup, domain-health work. All of those are documented in detail in `cc-session-log.md` and memory files.

**If you want the literal full original back:** Open Obsidian, go to `Settings` → `File Recovery` → search `COWORK.md`. The pre-rewrite snapshot (timestamped before 2026-05-21 15:25 UTC) will be there.

**If you just want the operational facts:** everything load-bearing is already in `~/crm-for-saas/CLAUDE.md` (architecture, conventions, gotchas), `cc-session-log.md` (per-PR detail), `PROJECT-STATUS.md` (live state), or the memory files. The vault COWORK.md was a Cowork-era convenience doc that mostly aggregated those sources — not an irreplaceable source of truth.

# CRM Full Build Audit — Security, Performance, Quality, Features

**Date:** 2026-07-06
**Audited by:** Claude Fable 5 (four parallel deep-audit agents + Supabase security/performance advisors run against live prod `wdgiwuhehqpkhpvdzzzl`)
**Commit stamp:** `80d00d8` (the audit agents read the local working tree at `bfee7af`, which is `80d00d8` + 5 commits — the delta is only call-follow-up files: `src/app/api/calls/*`, `src/lib/calls/webrtc-client.ts`, `src/lib/inbox/translate-outbound.ts`, `vercel.json`. All findings hold at `80d00d8`. Line numbers cite the `bfee7af` tree, so re-anchor by symbol if a file moved.)
**Live prod sizes at audit time:** companies 27.2k · activities 24.8k · phone_numbers 21.3k · email_queue 19.7k (30 MB) · contacts 16k · sequence_enrollments 10.3k · inbox_messages 4k (23 MB).

---

## How to use this folder

- **[BACKLOG.md](./BACKLOG.md)** — the single prioritized task list (every finding as a ticket with an ID, severity, effort, and a pointer to its runnable prompt). Start here.
- **[01-security.md](./01-security.md)** · **[02-performance.md](./02-performance.md)** · **[03-code-quality.md](./03-code-quality.md)** · **[04-features.md](./04-features.md)** · **[05-database-advisors.md](./05-database-advisors.md)** — the full findings behind the backlog.
- **[prompts/](./prompts/)** — self-contained, copy-paste prompts. Each is written to be handed to a **cheaper model (Opus 4.8, or Sonnet for the mechanical ones)** in a fresh Claude Code session. Each prompt carries its own context, file pointers, acceptance criteria, and a verification step, so it needs no memory of this audit. See [prompts/INDEX.md](./prompts/INDEX.md).

**Recommended runner model per prompt tier** (also noted in each prompt header):
- **Security fixes (P0)** and anything touching send/reply/GDPR logic → **Opus 4.8** (correctness-critical).
- **Mechanical passes** (add indexes, narrow `select()`, `.throwOnError()` codemod, add `maxDuration`, dead-code removal) → **Sonnet** is fine and cheaper.
- **New features** → **Opus 4.8** for design-bearing ones (reply classification, PQL scoring, meeting booking); **Sonnet** for the small plumbing ones (workshop link, Slack digest).

---

## Executive summary

The build is in good shape architecturally: TypeScript strict, zod present, no hardcoded secrets, Gmail tokens encrypted at rest (AES-256-GCM), service-role key never exposed client-side, dependencies on current majors, a genuinely clean codebase (only 2 TODO comments in all of `src/`). The problems are concentrated and fixable, and they cluster in three places: **the two big cron files** (`process-emails`, `check-replies`), **the client-heavy list pages** (companies, contacts) that fetch whole tables, and **a handful of internet-facing endpoints** that lack hardening.

### The five things to fix first (this week)

1. **Stored XSS in the inbox** (SEC-1, HIGH). Incoming email HTML is rendered with `dangerouslySetInnerHTML` and **no HTML sanitizer is installed anywhere**. Any outsider who emails a synced mailbox can run script in a staff operator's authenticated dashboard. → add DOMPurify + sandboxed iframe.
2. **Calls webhook auth is optional + blind SSRF** (SEC-2, HIGH). Webhook signature check is skipped entirely if `CALL_WEBHOOK_SECRET` is unset, and the hangup handler `fetch()`es an attacker-supplied `recordingurl` with no IP/host guard. → fail closed, HMAC the body, allowlist recording hosts.
3. **Unchecked DB writes across the send/reply pipeline** (REL-2, HIGH). 152 Supabase mutations (40% of all mutation sites) never check `error` — including the "mark as sent/replied" updates (double-send + keep-emailing-after-reply risk), suppression inserts (keep emailing unsubscribed/bounced addresses), and the **entire GDPR erasure cascade** (route can return success while erasure silently failed). → `.throwOnError()` codemod + a `reportError()` observability helper.
4. **`email_queue` sent-status scans have no index** (PERF-1, HIGH). Live prod shows 430k seq scans reading **6.4 billion tuples** — the crons and every inbox thread-open scan the whole 30 MB table on each tick. → three partial/covering indexes.
5. **`e2e-login` production backdoor** (SEC-4, MEDIUM but trivial). A GET route creates/signs-in a real user with a **hardcoded password committed to the repo**, gated only by the shared `CRON_SECRET` passed as a URL query param. → refuse to run in prod, rotate creds.

### Then (reliability + perf)
- Add `"test": "vitest run"` + a CI job (REL-1) — 48 vitest files exist but **never run in CI**. Highest ROI single line in the report. Then de-dup + test `isAutoReply` (REL-4) and `enrollContacts` (REL-6).
- Kill the whole-table fetches on the two most-used pages: companies & contacts lists do `select('*')` over all 27k companies (silently capped at 1000, so filters are also *wrong*) and page the full table for filter options (PERF-3).
- Convert `/api/dashboard` and the sequence-detail loader from "pull entire tables, aggregate in JS" to SQL RPCs + `unstable_cache` (PERF-4, PERF-5).
- Add the 35 missing foreign-key indexes and the `is_read`/`sent` indexes; drop 34 unused indexes; fix 10 RLS `initplan` re-eval policies (PERF-2, PERF-6, PERF-10).
- Fix the Supabase advisor **ERROR**-level items: 4 tables with RLS disabled in a PostgREST-exposed schema, 5 `SECURITY DEFINER` views, and ~13 `SECURITY DEFINER` functions callable by `anon` (SEC-5).

### Highest-value features to add (grounded in what already exists)
1. **AI reply intent classification + action extraction** (FEAT-1) — Claude is *already called per inbound message*; piggyback one prompt to tag interested/not-interested/wrong-person and turn "call me in August" into a dated task. Inbox tabs already filter by `category`. S–M effort, P1.
2. **Link CRM company/contact → the `/dashboard/workshops/[id]` drill-down** (FEAT-2) — the rich account view already exists; reps just can't reach it from where they sell. One link. S effort.
3. **PQL / health scoring into the call planner** (FEAT-3) — `companies.health_score` is an orphan column with a display slot already wired; usage/subscription/diagnostics signals all exist. Compute it on a cron, sort the planner by it.
4. **Slack daily digest** (FEAT-4) — Slack webhook infra already alerts on infra, not sales. Add tasks-due / needs-reply / new-interested digest. S effort.

Full ranked feature list (15 items) in [04-features.md](./04-features.md).

### What's already good (verified, don't "fix")
Gmail OAuth tokens encrypted at rest; service-role key server-only; no hardcoded secrets; zod actually used in ~38 routes; `find-phone` 504 fix confirmed in place; cron routes correctly export `GET`; `/dashboard/*` analytics loaders correctly use `unstable_cache` + 5-min TTL; jssip correctly dynamic-imported; DST-correct send scheduler; company-merge dedup flow is complete and is the right template to clone for contacts.

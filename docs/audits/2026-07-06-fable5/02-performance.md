# Performance Findings

Stamp: `80d00d8` (line numbers cite the `bfee7af` tree). Index/scan claims verified against **live prod** `wdgiwuhehqpkhpvdzzzl` (pg_indexes / pg_stat_user_tables). Live sizes: companies 27.2k, activities 24.8k, phone_numbers 21.3k, email_queue 19.7k (30 MB), contacts 16k, sequence_enrollments 10.3k, inbox_messages 4k (23 MB).

The findings cluster in three places: the two big cron files, the client-heavy list pages, and uncached dashboard aggregation. A recurring theme: **PostgREST silently caps un-paginated selects at 1000 rows**, so several "slow" queries are also *silently wrong* (filter dropdowns and cleanup loops miss data beyond 1000).

## HIGH

### PERF-1 · `email_queue` sent-status scans have no index
- **Evidence (live):** email_queue = **430,738 seq scans / 6,397,110,212 tuples read** (≈ whole table per scan). Only partial indexes on `status='scheduled'` exist; nothing covers sent-scans or `gmail_thread_id`.
- **Sites:** `cron/check-replies/route.ts:43-50,377-381`; `cron/process-emails/route.ts:93-116` (circuit breaker, per sender per 5-min run); `dashboard/route.ts:106-125`; `inbox/[id]/thread/route.ts:29-34` (`eq('gmail_thread_id')` per thread open); draft-reply:107-112.
- **Fix:** `CREATE INDEX CONCURRENTLY idx_email_queue_sent ON email_queue(sent_at) WHERE status='sent'`; `idx_email_queue_sender_sent ON email_queue(sender_account_id, sent_at) WHERE status='sent'`; `idx_email_queue_gmail_thread ON email_queue(gmail_thread_id)`. → **Prompt:** `prompts/PERF-1-email-queue-indexes.md`. Effort S. Runner: Sonnet.

### PERF-5a · check-replies: sequential Gmail `threads.get` + per-message DB churn; bounce scan truncated at 1000
- **Evidence:** `cron/check-replies/route.ts`. 7d/500-cap mitigation confirmed (:42-50) but the **`messages.list` rewrite is still not done** — loop at :72-360 does per-thread token fetch (DB read ×≤500/run), `threads.get(format:"full")` (~250 ms each), then per-message dedup query (:106-110) and contact lookup (:132-137) *for already-stored messages*, every 30 min. Bounce scan (:377-381) `.eq('status','sent').gte('sent_at',since)` has **no `.limit()`** → capped at 1000, so NDR matching silently misses sends beyond ~143/day.
- **Fix:** explicit `.order('sent_at',{ascending:false}).limit(1000)` or paginate the bounce scan; batch dedup with one `.in('gmail_message_id',[...])` per thread; cache token per account per run; land the `messages.list(q=after:)` rewrite (queued since PR #254). → **Prompt:** `prompts/PERF-5-check-replies.md`. Effort M. Runner: Opus 4.8 (touches reply detection).

### PERF-3 · Contacts & company list/detail pages fetch whole tables with `select('*')`
- **Contact detail** `contacts/contact-detail-client.tsx:233-238`: `from('companies').select('*').order('name')` for a dropdown — 27.2k wide rows ≈ 1.2 MB, **capped at 1000 so 26k companies are missing anyway**. The whole `load()` (:199-283) is an ~8-query sequential waterfall after the 3-hop workspace waterfall.
- **Contacts list** `contacts/contacts-page-client.tsx:501,517,537,551-575`: all-companies `select('*')` no limit; distinct countries/sources as raw column scans (capped at 1000 of 16k → **wrong filter options**); tags loop pages the entire 16k table client-side (~16 requests) on every mount.
- **Companies list** `companies/companies-page-client.tsx:390-472`: countries/sources unpaginated (capped, wrong options); industries/tags page the full 27k table (~27 requests each) per mount; plus 4 `count:'exact'` stat headers + main query per filter change.
- **Fix:** async search combobox (`name ilike, select('id,name'), limit 20`) for company pickers; one `SELECT DISTINCT` RPC (or materialized options row) for countries/sources/industries/tags; cache options client-side with TTL. → **Prompts:** `prompts/PERF-3-list-select-and-filter-rpc.md`. Effort M. Runner: Opus 4.8 (design) then Sonnet (apply).

### PERF-4 · CRM home dashboard API pulls entire tables to aggregate in JS, uncached
- **Evidence:** `dashboard/route.ts:88-176` `pageAll` over ALL contacts (16k → 16 pages) for the growth chart, ALL sequence_enrollments (10.3k → 11 pages), all sent rows + events in range. Runs on every `/dashboard` (email-campaigns) view, no `unstable_cache`. ≈ 35–45 round trips per render, linear in data.
- **Fix:** SQL RPCs with `date_trunc` GROUP BY for chart buckets/counts; wrap in `unstable_cache` 5 min like the `/dashboard/*` loaders (`src/lib/ceo/cache.ts` is the pattern). → **Prompt:** `prompts/PERF-4-dashboard-rpc-cache.md`. Effort M. Runner: Opus 4.8.

### PERF-5b · Sequence detail page loads every enrollment + 2 queries per 200-chunk for next/last send
- **Evidence:** `sequences/[id]/page.tsx:127-217` pages all enrollments, then per 200-id chunk runs 2 `email_queue` queries (:190-217) to compute one min/max. 10k-enrollment sequence ≈ 10 + 100 browser queries per open.
- **Fix:** one RPC computing `min(scheduled_for)/max(sent_at)` by joining email_queue → steps → sequence, or query by `step_id IN (steps)`. → **Prompt:** `prompts/PERF-5-check-replies.md` (bundled sequence RPC section) or `prompts/PERF-4-dashboard-rpc-cache.md`. Effort M. Runner: Opus 4.8.

## MEDIUM

### PERF-8 · process-emails: no `maxDuration`, N-1 sequential jitter updates, uncapped `.in()`
- `cron/process-emails/route.ts`: **no `maxDuration` export** (all other heavy crons have one) → plan default timeout; jitter (:175-184) issues up to 99 sequential single-row UPDATEs/run; circuit-breaker `recentQueueIds` (:102-109) `.in()` on up to 1000 UUIDs ≈ 38 KB URL; ~15–20 sequential queries per sent email.
- **Fix:** `export const maxDuration = 300`; batch jitter reschedule into one `.in()` update; count bounces via RPC/join instead of an id-list. → **Prompt:** `prompts/PERF-8-process-emails-hardening.md`. Effort S/M. Runner: Opus 4.8 (send path).

### PERF-9 · enrollContacts: 2-4 sequential queries per contact in one request
- `lib/sequences/enrollment.ts:193-380` (via `/api/sequences/enroll`, maxDuration 300): per-contact insert enrollment + insert queue + rollback deletes. 1,000 contacts ≈ 2–4k round trips ≈ minutes → timeout risk.
- **Fix:** bulk `insert([...])` enrollments then bulk insert queue rows (variant pick + variable resolution are pure JS, do them first). → **Prompt:** `prompts/PERF-9-enroll-bulk-insert.md`. Effort M. Runner: Opus 4.8 (must not double-enroll; pairs with REL-6 tests).

### PERF-6 · Sidebar polls unread + tasks every 60s; `is_read` unindexed
- `components/sidebar.tsx:80-95` + `inbox/unread-count/route.ts:12-16`. Live: inbox_messages = **570,768 seq scans**. Each poll = invocation + `getUser()` + count on `is_read=false` (no index).
- **Fix:** `CREATE INDEX ... ON inbox_messages(workspace_id) WHERE is_read=false`; raise interval to 5 min or use Supabase Realtime. → **Prompt:** `prompts/PERF-6-sidebar-poll.md`. Effort S. Runner: Sonnet.

### PERF-7 · Inbox list ships full email bodies for 50 rows per fetch
- `inbox/route.ts:23-41` `select('*',...)` includes `body_html/body_text/body_translated_en` (≈ 5.7 KB/row) → hundreds of KB–MBs per tab switch; thread view refetches bodies anyway.
- **Fix:** narrow select to headers + snippet; add a generated `snippet` column. → **Prompt:** `prompts/PERF-7-inbox-list-narrow.md`. Effort S. Runner: Sonnet.

### PERF-11 · Sequence DELETE: unchunked `.in()` + 1000-cap select (bug class already fixed in PATCH)
- `sequences/[id]/route.ts:149-193`: the activate path chunks (:76-82) but DELETE fetches enrollments unpaginated (:149-153) and passes the full id array to `.in()` — >1000-enrollment sequence = silent partial cleanup / Bad Request.
- **Fix:** reuse the chunking helper, or add `ON DELETE CASCADE`. → **Prompt:** `prompts/PERF-11-sequence-delete-chunk.md`. Effort S. Runner: Sonnet.

### PERF-12 · Call planner: 5 sequential await stages before parallel counts
- `calls/planner/route.ts:92-147,244`: listReps → exclusions → bouncedSubs → full candidate pool page-loop → loadNeverCallSets, all sequential; then 24 parallel counts. `dashboard_subscriptions` query (:123-126) unlimited (fine at 301 rows today).
- **Fix:** `Promise.all` the independent stages; long-term move scoring to SQL (pairs with FEAT-3). → **Prompt:** `prompts/PERF-12-planner-parallelize.md`. Effort S. Runner: Sonnet.

### PERF-13 · mailbox-sync: O(threads × messages), full-thread reprocess on every touch
- `cron/mailbox-sync/route.ts:234-423`: well-budgeted, but each touched thread re-iterates all its messages (per-outbound `email_queue.gmail_message_id` lookup :447-462, per-counterparty contact lookup, per-inbound upsert). A 50-message thread re-does ~50 queries every time it gets one new message.
- **Fix:** batch `gmail_message_id IN (...)` per thread for both email_queue and inbox_messages before iterating; skip messages older than `last_synced_at` minus overlap. → **Prompt:** `prompts/PERF-13-mailbox-sync-batch.md`. Effort M. Runner: Opus 4.8.

### PERF-2 / PERF-10 · DB index & policy hygiene (from Supabase advisor)
- **35 unindexed foreign keys** — notably `email_queue_contact_id`, `email_queue_step_id`, `email_queue_workspace_id`, `inbox_messages_gmail_account_id`, `sequence_enrollments_sender_account_id`, `tasks_*` (7 FKs), `activities_user_id`, `phone_enrichment_jobs_contact_id`. Add covering indexes.
- **34 unused indexes** — candidates to DROP after confirming they're not for a rarely-run path (e.g. `idx_companies_name_trgm`, several `dashboard_*`, `companies_county_idx`, `inbox_messages_needs_reply/answered/draft_idx`). Saves write overhead + storage.
- **10 RLS `initplan` policies** re-evaluate `auth.*()`/`current_setting()` per row (workspaces, workspace_members, user_profiles, user_unavailable_dates) — wrap in `(select auth.uid())` etc.
- **14 multiple-permissive-policies** on `workspace_ai_knowledge` and `workspace_members` — merge duplicate SELECT policies.
- → **Prompt:** `prompts/PERF-2-db-index-hygiene.md`. Effort M. Runner: Sonnet (mechanical DDL) but review the DROPs. Full list in [05-database-advisors.md](./05-database-advisors.md).

## LOW
- **PERF-14 · Client data architecture:** every CRM page is a `'use client'` shell paying a 3-hop auth waterfall (`use-workspace.ts:38-84`) before its own 5–20 browser queries; nothing server-rendered/cached (only `/dashboard/*` uses `unstable_cache`). Incremental fix: resolve workspace server-side in the layout, move first-page data into server components with `use cache`. Effort L, architectural — do per-page. **Prompt:** `prompts/PERF-14-server-workspace-layout.md`.
- **PERF-15 · Sync AI in requests:** find-phone 504 fix **verified in place** (`find-phone.ts:375-381`, AI only when scrape empty). Remaining sync-AI routes are user-initiated and mostly fine; add `maxDuration` to `inbox/[id]/draft-reply`, `ai/generate-email`, `ai/generate-variants`, `ai/translate-email` (currently none). **Prompt:** `prompts/PERF-15-ai-maxduration.md`. Effort S. Runner: Sonnet.
- **PERF-16 · Bundle:** recharts statically imported into `sequences/[id]/page.tsx` (loads on default Overview tab) and email-campaigns; tiptap static via step-card/templates/profile. jssip already dynamic (good). `next/dynamic` the analytics tab + rich editor. **Prompt:** `prompts/PERF-16-dynamic-imports.md`. Effort S. Runner: Sonnet.

## Verified good (don't touch)
`/dashboard/*` loaders use `unstable_cache` + 5-min TTL + tag bust correctly; `updateTag(tag)` single-arg matches Next 16; due-scan index `idx_email_queue_scheduled` is correct; activities indexed on company/contact/workspace + created_at DESC; jssip dynamic; find-phone 504 fix in place; call summary runs via `after()` + sweep-stuck-calls backstop; phone-enrichment/reconcile/discover crons all bounded.

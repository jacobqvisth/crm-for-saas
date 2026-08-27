# Feature Inventory & Gap Analysis

Stamp: `80d00d8`. Every suggestion below is grounded in building blocks that already exist in the codebase, so none is greenfield fluff. Ranked by value ÷ effort.

## Part A — What exists (maturity map, condensed)

**Solid / production:** Companies (list + modular detail with App-usage tab, phone pool, find-website), Company duplicates (trigram merge flow + hourly cron + merge/dismiss UI — the template for FEAT-11), Contacts (list + rich detail with App User section), Inbox (translation both ways, AI draft replies, reply-workflow tabs, OOO filter), Sequences (TipTap builder, variants, preflight, pause-new-contacts, threading, sender pinning), **Sequence analytics** (step funnel + per-variant A/B table with ≥20-send "Leader" badge and Promote-winner — this exists client-side per sequence), Calling (46elks + WebRTC + Deepgram + Claude summary + review drawer with editable follow-up email), Lists (static/dynamic + exclusion sets), Tasks (CRUD + snooze, created by manual/call/reply/tracking-open — **badge only, no reminders**), Templates, Discovery, Field Routes, Settings (compliance/DNC/GDPR, ai-knowledge).

**Analytics suite (`/dashboard/*`):** ~18 solid pages (warehouse via ceo-sync + GA4 + PostHog + Stripe). Conversions has real attribution (`contacts.attributed_to_sequence_id`, `get_sequence_conversions`).
- **`/dashboard` index = stub** (redirects to app-usage; "unified overview PR2" never built).
- **email-campaigns = partial** (aggregate sent/open/reply/bounce + per-sequence table, but **no per-sequence open/click breakout, no variant stats**).
- **lifecycle = misnamed** (Customer.io messaging metrics, **not** a `companies.lifecycle_stage` funnel).
- reviews = partial by design (cron shipped; Trustpilot gated on key; Google Business a deliberate dormant stub).

**Dead / orphaned:** deals/pipelines/deal_contacts tables (zero refs), `gmail_accounts.warmup_*`+`health_score` (PR #36 remnant), `companies.health_score` (displayed, never computed), `call_sessions.transcript`/`live_tips` (Phase-2 reserved). See CLEAN-1.

**Harvested TODOs:** only 2 in all of `src/` — both the intentional dormant Google Business Profile stub (`lib/ceo/reviews/sources/google-business.ts:17,46`).

## Part B — Ranked feature backlog

### FEAT-1 · P1 · AI reply intent classification + action extraction — **S–M**
Every reply lands as `category='inbox'` and reps triage manually. Auto-tag interested / not-interested / wrong-person / referral, and extract "call me in August" → a task with a due date.
- **Exists:** `inbox_messages.category` (only `inbox`/`out_of_office` ever written, `check-replies:162`); **Claude already called per inbound message** in `lib/inbox/translate-inbound.ts` (piggyback one prompt — near-zero marginal cost); inbox tabs already filter by category; a "Mark Interested" → `lead_status='qualified'` handler exists; `tasks.snoozed_until` + auto-task-on-reply already in check-replies.
- **Missing:** the classifier prompt + category enum, auto `lead_status` update on "interested", due-date extraction into the task.
- → **Prompt:** `prompts/FEAT-1-reply-intent-classification.md`. Runner: Opus 4.8.

### FEAT-2 · P1 · Link CRM company/contact ↔ workshop drill-down — **S**
Reps selling to an existing app user can't jump to the rich `/dashboard/workshops/[id]` account view.
- **Exists:** `companies.wl_workshop_id`, full `getWorkshopDetail` page, App User section on contact detail.
- **Missing:** one link each way (company/contact → workshop, workshop → CRM company).
- → **Prompt:** `prompts/FEAT-2-workshop-drilldown-link.md`. Runner: Sonnet.

### FEAT-3 · P1 · PQL / health scoring feeding the call planner — **M**
Freemium users showing usage are the hottest calls; the planner ranks by playbook segments only.
- **Exists:** orphan `companies.health_score` column + display slot (`signals.tsx:65`); `usage_events`, `subscriptions`, `diagnostics_total/last_30d`, `lifecycle_stage='freemium'`, hourly `propagate-to-crm` cron to hang the computation on; planner ranking in `/api/calls/planner`.
- **Missing:** a scoring job writing `health_score`; sort/filter by it in planner + list builder. (Resolves the orphan column — CLEAN-1.)
- → **Prompt:** `prompts/FEAT-3-pql-health-scoring.md`. Runner: Opus 4.8.

### FEAT-4 · P1 · Slack daily digest (tasks due, needs-reply, new interested) — **S**
Work is discoverable only by opening the app; Slack infra already alerts on infra, not sales.
- **Exists:** two Slack webhook paths (`lib/slack/notify.ts`, `lib/domain-health/notify.ts`); `tasks_workspace_due` index; inbox needs-reply state (`replied_at`); the cron pattern in vercel.json.
- **Missing:** one digest cron + message builder.
- → **Prompt:** `prompts/FEAT-4-slack-daily-digest.md`. Runner: Sonnet.

### FEAT-5 · P2 · A/B stats completion (server-side + significance + dashboard + auto-promote) — **S–M**
Variant comparison exists only client-side per sequence; no stat-sig, nothing in the campaigns dashboard, promote is manual.
- **Exists:** `sequence_step_variants` (`sends_count/weight`), `email_queue.variant_id`, the full per-variant table + promote-winner UI (`sequence-analytics-tab.tsx`).
- **Missing:** variant grouping RPC, a significance test (two-proportion z / Bayesian), per-variant rows in `/dashboard/email-campaigns`, optional auto-promote cron.
- → **Prompt:** `prompts/FEAT-5-ab-stats.md`. Runner: Opus 4.8.

### FEAT-6 · P2 · Post-call follow-up automation — **S**
Call drawer suggests tasks/emails but nothing happens on no-answer/voicemail.
- **Exists:** `call_sessions` outcomes, tasks API, call lists/queue, review-drawer accept flow (editable follow-up email, PR #510).
- **Missing:** an outcome→rule engine (no-answer → retry task in 2d; interested → enroll / meeting task).
- → **Prompt:** `prompts/FEAT-6-postcall-automation.md`. Runner: Opus 4.8.

### FEAT-7 · P2 · Enrichment coverage dashboard — **S**
You run Apify/enrichment blind; no aggregate coverage view by country/list.
- **Exists:** `phone_searched_at`/`phone_search_outcome` stamps, `phone_enrichment_jobs`, `email_status`, `phone_numbers` pool; `/dashboard/data-health` as the host page.
- **Missing:** aggregate SQL + a card section inside data-health.
- → **Prompt:** `prompts/FEAT-7-enrichment-coverage.md`. Runner: Sonnet.

### FEAT-8 · P2 · Per-mailbox deliverability feedback loop — **M**
Health check (SPF/DKIM/DNSBL + 30d bounce/reply) exists but is on-demand, unpersisted, and doesn't influence rotation beyond the 8% bounce breaker.
- **Exists:** `gmail/accounts/[id]/health-check`, `getNextSender` rotation (`lib/gmail/sender-rotation.ts`), orphan `gmail_accounts.health_score`, circuit breaker (`process-emails:90-168`), domain-health cron template.
- **Missing:** a daily cron persisting `health_score`, rotation weighting by it, a trend surface. (Resolves the warmup-orphan columns — use or drop.)
- → **Prompt:** `prompts/FEAT-8-deliverability-loop.md`. Runner: Opus 4.8.

### FEAT-9 · P2 · Meeting booking links — **M–L**
Interested replies convert off-platform; no booking → no auto-logged meeting outcome.
- **Exists:** Gmail OAuth per rep (add calendar scope), `link.wrenchlane.se` + click tracking, activities/tasks, `settings/profile` unavailable-dates (an availability primitive already!).
- **Missing:** availability picker page, booking route, calendar event creation, a meeting activity type.
- → **Prompt:** `prompts/FEAT-9-meeting-booking.md`. Runner: Opus 4.8.

### FEAT-10 · P2 · Pipeline / funnel view — **M**
No deal or funnel surface; `lifecycle_stage` + `lead_status` + interested replies exist but never aggregate.
- **Exists:** dead `deals`/`pipelines` tables (revivable from git history), `lifecycle_stage` written by 3 paths, `lead_status`, activities timeline.
- **Missing:** either a lightweight lifecycle/lead_status kanban over companies (recommended over reviving deals) or deal revival; a funnel-counts endpoint.
- → **Prompt:** `prompts/FEAT-10-pipeline-funnel.md`. Runner: Opus 4.8.

### FEAT-11 · P3 · Contact duplicate detection — **M**
Company merge is complete; contacts have none — one person appears under multiple gmail user_ids/emails (the rep-ownership pain).
- **Exists:** `company_merge_candidates` cron+UI as the exact pattern to clone; rep canonical-identity mapping.
- **Missing:** `contact_merge_candidates` table/cron/UI + merge (reassign activities/enrollments).
- → **Prompt:** `prompts/FEAT-11-contact-dedup.md`. Runner: Opus 4.8.

### FEAT-12 · P3 · Audit trail + undo for bulk ops — **S–M**
`bulk-delete`/`bulk-update` leave zero trace; a bad filter can silently wipe thousands of rows.
- **Exists:** `lib/activities/insert.ts`, service-role routes to hook.
- **Missing:** audit rows (who/what/count/snapshot), soft-delete window + restore.
- → **Prompt:** `prompts/FEAT-12-audit-undo.md`. Runner: Opus 4.8.

### FEAT-13 · P3 · Send-time optimization per recipient — **M**
Send window is per-sequence timezone (`Europe/Stockholm`); UK/CZ/Baltics recipients get Swedish hours.
- **Exists:** DST-correct scheduler (`lib/sequences/scheduler.ts`), `contacts.country_code`, timestamped `email_events` opens for learning.
- **Missing:** per-recipient tz offset from country; optional best-hour model.
- → **Prompt:** `prompts/FEAT-13-send-time-optimization.md`. Runner: Opus 4.8.

### FEAT-14 · P3 · Stale-data flags / re-engage lists — **S**
Finished-sequence non-repliers go dormant; no "not touched in 90d" resurfacing.
- **Exists:** `last_contacted_at`, dynamic list filter builder (`resolveListContactIds`), enrollment completed status.
- **Missing:** staleness filters in the list builder + a "re-engage" preset.
- → **Prompt:** `prompts/FEAT-14-stale-reengage.md`. Runner: Sonnet.

### FEAT-15 · P3 · `/dashboard` unified overview (finish the stub) — **S–M**
The index page is a redirect; the "unified overview" was never built.
- **Exists:** all the `/dashboard/*` loaders to compose from.
- **Missing:** a compose-the-top-KPIs page reusing existing cached loaders.
- → **Prompt:** `prompts/FEAT-15-dashboard-overview.md`. Runner: Sonnet.

## Suggested sequencing
FEAT-1 + FEAT-2 + FEAT-4 are one high-impact week (small, all rep-facing). FEAT-3 and FEAT-8 share the "compute a score on a cron, feed a ranking" shape — do them together. FEAT-5 is cheap because the hard plumbing already exists. FEAT-9 and FEAT-10 are the two genuinely new surfaces — pick based on whether replies (booking) or calls (pipeline) are the current bottleneck.

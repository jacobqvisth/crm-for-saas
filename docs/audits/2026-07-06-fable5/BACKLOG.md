# Unified Backlog — 2026-07-06 Fable 5 audit

One row per finding. **Prompt** = the ready-to-run file in `prompts/`. **Runner** = suggested model. Effort S/M/L. Order within each tier is the suggested execution order.

## P0 — Security & data-integrity (do first)
| ID | Title | Sev | Effort | Runner | Prompt |
|----|-------|-----|--------|--------|--------|
| SEC-1 | Sanitize incoming email HTML (stored XSS) | HIGH | M | Opus 4.8 | SEC-1-sanitize-inbox-html.md |
| SEC-2 | Calls webhook: mandatory auth + SSRF guard | HIGH | M | Opus 4.8 | SEC-2-webhook-auth-ssrf.md |
| REL-2 | `.throwOnError()` on send/reply/GDPR hotspots + `reportError()` | HIGH | M | Opus 4.8 | REL-2-throwonerror-hotspots.md |
| SEC-3 | Close open redirect on tracking domain | MED | M | Opus 4.8 | SEC-3-open-redirect.md |
| SEC-4 | Harden `e2e-login` (no prod, no hardcoded pw) | MED | S | Sonnet | SEC-4-e2e-login-hardening.md |
| SEC-5 | DB advisor: RLS + SECURITY DEFINER views/functions | ERROR | M | Opus 4.8 | SEC-5-db-advisor-hardening.md |
| PERF-1 | `email_queue` sent-status indexes | HIGH | S | Sonnet | PERF-1-email-queue-indexes.md |

## P1 — Reliability & test safety net
| ID | Title | Sev | Effort | Runner | Prompt |
|----|-------|-----|--------|--------|--------|
| REL-1 | `"test": "vitest run"` + CI job | HIGH | S | Sonnet | REL-1-vitest-ci.md |
| REL-4 | De-dup + unit-test `isAutoReply` | MED | S | Sonnet | REL-4-isautoreply-dedup-test.md |
| PERF-5 | check-replies: bounce `.limit()`, batch dedup, token cache, seq RPC | HIGH | M | Opus 4.8 | PERF-5-check-replies.md |
| REL-6 | Extract + test send-pipeline decision logic | MED | M–L | Opus 4.8 | REL-6-send-pipeline-tests.md |
| SEC-6 | Escape PostgREST `.or()` search input | LOW-MED | S | Sonnet | SEC-6-postgrest-or-escape.md |
| REL-3 | GDPR forget route: verify erasure, fail loud | HIGH | S | Opus 4.8 | (in REL-2-throwonerror-hotspots.md) |

## P2 — Performance
| ID | Title | Sev | Effort | Runner | Prompt |
|----|-------|-----|--------|--------|--------|
| PERF-3 | List pages: kill `select('*')`, filter-option RPCs | HIGH | M | Opus 4.8→Sonnet | PERF-3-list-select-and-filter-rpc.md |
| PERF-4 | `/api/dashboard`: SQL RPCs + `unstable_cache` | HIGH | M | Opus 4.8 | PERF-4-dashboard-rpc-cache.md |
| PERF-2 | DB index hygiene: 35 FK indexes, drops, RLS initplan | MED | M | Sonnet | PERF-2-db-index-hygiene.md |
| PERF-6 | Sidebar poll: `is_read` index + interval | MED | S | Sonnet | PERF-6-sidebar-poll.md |
| PERF-7 | Inbox list: narrow select / snippet column | MED | S | Sonnet | PERF-7-inbox-list-narrow.md |
| PERF-8 | process-emails: maxDuration, batch jitter, RPC bounces | MED | S–M | Opus 4.8 | PERF-8-process-emails-hardening.md |
| PERF-9 | enrollContacts: bulk insert | MED | M | Opus 4.8 | PERF-9-enroll-bulk-insert.md |
| PERF-11 | Sequence DELETE: chunk `.in()` / CASCADE | MED | S | Sonnet | PERF-11-sequence-delete-chunk.md |
| PERF-12 | Call planner: parallelize stages | MED | S | Sonnet | PERF-12-planner-parallelize.md |
| PERF-13 | mailbox-sync: batch per-thread lookups | MED | M | Opus 4.8 | PERF-13-mailbox-sync-batch.md |
| PERF-15 | Add `maxDuration` to 4 AI routes | LOW | S | Sonnet | PERF-15-ai-maxduration.md |
| PERF-16 | Dynamic-import analytics tab + rich editor | LOW | S | Sonnet | PERF-16-dynamic-imports.md |

## P3 — Architecture & hygiene
| ID | Title | Sev | Effort | Runner | Prompt |
|----|-------|-----|--------|--------|--------|
| ARCH-1 | `requireUser/requireWorkspace/requireCronSecret` helpers | MED | M | Opus 4.8→Sonnet | ARCH-1-auth-helpers.md |
| ARCH-3 | zod validation on sequences/contacts/inbox mutations | MED | M | Sonnet | ARCH-3-zod-validation.md |
| ARCH-2 | Central `src/lib/env.ts` | MED | M | Sonnet | ARCH-2-central-env.md |
| QUAL-1 | Migration timestamp repair + pg_cron drift check + types CI | MED | S | Sonnet | QUAL-1-migration-hygiene.md |
| QUAL-2 | Consolidate service-role client factories | MED | S | Sonnet | QUAL-2-client-factory-consolidation.md |
| QUAL-3 | Typed join shapes; remove `as unknown as` | LOW | M | Opus 4.8 | QUAL-3-join-types.md |
| CLEAN-1 | Dead code: postgres scripts, deals/warmup/health_score, REMOVE_REASONS | LOW | S | Sonnet | CLEAN-1-dead-code.md |
| SEC-7 | Rate limiting on AI/enrich/public endpoints | MED | M | Opus 4.8 | SEC-7-rate-limiting.md |
| PERF-14 | Server-resolve workspace in layout (per-page) | LOW | L | Opus 4.8 | PERF-14-server-workspace-layout.md |
| SEC-8 | (decision) role gating / webhook IP allowlist / pixel PII policy | LOW | — | — | (no prompt; policy) |

## Features (value-ranked; see 04-features.md)
| ID | Title | Prio | Effort | Runner | Prompt |
|----|-------|------|--------|--------|--------|
| FEAT-1 | AI reply intent classification + action extraction | P1 | S–M | Opus 4.8 | FEAT-1-reply-intent-classification.md |
| FEAT-2 | Link CRM profile ↔ workshop drill-down | P1 | S | Sonnet | FEAT-2-workshop-drilldown-link.md |
| FEAT-3 | PQL/health scoring → call planner | P1 | M | Opus 4.8 | FEAT-3-pql-health-scoring.md |
| FEAT-4 | Slack daily digest | P1 | S | Sonnet | FEAT-4-slack-daily-digest.md |
| FEAT-5 | A/B stats completion (sig + dashboard + auto-promote) | P2 | S–M | Opus 4.8 | FEAT-5-ab-stats.md |
| FEAT-6 | Post-call follow-up automation | P2 | S | Opus 4.8 | FEAT-6-postcall-automation.md |
| FEAT-7 | Enrichment coverage dashboard | P2 | S | Sonnet | FEAT-7-enrichment-coverage.md |
| FEAT-8 | Per-mailbox deliverability feedback loop | P2 | M | Opus 4.8 | FEAT-8-deliverability-loop.md |
| FEAT-9 | Meeting booking links | P2 | M–L | Opus 4.8 | FEAT-9-meeting-booking.md |
| FEAT-10 | Pipeline / funnel view | P2 | M | Opus 4.8 | FEAT-10-pipeline-funnel.md |
| FEAT-11 | Contact duplicate detection | P3 | M | Opus 4.8 | FEAT-11-contact-dedup.md |
| FEAT-12 | Audit trail + undo for bulk ops | P3 | S–M | Opus 4.8 | FEAT-12-audit-undo.md |
| FEAT-13 | Send-time optimization per recipient | P3 | M | Opus 4.8 | FEAT-13-send-time-optimization.md |
| FEAT-14 | Stale-data flags / re-engage lists | P3 | S | Sonnet | FEAT-14-stale-reengage.md |
| FEAT-15 | Finish `/dashboard` unified overview | P3 | S–M | Sonnet | FEAT-15-dashboard-overview.md |

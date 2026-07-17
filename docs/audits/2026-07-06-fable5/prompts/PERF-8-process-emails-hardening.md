# PERF-8 · process-emails: maxDuration, batch jitter, RPC bounce count

- **Runner:** Opus 4.8 (send path — regression-critical) · **Effort:** S–M · **Repo:** `~/crm-for-saas`

## Context
`src/app/api/cron/process-emails/route.ts` (853 lines, the send-queue cron):
- **No `maxDuration` export** (every other heavy cron has one) → falls to the plan-default function timeout.
- Jitter reschedule (~175-184) issues up to 99 **sequential** single-row UPDATEs per run.
- Circuit-breaker `recentQueueIds` (~102-109) builds an `.in('email_queue_id', [...up to 1000 UUIDs])` ≈ 38 KB URL.
- ~15-20 sequential queries per sent email.

## PROMPT
Harden the send cron without changing send semantics (1 email/sender/5-min tick, suppression checks, threading).

1. Add `export const maxDuration = 300;` (match the other heavy crons).
2. **Batch the jitter reschedule** into a single `.in()`-based UPDATE (or an RPC) instead of N sequential UPDATEs.
3. **Replace the id-list circuit-breaker** with a COUNT/aggregate query or RPC (e.g. count recent bounces per sender via SQL) instead of passing up to 1000 UUIDs in a URL. This also benefits from PERF-1's `idx_email_queue_sender_sent`.
4. Leave the per-email suppression/threading logic intact; only reduce query overhead. (If you extract the suppression/selection logic into pure functions while here, coordinate with REL-6 — but keep this PR focused if that balloons.)

### Definition of done
- `maxDuration=300` present; jitter is one batched write; circuit breaker no longer sends a giant id list.
- Send behavior identical (same selection, same 1/sender/run cap, same suppression).
- `npm run lint` passes.

### Verify
Dry-run the cron logic against a test workspace (or unit-test the selection/circuit-breaker functions if extracted). Confirm the same emails would be selected and no double-send. Check the function no longer times out on a large queue.

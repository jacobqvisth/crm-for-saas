# REL-6 · Extract + test send-pipeline decision logic

- **Runner:** Opus 4.8 · **Effort:** M–L · **Severity:** MEDIUM · **Repo:** `~/crm-for-saas`

## Context
The highest-blast-radius logic (send-queue selection, enrollment skip rules, suppression) lives inline in the 853-line `process-emails/route.ts` and `enrollment.ts` with zero tests. `renderQueuedEmail` already has good tests (`src/lib/sequences/render.test.ts`) — use it as the mocking reference (injectable client). Ranked by protection-per-test.

## PROMPT
Do these in order; each can be its own small PR if preferred.

1. **`enrollContacts` tests** (`src/lib/sequences/enrollment.ts`, client is injectable): unsubscribed / customer / lemlist-tagged contact → correct skip counter and **no** `email_queue` row; clean contact → exactly 1 enrollment + 1 queue row; verify variant selection respects weights. (Pairs with PERF-9 — write these before/with the bulk-insert refactor so the refactor is safe.)
2. **Extract `isSuppressed(email, domain, suppressionRows)`** as a pure function from `process-emails/route.ts:348-357,400-425`, then test email-match / domain-match / no-match. Replace the inline logic with the function.
3. **Extract `selectDueQueueItems(items, senders, caps)`** (or similar) from `process-emails` capturing the "≤1 item per sender per run, only senders with remaining capacity, oldest-due first" rule; test it. This is the biggest extraction — keep the route calling the extracted function so behavior is identical.
4. Use `isAutoReply` (REL-4) as the 4th pure-function test if not already done.

### Definition of done
- `enrollContacts`, `isSuppressed`, and `selectDueQueueItems` have unit tests; the extractions leave runtime behavior identical.
- `npm test` and `npm run lint` pass.

### Verify
Run `npm test`. For the extractions, diff behavior by feeding the same fixtures through old vs new paths (or trust the tests if they cover the branches). Confirm no change to which emails get selected/sent.

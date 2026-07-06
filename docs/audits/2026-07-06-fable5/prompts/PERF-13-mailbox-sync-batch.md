# PERF-13 · mailbox-sync: batch per-thread lookups

- **Runner:** Opus 4.8 · **Effort:** M · **Repo:** `~/crm-for-saas`

## Context
`src/app/api/cron/mailbox-sync/route.ts:234-423` is well-budgeted (TIME_BUDGET_MS, 75 threads/account, 10-page cap) but each touched thread re-iterates all its messages: per outbound message an `email_queue.gmail_message_id` lookup (~447-462, cached per-msgId per run only), per counterparty a contact lookup, per inbound an upsert. A 50-message active thread re-does ~50 queries every time it gets one new message (every 30 min).

## PROMPT
Batch the per-thread DB work.

1. For each thread, gather all `gmail_message_id`s up front and do ONE `.in('gmail_message_id', ids)` query each against `email_queue` and `inbox_messages` to know what's already stored — before iterating messages.
2. Batch the contact lookups (collect counterparty emails, one `.in('email', ...)` query per thread).
3. Skip messages older than `last_synced_at` minus a small overlap window, so already-processed messages aren't reprocessed.
4. Preserve the two-way-non-role auto-create-contact rule and the mailbox-sync logging behavior exactly (per project memory).

### Definition of done
- Per-thread DB queries drop from O(messages) to O(1) batched lookups.
- Same rows get synced/created as before (no missed or duplicate inbox_messages).
- `npm run lint` passes.

### Verify
Unit-test the batched "already stored" detection matches the per-message version on a fixture thread. Run the cron against a test mailbox and confirm message counts and auto-created contacts match a pre-change baseline.

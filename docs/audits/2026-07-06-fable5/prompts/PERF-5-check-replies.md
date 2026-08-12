# PERF-5 · check-replies scaling + sequence-detail RPC

- **Runner:** Opus 4.8 (touches reply detection) · **Effort:** M · **Severity:** HIGH · **Repo:** `~/crm-for-saas`

## Context
Two related read-scaling problems.

**A. `src/app/api/cron/check-replies/route.ts`:**
- The bounce scan (~377-381) `.eq('status','sent').gte('sent_at',since)` has **no `.limit()`** → PostgREST caps it at 1000, so NDR/bounce matching silently misses sends beyond ~143/day.
- The main loop (~72-360) does per-thread `getValidAccessToken` (a DB read ×≤500/run), `threads.get(format:"full")` (~250 ms each), then per-message dedup query (~106-110) and contact lookup (~132-137) **for messages already stored** — every 30 min.
- The `messages.list(q=after:)` rewrite has been queued since PR #254.

**B. `src/app/(dashboard)/sequences/[id]/page.tsx:127-217`** pages all enrollments then runs 2 `email_queue` queries per 200-id chunk just to compute one next-send/last-send min/max.

## PROMPT
1. **Bounce scan:** add explicit `.order('sent_at',{ascending:false}).limit(1000)` (or paginate the full window). Confirm the NDR matcher then sees the right set; add a `console.warn`/`reportError` if the window is truncated so it's visible.
2. **Batch the per-message DB work:** for each thread, collect all `gmail_message_id`s and do ONE `.in('gmail_message_id', ids)` dedup query against `inbox_messages`, and one batched contact lookup, instead of per-message queries.
3. **Cache the access token per account per run** (a `Map<accountId, token>`), don't refetch per thread.
4. **(Optional, larger) land the `messages.list(q=after:<lastSync>)` rewrite** so we only fetch new messages instead of re-walking full threads. If too big for this PR, leave a clear TODO and ship 1-3.
5. **Sequence-detail RPC:** add `get_sequence_send_bounds(p_sequence_id uuid)` returning `min(scheduled_for)` and `max(sent_at)` by joining email_queue → steps → sequence, and replace the enrollment-paging + per-chunk queries in `sequences/[id]/page.tsx` with a single RPC call.

### Definition of done
- Bounce matching covers the full window (not silently capped).
- check-replies issues O(threads) Gmail calls + O(threads) batched DB queries, not O(messages).
- Sequence detail loads next/last-send via one RPC.
- Reply detection & stop-on-reply behavior unchanged (regression-critical). `npm run lint` passes.

### Verify
Unit-test the batched dedup returns the same "new vs seen" split as the per-message version on a fixture thread. Manually open a large sequence's detail page and confirm next/last-send still render, with far fewer queries. If REL-4/REL-6 tests exist, run them.

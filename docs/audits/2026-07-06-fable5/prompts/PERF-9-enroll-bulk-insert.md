# PERF-9 · enrollContacts: bulk insert

- **Runner:** Opus 4.8 (must not double-enroll) · **Effort:** M · **Repo:** `~/crm-for-saas`

## Context
`src/lib/sequences/enrollment.ts:193-380` (via `/api/sequences/enroll`, maxDuration 300) loops per contact doing 2-4 sequential queries each (insert enrollment, insert email_queue, rollback deletes on error). 1,000 contacts ≈ 2-4k round trips ≈ minutes → timeout risk. Pairs with REL-6 (add tests first or alongside).

## PROMPT
Convert per-contact enrollment to bulk inserts.

1. Do all the pure-JS work first in a loop with no DB calls: dedup/suppression/customer checks, variant selection (respecting weights), and variable resolution — building two arrays: `enrollmentRows[]` and `queueRows[]`.
2. Bulk `insert(enrollmentRows)` in one call (chunk to ≤500 if needed), returning ids; map returned enrollment ids onto their queue rows; bulk `insert(queueRows)`. Use `.throwOnError()` (REL-2) and wrap in a transaction-like flow (or an RPC that does both inserts atomically) so a failure doesn't leave half-enrolled contacts.
3. Preserve the existing skip-counters and result shape the caller/toast relies on (`result.enrolled`, skip reasons) — the enroll toast reads these.
4. Keep the "don't SQL-insert into sequence_enrollments directly" contract intact — this stays inside `enrollContacts`, which is the sanctioned path.

### Definition of done
- Enrolling N contacts issues O(1) inserts (a few chunked calls), not O(N).
- Skip logic and the returned counts are identical to before.
- No partial-enrollment on error.
- `npm run lint` passes; REL-6 enrollContacts tests pass.

### Verify
Run the REL-6 enrollment tests (unsubscribed/customer skipped with no queue row; clean contact → exactly 1 enrollment + 1 queue row). Enroll a medium list in a test workspace and confirm counts match and timing is seconds not minutes.

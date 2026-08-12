# FEAT-12 · Audit trail + undo for bulk ops

- **Runner:** Opus 4.8 · **Effort:** S–M · **Priority:** P3 · **Repo:** `~/crm-for-saas`

## Context
`bulk-delete`/`bulk-update` on companies and contacts leave zero trace — a bad filter can silently wipe thousands of rows with no recovery. Building blocks: `src/lib/activities/insert.ts` and the service-role bulk routes to hook.

## PROMPT
1. **Audit rows:** create an `audit_log` (or reuse activities with a distinct type) capturing who/when/action/entity/affected-count/filter-used for every bulk mutation. Hook it into the bulk-delete/bulk-update routes.
2. **Soft-delete + restore window:** for bulk delete, prefer a soft-delete (`deleted_at`) with a restore action and a scheduled hard-purge after N days, OR snapshot the affected rows into the audit entry so a restore is possible. Add a "Undo last bulk action" affordance in the UI (time-boxed).
3. Confirm-dialog on bulk delete showing the affected count before commit (if not already present).

### Definition of done
- Every bulk op writes an audit entry; bulk delete is recoverable within a window; UI shows count + undo.
- `npm run lint`/`npm test` pass.

### Verify
Do a bulk update and a bulk delete on a handful of test rows → audit entries appear with correct counts; restore/undo brings the deleted rows back. Unit-test the audit hook.

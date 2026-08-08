# PERF-7 · Inbox list: narrow select / snippet column

- **Runner:** Sonnet · **Effort:** S · **Severity:** MEDIUM · **Repo:** `~/crm-for-saas`

## Context
`src/app/api/inbox/route.ts:23-41` does `select('*', contacts(...), email_queue(...))` for the list — including `body_html`, `body_text`, `body_translated_en` (inbox_messages ≈ 5.7 KB/row) → hundreds of KB–MBs of JSON per tab switch. The thread view refetches bodies anyway (`inbox/[id]/thread`), so the list doesn't need them.

## PROMPT
1. Narrow the inbox-list `select()` to the columns the list UI actually renders (sender, subject, snippet/preview, timestamps, flags, contact join fields, email_queue join fields) — **exclude** `body_html`, `body_text`, `body_translated_en`.
2. If the list shows a preview snippet, add a generated/stored `snippet` column (first ~200 chars, plain text) rather than shipping full bodies. Backfill via migration if you add it; otherwise derive the snippet in SQL.
3. Confirm the thread view still fetches full bodies (it should already).

### Definition of done
- Inbox list payload drops to a fraction of current size; list still renders identically.
- Thread view unaffected.
- `npm run lint` passes.

### Verify
Network panel: switching inbox tabs transfers KBs, not MBs. Open a thread → full body still loads.

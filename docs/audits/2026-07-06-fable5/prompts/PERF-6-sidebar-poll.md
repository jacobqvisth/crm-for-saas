# PERF-6 · Sidebar poll: `is_read` index + interval

- **Runner:** Sonnet · **Effort:** S · **Severity:** MEDIUM · **Repo:** `~/crm-for-saas`

## Context
`src/components/sidebar.tsx:80-95` polls unread count + tasks every 60s. `src/app/api/inbox/unread-count/route.ts:12-16` counts `inbox_messages` where `is_read=false` — with no covering index. Live prod: inbox_messages has **570,768 seq scans**.

## PROMPT
1. Migration `supabase/migrations/<ts>_inbox_is_read_index.sql`:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_inbox_messages_unread ON public.inbox_messages (workspace_id) WHERE is_read = false;
   ```
   Verify column names against `database.types.ts`. Do NOT self-apply to prod (note concurrent-apply in PR).
2. Raise the sidebar poll interval from 60s to 5 min (or gate it to only poll while the tab is visible via `document.visibilityState`). If Supabase Realtime is already used elsewhere, prefer a realtime subscription; otherwise the interval change is enough.

### Definition of done
- Partial index present; poll interval reduced or visibility-gated.
- Unread badge still updates in reasonable time.
- `npm run lint` passes.

### Verify
`EXPLAIN` the unread-count query after apply → index scan. Confirm the badge still reflects new mail within the new interval.

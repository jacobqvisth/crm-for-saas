# PERF-1 · email_queue sent-status indexes

- **Runner:** Sonnet · **Effort:** S · **Severity:** HIGH · **Repo:** `~/crm-for-saas`

## Context
Live prod shows `email_queue` with **430,738 sequential scans reading 6.4 billion tuples** — every cron tick and every inbox thread-open scans the whole 30 MB table. Only partial indexes on `status='scheduled'` exist; nothing covers sent-status scans or `gmail_thread_id`. Query sites: `cron/check-replies/route.ts:43-50,377-381`, `cron/process-emails/route.ts:93-116`, `dashboard/route.ts:106-125`, `inbox/[id]/thread/route.ts:29-34`, `inbox/[id]/draft-reply` ~107-112.

## PROMPT
Add covering indexes for the sent-status and thread lookups on `email_queue`.

1. New migration `supabase/migrations/<ts>_email_queue_sent_indexes.sql`:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_email_queue_sent ON public.email_queue (sent_at) WHERE status = 'sent';
   CREATE INDEX IF NOT EXISTS idx_email_queue_sender_sent ON public.email_queue (sender_account_id, sent_at) WHERE status = 'sent';
   CREATE INDEX IF NOT EXISTS idx_email_queue_gmail_thread ON public.email_queue (gmail_thread_id);
   ```
   (Prod apply should use `CREATE INDEX CONCURRENTLY` outside a transaction — note this in the PR for the person applying; keep the migration file non-concurrent or split, per the team's convention.)
2. Verify the actual column names against `src/lib/database.types.ts` (`sent_at`, `sender_account_id`, `gmail_thread_id`, `status`) before writing.
3. Do NOT self-apply to prod.

### Definition of done
- Migration present, idempotent.
- PR notes the concurrent-apply instruction and lists the queries each index serves.

### Verify
After apply, re-run the Supabase performance advisor and `EXPLAIN` one of the sent-status queries to confirm an index scan replaces the seq scan.

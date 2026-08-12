# PERF-2 · DB index & policy hygiene

- **Runner:** Sonnet (review the DROPs carefully) · **Effort:** M · **Repo:** `~/crm-for-saas`

## Context
Supabase performance advisor (prod, 2026-07-06) flags 35 unindexed foreign keys, 34 unused indexes, 10 RLS `initplan` policies re-evaluating `auth.*()` per row, and 14 duplicate permissive policies. Full lists in `../05-database-advisors.md`.

## PROMPT
Write `supabase/migrations/<ts>_index_and_policy_hygiene.sql`. Do NOT self-apply to prod.

1. **Add covering indexes** for the 35 unindexed FKs (list in the advisor doc). Prioritize high-traffic tables — `email_queue` (contact_id, step_id, workspace_id), `inbox_messages` (gmail_account_id, email_queue_id), `sequence_enrollments_sender_account_id`, `tasks_*`, `activities_user_id`, `phone_enrichment_jobs_contact_id`. Name them `idx_<table>_<col>`. Use `IF NOT EXISTS`.
2. **Drop unused indexes** — but only after a sanity check: for each of the 34, grep the codebase for a query that would use it and note it. DROP the clearly-dead ones (e.g. `idx_deals_owner`, `idx_activities_deal` — deals is dead code per CLEAN-1). **Keep** any that are simply young/rarely-hit-but-important (flag `idx_companies_name_trgm` and the inbox partial indexes for Jacob's confirmation rather than dropping blind). Put uncertain drops in a separate clearly-commented section of the migration so they can be applied separately.
3. **Fix the 10 RLS initplan policies** on `workspaces`, `workspace_members`, `user_profiles`, `user_unavailable_dates`: drop+recreate each replacing `auth.uid()` → `(select auth.uid())` (and same for `current_setting()`), preserving the policy's logic exactly.
4. **Merge the 14 duplicate permissive policies** on `workspace_ai_knowledge` (read+write both SELECT) and `workspace_members` (own + co-members SELECT) into one policy per action using `OR`.

### Definition of done
- Migration present; the FK-index section and the initplan/policy section are safe to apply immediately; the index-DROP section is separated and annotated with the grep evidence.
- No policy logic changes semantics (only performance).

### Verify
After apply, re-run the performance advisor: unindexed-FK and initplan/multiple-permissive counts should drop to ~0; unused-index count drops by the number you dropped. Spot-check RLS still works (a normal user can read their own profile/memberships).

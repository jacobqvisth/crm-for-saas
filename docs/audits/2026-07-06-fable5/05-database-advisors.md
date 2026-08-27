# Supabase Advisor Findings (live prod)

Source: `supabase get_advisors` (security + performance) against project `wdgiwuhehqpkhpvdzzzl` on 2026-07-06. These are the DB-side complement to the code audit. Fixes are in `prompts/SEC-5-db-advisor-hardening.md` (security) and `prompts/PERF-2-db-index-hygiene.md` (performance).

## Security advisor

### ERROR — RLS disabled in exposed `public` schema (4 tables)
`discovered_shops`, `dashboard_domain_health_checks`, `dashboard_cta_clicks`, `_ops_queue_pause_2026_04_28`. Readable/writable by `anon` via `/rest/v1/...` if the anon key leaks (it's in the client bundle by design). Fix: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + a service/workspace policy; or move the ops/staging tables (`_ops_queue_pause_*`, arguably `discovered_shops`) out of `public`.

### ERROR — RLS enabled but no policy (1 table)
`dashboard_domain_portfolio` — deny-all to non-service roles. If the app reads it with the anon client, that's a silent breakage; if only service-role reads it, add an explicit note. Add the intended policy.

### ERROR — SECURITY DEFINER views (5)
`google_ads_wl_users`, `google_ads_customer_match`, `google_ads_prospects`, `rep_touches`, `rep_identity`. These run with the creator's rights, bypassing the querying user's RLS. Fix: `ALTER VIEW ... SET (security_invoker = on)` (Postgres 15+) unless a definer bypass is intentional and access is otherwise revoked.

### WARN — SECURITY DEFINER functions executable by anon/authenticated (~13)
Callable via `/rest/v1/rpc/<name>`. **Mutating ones are the priority:** `merge_companies`, `reorder_route_stops`, `reset_daily_send_counts`, `increment_variant_sends`, `refresh_diagnostics_aggregates`. Read ones: `find_fuzzy_company_matches`, `find_strict_company_match`, `get_sequence_conversions`, `get_sequence_stats`, `get_user_workspace_ids`, `is_workspace_admin`.
Fix: `REVOKE EXECUTE ON FUNCTION ... FROM anon` (and `authenticated` where the app doesn't call it directly — most are called server-side with the service role, so revoking from both is usually safe; **verify each against code before revoking**).

### WARN — Functions with mutable search_path (18)
`get_user_workspace_ids`, `update_updated_at`, `get_next_send_time`, `reset_daily_send_counts`, `get_sequence_stats`, `increment_variant_sends`, `workspace_ai_knowledge_set_updated_at`, `safe_uuid`, `recompute_contact_owner`, `recompute_company_owner`, `trg_recompute_owner_from_activity`, `dashboard_domain_portfolio_touch`, and others. Fix: `ALTER FUNCTION ... SET search_path = public, pg_temp`.

### WARN — Other
- Extensions in `public`: `pg_net`, `pg_trgm`, `unaccent` — move to a dedicated schema (low priority; `pg_trgm`/`unaccent` are used by search).
- `email-images` **public bucket** has a broad SELECT policy allowing clients to **list all files**. Public object URLs don't need listing — scope the policy.
- **Leaked-password protection disabled** in Auth — enable the HaveIBeenPwned check.

## Performance advisor

### Unindexed foreign keys (35) — add covering indexes
High-traffic ones first: `email_queue_contact_id`, `email_queue_step_id`, `email_queue_workspace_id`, `inbox_messages_gmail_account_id`, `inbox_messages_email_queue_id`, `sequence_enrollments_sender_account_id`, `activities_user_id`, `phone_enrichment_jobs_contact_id`, `tasks_*` (company_id, contact_id, created_by, deal_id, enrollment_id), `gmail_accounts_user_id`, `workspace_members_user_id`, `usage_events_workspace_id`, `email_templates_workspace_id`, `sequences_created_by`, `route_stops_company_id/discovered_shop_id`, `daily_routes_assigned_to/generated_by`, `dashboard_*` FKs, `company_merge_candidates_*`, `deal_contacts_contact_id`, `contacts_attributed_to_send_id`, `sequence_step_variants_ai_parent_variant_id`, `sequence_steps_template_id`, `user_profiles_call_failover_user_id`, `user_unavailable_dates_workspace_id`, `workspace_ai_knowledge_updated_by`, `pipelines_workspace_id`, `dashboard_subscriptions_workshop_id`, `dashboard_workshops_owner_internal_user_id`.

### Unused indexes (34) — candidates to DROP (reduce write cost + storage)
Confirm none serves a rarely-run path first: `idx_deals_owner`, `idx_activities_deal`, `idx_prospector_search_cache_expires`, `usage_events_type_at_idx`, several `dashboard_diagnostic_chats/motor_usage/cost_entries/cta_clicks/review*/domain_portfolio` indexes, `idx_template_versions_template`, `discovered_shops_permanently_closed_idx`/`idx_discovered_shops_city`/`discovered_shops_do_not_route_idx`, `companies_stripe_subscription_id_idx`/`companies_skip_auto_followup_idx`/`companies_do_not_route_idx`/`companies_county_idx`/`idx_companies_name_trgm`, `subscriptions_status_idx`, `daily_routes_scheduled_for_idx`, `idx_sequence_step_variants_active`, `idx_company_merge_candidates_workspace_status`, `idx_activation_plan_items_group`/`idx_activation_plan_scenarios_workspace`, `contact_lists_purpose_idx`, `phone_numbers_workspace_idx`, `gmail_sync_state_workspace_id_idx`, `inbox_messages_needs_reply_idx`/`inbox_messages_answered_idx`/`inbox_messages_draft_idx`.
> Note: `idx_companies_name_trgm` and the inbox partial indexes may just be young (recently added) or serve infrequent-but-important queries — verify `idx_scan=0` isn't an artifact of a recent stats reset before dropping. The FK-index additions above matter more than these drops.

### RLS `initplan` re-evaluation (10 policies) — wrap auth calls in a subselect
`workspaces` (2), `workspace_members` (2), `user_profiles` (3), `user_unavailable_dates` (3). Each re-evaluates `auth.<fn>()`/`current_setting()` per row. Fix: replace `auth.uid()` with `(select auth.uid())` etc. inside the policy.

### Multiple permissive policies (14) — merge duplicates
`workspace_ai_knowledge` (read+write both grant SELECT) and `workspace_members` (own-membership + co-members both SELECT) across all roles. Merge each pair into one policy per action to cut per-query policy evaluation.

### Auth connection config (INFO)
Auth server capped at 10 connections (absolute) — switch to percentage-based if the instance is ever resized.

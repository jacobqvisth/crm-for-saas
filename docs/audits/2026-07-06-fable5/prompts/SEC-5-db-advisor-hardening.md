# SEC-5 · DB advisor hardening (RLS + SECURITY DEFINER)

- **Runner:** Opus 4.8 · **Effort:** M · **Severity:** ERROR (advisor) · **Repo:** `~/crm-for-saas`

## Context
Supabase's security advisor (run 2026-07-06 against prod `wdgiwuhehqpkhpvdzzzl`) flags ERROR-level issues. Full list in `../05-database-advisors.md`. Because the anon key ships in the client bundle, any PostgREST-exposed object without RLS/EXECUTE controls is reachable by `anon`. **Critical:** verify each change against how the app actually calls these objects — the app uses the service-role client for most server work (which bypasses RLS/grants), so revoking anon/authenticated is usually safe, but confirm before revoking anything the browser calls directly.

## PROMPT
Write one migration `supabase/migrations/<ts>_advisor_security_hardening.sql` addressing the advisor ERRORs/WARNs. Do NOT self-apply to prod — leave apply to the team's Management-API/psql process; note that in the PR.

1. **Enable RLS** on `discovered_shops`, `dashboard_domain_health_checks`, `dashboard_cta_clicks`, `_ops_queue_pause_2026_04_28`. Add policies: service-role full access is implicit; add the intended authenticated-read/workspace-scoped policy where the app reads them (grep the code for each table to see who reads it). For pure ops/staging tables (`_ops_queue_pause_*`), consider moving out of `public` instead.
2. **`dashboard_domain_portfolio`** has RLS on but no policy → add the intended policy (grep for its readers; if only service-role reads it, add a comment documenting that and a restrictive policy).
3. **Convert 5 SECURITY DEFINER views** to invoker: `ALTER VIEW public.<v> SET (security_invoker = on);` for `google_ads_wl_users`, `google_ads_customer_match`, `google_ads_prospects`, `rep_touches`, `rep_identity` — unless a definer bypass is intentional (check who queries them; the google_ads_* views feed the Google Ads Postgres connection — confirm the reading role still has table grants after switching to invoker).
4. **Revoke anon EXECUTE** on the SECURITY DEFINER functions, especially the mutating ones (`merge_companies`, `reorder_route_stops`, `reset_daily_send_counts`, `increment_variant_sends`, `refresh_diagnostics_aggregates`): `REVOKE EXECUTE ON FUNCTION public.<fn>(<args>) FROM anon;` and from `authenticated` where the browser doesn't call it. Grep `/rest/v1/rpc/<fn>` and `.rpc('<fn>'` in `src/` to see which are client-invoked — keep grants only for those.
5. **Set search_path** on the 18 flagged functions: `ALTER FUNCTION public.<fn>(<args>) SET search_path = public, pg_temp;`.
6. **Tighten `email-images` bucket** SELECT policy so clients can't list all files (scope to object access, not listing).
7. **Enable leaked-password protection** in Auth (note in PR — this is a dashboard/Auth-config toggle, not SQL).

### Definition of done
- Migration file present and idempotent (`IF EXISTS` guards).
- A short table in the PR body: each object → change → "app caller verified: <where>".
- No app code path that legitimately calls a revoked RPC via the browser is broken.

### Verify
After Jacob applies to prod, re-run the Supabase security advisor and confirm the ERROR count drops to 0 and the mutating-RPC WARNs clear. Locally, grep-confirm no `.rpc()` browser call targets a function you revoked from `authenticated`.

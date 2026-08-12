# Security Findings

Stamp: `80d00d8` (line numbers cite the `bfee7af` working tree). Single-tenant internal tooling, so several findings are bounded by "attacker needs a staff session" — flagged as such. The genuinely externally-triggerable ones are SEC-1, SEC-2, SEC-3.

## Auth model (context for all findings)
- **~126 routes** check a Supabase session inline (`auth.getUser`) or via the `resolveWorkspace()` helper (getUser + `workspace_members` lookup — this is why activation/roadmap/forums/videos routes are authed despite no inline `getUser`).
- **11 cron routes + 2 ceo-sync routes + e2e-login** use a `CRON_SECRET`/`SYNC_SECRET` bearer.
- **5 routes are public by design:** `tracking/{open,click,unsubscribe}` and `calls/webhook/{inbound,hangup}`.
- **`src/middleware.ts` only guards *page* routes**, never `/api/*`. Every API route is responsible for its own auth. This is done correctly everywhere except the intentionally-public 5.
- **Authorization is single-role:** any workspace member is effectively full-admin. Role checks (`role === 'admin'/'owner'`) exist in only 3 routes (`routes/[routeId]/assign`, `routes/generate`, `admin/signatures`). Acceptable for single-workspace internal use; flagged as SEC-8 in case that changes.

---

## SEC-1 · HIGH · Stored XSS: unsanitized incoming email HTML in the inbox
- **Where:** `src/app/(dashboard)/inbox/inbox-client.tsx:245-249` renders `item.body_html` (the raw `text/html` MIME part from a received email, `src/lib/gmail/messages.ts:49`) via `<div className="prose" dangerouslySetInnerHTML={{ __html: bodyHtml }} />`. **No sanitizer dependency exists** (no dompurify/sanitize-html/xss in package.json).
- **Exploit:** anyone who emails any of the ~12 synced mailboxes can embed `<img src=x onerror=...>`, `<svg onload=...>`, `<iframe>`. When staff open the thread, it runs in the authenticated dashboard origin — read/exfiltrate the workspace, drive authenticated API calls. Remotely triggerable by an unauthenticated outsider.
- **Same sink, lower risk (self/AI content):** `settings/profile/page.tsx:514`, `settings/signature-editor-modal.tsx:135`, `sequences/generate-variants-modal.tsx:248`, `sequences/email-step-editor.tsx:232`, `calls/call-drawer.tsx:594`.
- **Fix:** add DOMPurify; sanitize `body_html` (and any translated body) before render; ideally render incoming mail in a sandboxed `<iframe sandbox>` (no `allow-scripts`). Sanitize all 6 `dangerouslySetInnerHTML` inputs. → **Prompt:** `prompts/SEC-1-sanitize-inbox-html.md`. Effort M. Runner: Opus 4.8.

## SEC-2 · HIGH · Optional webhook auth + blind SSRF via recording URL
- **Where:** `src/app/api/calls/webhook/hangup/route.ts:22-28,66-75` + `src/lib/calls/elks.ts:83-92`. Auth: `const expected = process.env.CALL_WEBHOOK_SECRET; if (expected) { ...verify... }` — **skipped entirely if the env var is unset.** On hangup, `recordingUrl` from the form body is stored and `fetchRecordingAudio(url)` does `fetch(url)` with no host/IP validation (only branches Basic-auth on `url.includes("46elks.com")`). When set, the secret is passed as a **URL query param** (`inbound/route.ts:143`) so it leaks to logs/Referer.
- **Exploit:** if the secret is unset, both webhooks are open — forge `call_sessions` rows, and POST `recordingurl=http://169.254.169.254/latest/meta-data/...` for blind SSRF against cloud metadata / internal services.
- **Fix:** make the secret mandatory (fail closed in prod); verify via HMAC signature of the body, not a query param; allowlist recording fetches to `*.46elks.com`; add a shared private-IP/localhost/metadata-range guard for all server-side outbound fetches. → **Prompt:** `prompts/SEC-2-webhook-auth-ssrf.md`. Effort M. Runner: Opus 4.8.

## SEC-3 · MEDIUM · Open redirect on the click-tracking / `link.wrenchlane.se` domain
- **Where:** `src/app/api/tracking/click/[trackingId]/route.ts:14,74`. `url = searchParams.get("url")`; only checks `http(s)://` prefix, then `NextResponse.redirect(url, 302)` **fires even when `trackingId` matches no `email_queue` row**.
- **Exploit:** `.../api/tracking/click/anything/?url=https://evil.example` 302s anywhere. Since this domain is used in real sales emails, attackers can launder phishing links through the trusted branded tracking domain.
- **Fix:** only redirect when `trackingId` resolves to a real row **and** the target matches a link actually embedded in that email (store wrapped links, validate against them); at minimum an allowlist of destination hosts. → **Prompt:** `prompts/SEC-3-open-redirect.md`. Effort M. Runner: Opus 4.8.

## SEC-4 · MEDIUM · `e2e-login` production backdoor with hardcoded password
- **Where:** `src/app/api/e2e-login/route.ts:13-21,74-77`. GET route gated only by `?secret=CRON_SECRET` (query param → leaks to logs/history), creates/updates a real Supabase auth user `e2e-test@wrenchlane-test.local` with hardcoded password `"e2e-test-password-crm-2026!"` and returns an authenticated session cookie to `/dashboard`, using the service-role client.
- **Exploit:** anyone who obtains the shared `CRON_SECRET` (high leak surface — it's in cron URLs) gets an instant authenticated CRM session.
- **Fix:** refuse to run when `VERCEL_ENV === 'production'` (return 404) unless an explicit `E2E_ENABLED` flag; use a dedicated `E2E_SECRET` (not the cron secret) in a header not a query param; random per-run password; rotate the existing test account. → **Prompt:** `prompts/SEC-4-e2e-login-hardening.md`. Effort S. Runner: Sonnet.

## SEC-5 · MEDIUM · Supabase advisor ERROR-level DB exposure
From the live security advisor (see [05-database-advisors.md](./05-database-advisors.md) for the full list):
- **4 tables RLS-disabled in the PostgREST-exposed `public` schema** (ERROR): `discovered_shops`, `dashboard_domain_health_checks`, `dashboard_cta_clicks`, `_ops_queue_pause_2026_04_28`. Plus `dashboard_domain_portfolio` has RLS enabled but **no policy** (deny-all — may be breaking reads). Any table without RLS is readable/writable by `anon` via the REST API if the anon key leaks.
- **5 `SECURITY DEFINER` views** (ERROR): `google_ads_wl_users`, `google_ads_customer_match`, `google_ads_prospects`, `rep_touches`, `rep_identity` — bypass the querying user's RLS.
- **~13 `SECURITY DEFINER` functions executable by `anon`/`authenticated`** (WARN but notable): `merge_companies`, `reorder_route_stops`, `reset_daily_send_counts`, `increment_variant_sends`, `refresh_diagnostics_aggregates`, `find_*_company_match`, `get_sequence_*`, `is_workspace_admin`, `get_user_workspace_ids`. `merge_companies` and `reorder_route_stops` are **mutating** and callable unauthenticated via `/rest/v1/rpc/...`.
- **18 functions with mutable `search_path`** (WARN) — hardening.
- **`email-images` public bucket** has a broad SELECT policy allowing clients to list all files (WARN).
- **Leaked-password protection disabled** in Auth (WARN) — enable HaveIBeenPwned check.
- **Fix:** one migration — enable RLS + add workspace/service policies on the 4 tables (or move ops/staging tables out of `public`); convert the 5 views to `security_invoker=on`; `REVOKE EXECUTE ... FROM anon, authenticated` on the mutating RPCs (keep grants only where the client genuinely calls them); `ALTER FUNCTION ... SET search_path = public, pg_temp` on the 18; tighten the bucket policy; enable leaked-password protection. → **Prompt:** `prompts/SEC-5-db-advisor-hardening.md`. Effort M. Runner: Opus 4.8 (correctness — don't break the app's own RPC calls).

## SEC-6 · LOW-MEDIUM · PostgREST `.or()` filter injection from unescaped search
- **Where:** ~13 sites interpolate raw search input into `.or("email.ilike.%${search}%,...")`, e.g. `settings/compliance/route.ts:44`, `discovery/{promote,skip,verify-email,shops}`, `contacts-filter.ts:108`, `companies-filter.ts:52`, `lib/lists/filter-query.ts`. Only `lib/ceo/internal-test/loader.ts:299` sanitizes.
- **Impact bounded:** these use the anon/cookie client so RLS + the ANDed `workspace_id.eq` confine results to the caller's workspace; single-tenant. So it's correctness/robustness, not exfil. Still a real injection pattern (a `,`/`)`/`*`/operator in the term injects OR conditions).
- **Fix:** shared `escapePostgrestLike()` helper (escape `%`, `,`, `(`, `)`, `\`), apply at all interpolation sites. → **Prompt:** `prompts/SEC-6-postgrest-or-escape.md`. Effort S. Runner: Sonnet.

## SEC-7 · MEDIUM · No rate limiting anywhere
- **Where:** app-wide. No upstash/`@vercel/kv`/ratelimit usage. AI routes (`ai/generate-email`, `ai/generate-variants`, `ai/translate-email`), enrich routes, and public tracking/webhook endpoints have zero throttling.
- **Exploit:** one leaked/compromised staff session → unbounded Anthropic/Apify/Deepgram spend; public endpoints floodable to inflate DB writes / trigger `after()` AI work. (Login brute-force is mitigated by Supabase's hosted GoTrue limits.)
- **Fix:** per-user/IP rate limit on AI + enrich + public endpoints (Upstash or a Supabase counter table). → **Prompt:** `prompts/SEC-7-rate-limiting.md`. Effort M. Runner: Opus 4.8.

## SEC-8 · LOW (informational) · Single-role authz; open 46elks webhooks; tracking-pixel PII
- Any workspace member = full admin (see auth model). If untrusted staff are ever added, gate destructive/bulk endpoints (bulk-delete, merge, enroll, send) with a role check.
- 46elks webhooks accept unauthenticated POSTs that mutate `call_sessions` (46elks sends no auth headers) — SEC-2 addresses the secret; consider an IP allowlist too.
- `tracking/open` logs recipient IP + UA (inherent to open-tracking) — document in the privacy policy for EU/Swedish recipients (GDPR). Forgery requires the unguessable `crypto.randomUUID()` tracking_id, so mass-forge/mass-unsubscribe isn't practical.
- No prompt; policy/decision items. Track in BACKLOG.

## Verified NOT vulnerable (do not "fix")
- Gmail OAuth refresh tokens **encrypted at rest** (AES-256-GCM, `src/lib/encryption.ts`, key from `ENCRYPTION_KEY`, throws if unset — no weak fallback). `gmail/accounts` route never returns token columns.
- Service-role key server-only; only `NEXT_PUBLIC_{SUPABASE_URL,SUPABASE_ANON_KEY,APP_URL,GOOGLE_MAPS_BROWSER_KEY}` are public.
- No hardcoded secrets in `src/scripts/supabase`. `.env*.local` gitignored.
- zod genuinely used (~38 routes `safeParse`).
- Dependencies on current majors; the one dependency gap is the missing HTML sanitizer (→ SEC-1).

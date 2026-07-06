# SEC-7 · Rate limiting on AI / enrich / public endpoints

- **Runner:** Opus 4.8 · **Effort:** M · **Severity:** MEDIUM · **Repo:** `~/crm-for-saas`

## Context
No rate limiting exists anywhere. A single leaked/compromised staff session can drive unbounded Anthropic/Apify/Deepgram spend via the AI/enrich routes, and the public tracking/webhook endpoints are floodable (inflating DB writes / triggering `after()` AI work). Login brute-force is already mitigated by Supabase's hosted GoTrue.

Targets: `src/app/api/ai/*` (generate-email, generate-variants, translate-email), enrich routes (find-website, find-phone, bulk variants), and the public `tracking/*` + `calls/webhook/*` routes.

## PROMPT
Add lightweight rate limiting to expensive and public endpoints.

1. Choose the lowest-friction backend already available: if Vercel KV / Upstash Redis is provisionable, use `@upstash/ratelimit` + `@upstash/redis`. If not, implement a small Postgres-backed fixed-window limiter (a `rate_limits` table keyed on `(bucket, window_start)` with an atomic upsert-increment) — this reuses existing infra and is fine at current scale.
2. Create `src/lib/rate-limit.ts` exporting `checkRateLimit(key, { limit, windowSec })` returning `{ ok, remaining, retryAfter }`. Key AI/enrich by workspace+user; key public endpoints by IP.
3. Apply: AI routes ~20/min/user; enrich ~60/min/workspace; tracking/webhook ~a generous per-IP cap that won't hit real recipients but stops floods. Return 429 with `Retry-After` on breach.
4. Make it fail-open on limiter backend errors (don't take down sending if the limiter is down) but `reportError` (see REL-2) the failure.

### Definition of done
- AI, enrich, and public endpoints enforce a per-key limit and return 429 on breach.
- Normal usage never trips the limit.
- `npm run lint` passes.

### Verify
Unit-test the limiter (N calls pass, N+1 gets `ok:false`). Hit an AI route in a loop locally and confirm the 429 after the threshold.

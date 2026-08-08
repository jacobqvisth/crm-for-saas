# PERF-4 · `/api/dashboard`: SQL RPCs + `unstable_cache`

- **Runner:** Opus 4.8 · **Effort:** M · **Severity:** HIGH · **Repo:** `~/crm-for-saas`

## Context
`src/app/api/dashboard/route.ts:88-176` pages ALL contacts (16k → 16 sequential requests) for a growth chart, ALL sequence_enrollments (10.3k → 11 requests), plus all sent rows + events in range — on **every** view of the email-campaigns dashboard, with **no caching**. ~35-45 round trips per render, linear in data.

The `/dashboard/*` (ex-CEO) loaders already do this correctly: SQL aggregation + `unstable_cache` + 5-min TTL + tag bust (`src/lib/ceo/cache.ts`). Mirror that pattern.

## PROMPT
Convert the CRM home/campaigns dashboard from "pull tables, aggregate in JS" to server-side SQL aggregation + caching.

1. Add SQL RPC(s) that compute what the route currently derives in JS: contact-growth buckets (`date_trunc('day'/'week', created_at)` GROUP BY over the range), enrollment counts by status, sent/open/reply/bounce aggregates by day and by sequence. Return compact JSON. Make them `SECURITY INVOKER` (respect SEC-5) and workspace-scoped.
2. Rewrite `dashboard/route.ts` to call the RPC(s) instead of `pageAll(...)`.
3. Wrap the loader in `unstable_cache` with a 5-min TTL and a cache tag, following `src/lib/ceo/cache.ts`. Bust on relevant mutations if cheap; otherwise TTL-only is fine.
4. Ensure the sent-status aggregate benefits from PERF-1's `idx_email_queue_sent` (land PERF-1 first or in the same PR).

### Definition of done
- The dashboard route issues a small constant number of queries regardless of contact/enrollment count.
- Response is cached 5 min; numbers match the previous JS-aggregated output (spot-check a few buckets).
- `npm run lint` passes.

### Verify
Compare a few chart data points before/after (same totals). Time the endpoint (should drop from seconds to well under a second) and confirm the second load in 5 min is cache-served.

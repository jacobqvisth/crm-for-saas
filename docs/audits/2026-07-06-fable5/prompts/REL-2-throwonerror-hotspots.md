# REL-2 · `.throwOnError()` on send/reply/GDPR hotspots + `reportError()` (incl. REL-3)

- **Runner:** Opus 4.8 (crons + GDPR) · **Effort:** M · **Severity:** HIGH · **Repo:** `~/crm-for-saas`

## Context
152 Supabase mutations (40% of all mutation sites) never check `error` — the write can silently fail while the code proceeds as if it succeeded. This already caused a prod incident (activities CHECK failures dropped for months; the fix pattern lives in `src/lib/activities/insert.ts:1-22`). `.throwOnError()` is used **0** times today. There is also no error-observability layer (`captureException` appears once, in a test; 69 `console.error` sites go only to Vercel logs).

**Do the 6 hotspot files first (77 of 152 sites):**
- `src/app/api/cron/process-emails/route.ts` (30) — incl. `:191` `status:"sending"` (double-send risk), `:610/:722` step bumps, `:694/:765` next-step queue inserts (zombie enrollments), `:419` suppression insert.
- `src/app/api/cron/check-replies/route.ts` (15) — incl. `:250` `status:"replied"` (keep-emailing-after-reply), `:499` suppression insert.
- `src/app/api/contacts/[id]/forget/route.ts` (11) — **the entire GDPR erasure cascade (`:84-106`) is fire-and-forget** → route returns success while erasure silently failed (this is REL-3).
- `src/lib/calls/process.ts` (8), `src/lib/enrich/find-phone-for-contact.ts` (7), `src/app/api/cron/mailbox-sync/route.ts` (6).

## PROMPT
1. **Add `src/lib/report-error.ts`** exporting `reportError(err, context: Record<string,unknown>)` that `console.error`s with context AND posts to PostHog `captureException` (PostHog is already wired) or the existing `SLACK_ALERT_WEBHOOK_URL` used by domain-health. Fail-safe (never throws).
2. **Hotspot pass:** in the 6 files, append `.throwOnError()` to every fire-and-forget `insert/update/upsert/delete` (each cron already has an outer try/catch — ensure the catch calls `reportError` and returns a sensible status). For statements where a failure must NOT abort the whole run (best-effort logging), wrap individually in try/catch + `reportError` instead of throwing.
3. **REL-3 — GDPR forget route specifically:** make the erasure cascade transactional/atomic (an RPC doing all deletes in one transaction is ideal) OR check every delete's error and only return success if ALL succeeded; on any failure return 500 and `reportError`. Never report erasure success unless it happened.
4. **Suppression inserts** (`process-emails:419`, `check-replies:499`, `forget:52`): these must be checked — a silent failure means we keep emailing unsubscribed/bounced/erased addresses. Use `.throwOnError()`.
5. Leave the "must return 200" tracking-pixel writes (open/click) as try/catch + `reportError` (don't 500 a pixel), but do stop swallowing them silently.
6. Add a CI grep check (script) that fails if a new `await supabase.from(...).insert|update|delete(...)` has an unused result without `.throwOnError()` — keep it simple (grep-based is fine).

### Definition of done
- All 77 hotspot-file mutations either `.throwOnError()` or try/catch+`reportError`.
- GDPR forget route cannot return success on partial failure.
- `reportError` helper exists and is used.
- `npm run lint` and `npm test` pass.

### Verify
Unit-test the forget route returns 500 when a delete fails (mock a failing client). Simulate a failing `status:"sending"` update and confirm the item isn't left double-sendable (it throws → outer catch, not silent). Confirm suppression-insert failure surfaces.

# SEC-4 · Harden `e2e-login`

- **Runner:** Sonnet · **Effort:** S · **Severity:** MEDIUM · **Repo:** `~/crm-for-saas`

## Context
`src/app/api/e2e-login/route.ts` is a GET route that creates/signs-in a real Supabase auth user (`e2e-test@wrenchlane-test.local`) with a **hardcoded password committed to the repo** (`"e2e-test-password-crm-2026!"`), gated only by `?secret=CRON_SECRET` as a **URL query param** (leaks to logs/history), using the service-role client. Anyone with the shared cron secret gets an instant authenticated CRM session.

## PROMPT
Make the E2E login helper safe to have in the repo.

1. **Refuse in production:** return 404 when `process.env.VERCEL_ENV === 'production'` unless an explicit opt-in `E2E_ENABLED === '1'` is set (it won't be in prod).
2. **Dedicated secret in a header:** use a new `E2E_SECRET` env var (not `CRON_SECRET`), read from a request header (e.g. `x-e2e-secret`), compared with `crypto.timingSafeEqual`. Remove the query-param path.
3. **No hardcoded password:** generate a random password per invocation (`crypto.randomUUID()`), set it on the user via the admin API right before signing in, and don't log it. The Playwright config should call this route and use the returned session, not a known password.
4. Update `playwright.config.ts` / the e2e login helper and `.env` docs accordingly. Add `E2E_SECRET` to the CI secrets note in the PR description.
5. Rotate the existing test account (note in PR that Jacob should delete/rotate `e2e-test@wrenchlane-test.local`).

### Definition of done
- Route returns 404 in prod; works in CI/local with the header secret.
- No password literal in the repo.
- `npm run lint` passes; existing Playwright auth setup still logs in.

### Verify
Run the smoke E2E (`npm run test:e2e:smoke`) locally with `E2E_SECRET`/`E2E_ENABLED` set and confirm auth still works; hit the route without the header → 401, and simulate prod (`VERCEL_ENV=production`) → 404.

# QUAL-2 · Consolidate service-role client factories

- **Runner:** Sonnet · **Effort:** S · **Repo:** `~/crm-for-saas`

## Context
`src/lib/supabase/service.ts` (used by 18 routes) and `src/lib/supabase/admin.ts` (4 routes) create the same privilege-level (service-role) client. 6 routes bypass both factories with inline `createClient(env)` (`settings/team`, `e2e-login`, `discovery/{promote,skip,verify-email}`, `cron/mailbox-sync`). Three ways to do the same thing.

## PROMPT
1. Pick one canonical factory (keep `service.ts`), fold `admin.ts` into it (re-export for back-compat or update imports), and delete the duplicate.
2. Replace the 6 inline `createClient(env)` sites with the canonical factory.
3. Coordinate with ARCH-1: cron routes should use `requireCronSecret` + the service client factory.
4. No behavior change — same privilege, same clients.

### Definition of done
- One service-role client factory; `admin.ts` gone/aliased; no inline `createClient(service-role)` in routes.
- `npm run lint` and `npm test` pass.

### Verify
Grep confirms a single factory import path. Smoke-test one route from each former group still works (e.g. a discovery route, mailbox-sync dry-run).

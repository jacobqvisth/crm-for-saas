# ARCH-2 · Central `src/lib/env.ts`

- **Runner:** Sonnet · **Effort:** M · **Repo:** `~/crm-for-saas`

## Context
147 scattered `process.env` reads of 44 distinct vars, 28 non-null-asserted (`env.VAR!`), no central config except `src/lib/ceo/env.ts` (zod, ceo-only). Missing vars surface as runtime crashes or — worse — the `CRON_SECRET` pattern fails *closed but silently* (crons 401 forever). The `lib/ceo/env.ts` zod pattern is the model to generalize.

## PROMPT
1. Create `src/lib/env.ts` extending the `lib/ceo/env.ts` zod pattern to the whole app, with **lazy per-group** accessors so a missing var only throws when that group is used (avoids breaking unrelated routes): e.g. `env.supabase()`, `env.cron()`, `env.gmail()`, `env.anthropic()`, `env.calls()`, `env.slack()`. Each validates its vars with zod and throws a clear "Missing env var X for group Y" message.
2. Replace the scattered `process.env.X!` reads with the accessors, group by group. Keep `NEXT_PUBLIC_*` handling correct (those must stay statically referenced for the bundler — don't route them through a lazy server accessor if they're used client-side).
3. Fold `lib/ceo/env.ts` into the new module (or have it re-export) to avoid two config systems.

### Definition of done
- One env module; grouped lazy validation; clear errors on missing vars.
- No behavior change when all vars are present.
- `npm run build`, `npm run lint`, `npm test` pass.

### Verify
Temporarily unset a non-critical var and confirm the error names it clearly instead of a cryptic crash. Build succeeds with all vars present.

# PERF-15 · Add `maxDuration` to AI routes

- **Runner:** Sonnet · **Effort:** S · **Repo:** `~/crm-for-saas`

## Context
The find-phone 504 fix is verified in place (`src/lib/enrich/find-phone.ts:375-381` — AI only runs when the scrape found nothing). But several user-facing AI routes call Anthropic synchronously with **no `maxDuration` export**, risking a default-timeout 504 on slow model responses: `src/app/api/inbox/[id]/draft-reply/route.ts`, `src/app/api/ai/generate-email/route.ts`, `src/app/api/ai/generate-variants/route.ts`, `src/app/api/ai/translate-email/route.ts`. Also `sequences/duplicate` translates steps in parallel under `maxDuration=60` — a 10-step sequence with slow steps could exceed it.

## PROMPT
1. Add `export const maxDuration = 120;` (or 180 for generate-variants / translate-email, matching the enrich routes) to each of the four AI routes above.
2. Raise `sequences/duplicate`'s `maxDuration` if it translates many steps (bump to 180) OR make the per-step translation resilient (skip-on-timeout).
3. No behavior change beyond the timeout budget.

### Definition of done
- Each AI route exports an appropriate `maxDuration`.
- `npm run lint` passes.

### Verify
Grep each route for the export; trigger a draft-reply / generate-email and confirm it completes without a 504 on a slow response.

# ARCH-3 · zod validation on money-path mutation routes

- **Runner:** Sonnet · **Effort:** M · **Repo:** `~/crm-for-saas`

## Context
zod is installed and used in ~38 route files, but ~40 of 84 body-parsing routes have no schema validation — and the unvalidated ones are the money paths (`api/sequences/`, `api/contacts/`, `api/inbox/`). Unvalidated `request.json()` bodies flow into DB writes and external calls.

## PROMPT
1. For each mutation route under `api/sequences/`, `api/contacts/`, `api/inbox/` that calls `request.json()` without validation, add a zod schema and `const body = Schema.parse(await request.json())` (or `safeParse` + 400 on failure). Match the existing style used in activation/roadmap/calls routes.
2. Return a 400 with a helpful message on validation failure.
3. Keep schemas colocated or in a per-domain `schemas.ts`; reuse shared field schemas (email, uuid) where possible.
4. Don't over-constrain — mirror the fields the route actually uses; optional fields stay optional.

### Definition of done
- Every targeted mutation route validates its body; invalid bodies get 400, not a 500 or silent bad write.
- Valid requests behave exactly as before.
- `npm run lint` and `npm test` pass.

### Verify
Send a malformed body to a couple of migrated routes → 400 with a clear message; send a valid body → unchanged behavior. Add a unit test for one representative schema.

# PERF-11 · Sequence DELETE: chunk `.in()` / CASCADE

- **Runner:** Sonnet · **Effort:** S · **Repo:** `~/crm-for-saas`

## Context
`src/app/api/sequences/[id]/route.ts` documents the 1000-row PostgREST cap at ~line 55, and the activate path chunks correctly (~76-82), but the **DELETE** path (~149-193) fetches enrollments unpaginated (capped at 1000) and passes the full id array to `.in()`. A sequence with >1000 enrollments gets silent partial cleanup or a Bad Request (URL too long).

## PROMPT
Fix the DELETE path to handle >1000 enrollments.

Option A (preferred if FK relationships allow): add `ON DELETE CASCADE` to the child FKs (email_queue → enrollment, etc.) via a migration, and simplify the route to a single parent delete. Verify no child data must outlive the sequence.

Option B (code-only): reuse the same chunking helper the activate path uses — paginate the enrollment fetch and chunk every `.in()` delete into ≤500-id batches.

Do NOT self-apply any migration to prod.

### Definition of done
- Deleting a >1000-enrollment sequence removes all children with no error.
- `npm run lint` passes.

### Verify
In a test workspace, create a sequence with a large enrollment set (or unit-test the chunking) and delete it; confirm no orphaned email_queue/enrollment rows remain.

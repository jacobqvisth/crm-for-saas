# QUAL-3 · Typed join shapes; remove `as unknown as`

- **Runner:** Opus 4.8 · **Effort:** M · **Repo:** `~/crm-for-saas`

## Context
`: any`/`as any` are under control (21 total, strict TS, 0 `@ts-ignore`). The real leak is **69 `as unknown as` casts** — hotspots `list-detail-client.tsx` (7), `process-emails/route.ts` (7, incl. casting joined `enrollment.sequences` to reach `.settings`), `check-replies` (4). They silence exactly the joined-relation typing that PostgREST embeds break, so a schema change fails at runtime instead of compile time. Separately, ~37 hand-rolled entity types shadow generated `Tables<>` (mostly benign extensions; ~10 fully hand-written rows will drift).

## PROMPT
1. Define typed shapes for the 5 recurring PostgREST join results in `src/lib/types/` (e.g. `EnrollmentWithSequence`, `ContactWithCompany`, `QueueItemWithEnrollment`, `InboxMessageWithContact`, and the list-detail join). Build them from generated `Tables<>` + the embedded relation types so they track the schema.
2. Replace the `as unknown as` casts at the hotspots (process-emails, check-replies, list-detail-client) with these typed shapes.
3. Convert the ~10 fully hand-written row types to `Tables<>`/`Pick<Tables<...>>`.
4. Add an ESLint rule forbidding new `as unknown as` outside `*.test.ts` (a `no-restricted-syntax` selector is fine).

### Definition of done
- Join hotspots use typed shapes, not `as unknown as`.
- Hand-rolled row types replaced with generated ones.
- Lint rule blocks new `as unknown as` in non-test code.
- `npm run build`, `npm run lint`, `npm test` pass.

### Verify
`tsc`/`npm run build` passes with the casts removed (proves the types are correct, not just silenced). Grep shows the hotspot casts gone.

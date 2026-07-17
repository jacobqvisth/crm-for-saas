# REL-4 · De-dup + unit-test `isAutoReply`

- **Runner:** Sonnet · **Effort:** S · **Severity:** MEDIUM · **Repo:** `~/crm-for-saas`

## Context
`isAutoReply` (the OOO/auto-reply classifier that gates reply-rate stats and stop-on-reply) exists in **two** implementations: a route-local copy in `src/app/api/cron/check-replies/route.ts:564-603` and the exported version in `src/lib/gmail/messages.ts:62`. Drift between them directly mis-classifies replies.

## PROMPT
1. Delete the route-local copy in `check-replies/route.ts` and import `isAutoReply` from `src/lib/gmail/messages.ts`. If the two differ, reconcile into the lib version (keep the superset of detection rules) and note what changed.
2. Add `src/lib/gmail/messages.test.ts` (or extend an existing test) covering `isAutoReply`:
   - OOO subjects in en/sv/no/da/de/fi (e.g. "Out of office", "Frånvarande", "Autosvar", "Automatisk", "Abwesenheit") → `true`.
   - Headers `Auto-Submitted: auto-replied`, `Precedence: bulk` → `true`.
   - A normal human reply → `false`.
3. This unblocks the reply-rate stat correctness (OOO excluded per project memory).

### Definition of done
- One `isAutoReply` implementation, imported everywhere.
- Test covers multilingual OOO + headers + negative case.
- `npm test` and `npm run lint` pass.

### Verify
`npm test` → the new cases pass. Grep confirms no second `isAutoReply` definition remains.

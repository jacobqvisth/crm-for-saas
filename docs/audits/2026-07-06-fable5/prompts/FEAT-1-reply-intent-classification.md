# FEAT-1 · AI reply intent classification + action extraction

- **Runner:** Opus 4.8 · **Effort:** S–M · **Priority:** P1 · **Repo:** `~/crm-for-saas`

## Context
Every inbound reply lands as `category='inbox'` and reps triage manually. But Claude is **already called per inbound message** in `src/lib/inbox/translate-inbound.ts`, so classification is nearly free (piggyback the same call). Building blocks that already exist: `inbox_messages.category` (only `inbox`/`out_of_office` written today, `check-replies:162`); inbox tabs already filter by category; a "Mark Interested" → `lead_status='qualified'` handler; `tasks.snoozed_until` + auto-task-on-reply in check-replies.

## PROMPT
Add automatic reply classification + action extraction on inbound messages.

1. Extend the existing per-inbound Claude call (`lib/inbox/translate-inbound.ts`, or the reply-processing path in `check-replies`) to also return a structured classification: `intent ∈ {interested, not_interested, wrong_person, referral, auto_reply/ooo, question, neutral}` and an optional `follow_up` `{ action, due_date }` extracted from phrases like "call me in August" / "check back next quarter". Use a tool/JSON-schema response so it's structured (see the `claude-api` skill).
2. Write `intent` to `inbox_messages.category` (extend the category enum/values). Keep OOO detection working (isAutoReply — REL-4 — still authoritative for the OOO gate).
3. On `interested` → set the contact's `lead_status='qualified'` (reuse the existing Mark-Interested handler logic). On extracted follow-up → create a `tasks` row with `snoozed_until`/due date (reuse the auto-task path).
4. Surface the intent as a badge/filter in the inbox tabs (the tabs already filter by category).
5. Make classification best-effort: a failure must not break reply ingestion (wrap + `reportError`).

### Definition of done
- Inbound replies get an `intent` category; interested → lead_status update; date phrases → dated task.
- OOO still filtered from reply-rate stats.
- No extra Claude call beyond the existing per-message one (piggybacked).
- `npm run lint`/`npm test` pass.

### Verify
Feed 4-5 sample reply bodies (interested / not interested / wrong person / "call me in August" / OOO) through the classifier and confirm correct category, lead_status change on interested, and a dated task from the August one. Unit-test the parser with a mocked Claude response.

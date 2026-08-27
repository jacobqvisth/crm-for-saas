# FEAT-6 · Post-call follow-up automation

- **Runner:** Opus 4.8 · **Effort:** S · **Priority:** P2 · **Repo:** `~/crm-for-saas`

## Context
The call review drawer suggests tasks and an editable follow-up email (PR #510), but nothing happens automatically on no-answer/voicemail — retries fall through. Building blocks: `call_sessions` with outcomes, the tasks API, call lists/queue, the review-drawer accept flow.

## PROMPT
Add an outcome→action rule engine for calls.

1. Define a small rule set (config-driven so it's editable): e.g. `no_answer` → create a "retry call" task due in 2 business days; `voicemail` → retry task in 3 days + optional follow-up email; `interested` → create a "send proposal"/meeting task (and, if FEAT-9 exists, a booking link); `not_interested` → mark lead_status + suppress from that call list.
2. Trigger it when a `call_sessions` outcome is set (after the Claude summary / on drawer save). Make actions idempotent (don't create duplicate retry tasks for the same call).
3. Reuse the existing tasks API and call-list membership logic; respect the never_call / exclusion sets.
4. Surface which rule fired on the call activity/log.

### Definition of done
- Setting a call outcome creates the mapped follow-up action, idempotently.
- Rules are in one place and easy to edit.
- `npm run lint`/`npm test` pass.

### Verify
Log a test call with each outcome and confirm the right task/email/lead_status change appears exactly once. Unit-test the rule mapping.

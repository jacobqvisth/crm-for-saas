# FEAT-14 · Stale-data flags / re-engage lists

- **Runner:** Sonnet · **Effort:** S · **Priority:** P3 · **Repo:** `~/crm-for-saas`

## Context
Contacts who finish a sequence without replying just go dormant — there's no "not touched in 90 days" resurfacing. Building blocks: `contacts.last_contacted_at`, the dynamic list filter builder (`resolveListContactIds`), and enrollment completed status.

## PROMPT
1. Add staleness filters to the dynamic list filter builder: "last contacted before X days ago", "sequence completed with no reply", "no activity in N days".
2. Add a ready-made "Re-engage" smart-list preset combining those (completed + no reply + stale) minus exclusions (never_call, active enrollment, unsubscribed).
3. Surface a subtle "stale" flag on the contact/company profile when `last_contacted_at` is older than a threshold.

### Definition of done
- New staleness filters + a "Re-engage" preset in the list builder; stale flag on profiles.
- Excludes already-active/unsubscribed/never-call contacts.
- `npm run lint` passes.

### Verify
Build a re-engage list in a test workspace and confirm it contains only stale, no-reply, non-excluded contacts (cross-check a couple against `last_contacted_at`).

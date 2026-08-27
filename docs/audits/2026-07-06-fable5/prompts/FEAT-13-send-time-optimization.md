# FEAT-13 · Send-time optimization per recipient

- **Runner:** Opus 4.8 · **Effort:** M · **Priority:** P3 · **Repo:** `~/crm-for-saas`

## Context
The send window is per-sequence timezone (`Europe/Stockholm` default), so UK/CZ/Baltics recipients get Swedish hours. Building blocks: a DST-correct scheduler (`src/lib/sequences/scheduler.ts`), `contacts.country_code`, and timestamped `email_events` opens for learning a best hour.

## PROMPT
1. **Per-recipient timezone:** map `contacts.country_code` → an IANA timezone (a static lookup is fine) and have the scheduler compute the send window in the recipient's local time instead of a single sequence timezone. Keep a sequence-level default for unknown countries.
2. **(Optional) best-hour learning:** aggregate `email_events` open timestamps per recipient/segment to nudge sends toward historically-opened hours. Keep it optional/behind a flag — the timezone fix is the main win.
3. Preserve the DST-correct logic and existing daily-cap / 1-per-sender behavior.

### Definition of done
- Sends land in the recipient's local business hours based on country_code; unknown → sequence default.
- Scheduler tests updated/passing.
- `npm run lint`/`npm test` pass.

### Verify
Unit-test the scheduler for a UK and a Baltic contact vs a Swedish one → correct local-time windows across a DST boundary. Confirm no change for SE recipients.

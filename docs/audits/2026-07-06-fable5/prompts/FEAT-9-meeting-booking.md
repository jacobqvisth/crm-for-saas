# FEAT-9 · Meeting booking links

- **Runner:** Opus 4.8 · **Effort:** M–L · **Priority:** P2 · **Repo:** `~/crm-for-saas`

## Context
Interested replies convert off-platform (Calendly etc.) so meetings aren't auto-logged. Building blocks already present: Gmail OAuth per rep (add a calendar scope), `link.wrenchlane.se` + click tracking, activities/tasks, and — importantly — `settings/profile` already has a rep **unavailable-dates** feature (an availability primitive). This is Roadmap Phase 15, never built.

## PROMPT
Build a lightweight booking flow (this is the largest feature — scope tightly, can be 2 PRs).

1. **Availability:** derive bookable slots from the rep's working hours + `user_unavailable_dates` + (optionally) free/busy from Google Calendar (extend the Gmail OAuth with `calendar.events`/`freebusy` scope). Start with working-hours + unavailable-dates if calendar scope is a bigger lift.
2. **Public booking page:** a per-rep route (e.g. `/book/[repSlug]`) showing slots; on selection, create the meeting: a Google Calendar event (invite the prospect), a `tasks`/activity entry, and a meeting activity type.
3. **Distribute the link:** make the booking URL insertable into sequences/emails (through `link.wrenchlane.se` tracking so clicks are logged), and add it to the "interested reply" flow (FEAT-1/FEAT-6).
4. **Log outcome:** when booked, log a `meeting_booked` activity on the contact/company (feeds conversions attribution).

### Definition of done
- A prospect can book a slot; a calendar event + activity are created; the link is trackable and insertable.
- `npm run lint`/`npm test` pass.

### Verify
Book a slot end-to-end in a test env: confirm the calendar event, the activity log entry, and that an unavailable date is excluded from offered slots. Drive with the `verify` skill.

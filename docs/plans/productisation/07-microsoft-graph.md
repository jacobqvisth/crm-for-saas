# 07. The Microsoft Graph provider

**Depends on:** 06.
**Visible change for Wrenchlane:** none. Wrenchlane stays on Google.

Both providers run at the same time from here on. This is not a migration away from Gmail.

## Start with the spike. One day. Nothing else until it passes.

On a throwaway Microsoft 365 mailbox, prove four things end to end. Every estimate in this
phase rests on them, and discovering a failure two weeks in is the single biggest schedule
risk in the programme.

1. **Graph accepts a full MIME message.** The sequence engine builds MIME today, including
   Swedish characters, custom headers, tracking pixels and wrapped links. Prove Graph sends
   it byte-faithfully rather than re-encoding it.
2. **The real `Message-ID` can be read back.** Graph's `sendMail` is fire-and-forget and
   Exchange rewrites the `Message-ID`. Reply threading, reply detection and the sequence
   stop rules all key off the id the CRM believes it sent. The expected workaround is to
   create a draft, patch it, send it, then read `internetMessageId` off the Sent Items item.
   Prove it, and measure how long the item takes to appear.
3. **A reply threads correctly** using `In-Reply-To` and `References`, and can be matched
   back to the enrollment.
4. **Delta sync returns that reply**, and the delta token survives across polls.

If any of the four fails, stop and talk to Jacob (ground rule R11). Do not design around a
failure silently.

## Auth: app-only, in the customer's own tenant

Register the app in **the customer's** Entra tenant, not Jacob's. They own the domain and
the mailboxes.

- Application permissions `Mail.Send` and `Mail.ReadWrite`, with admin consent.
- An **Application Access Policy** scoping the app to named mailboxes only. Without it the
  app can read every mailbox in the tenant, which no IT department will accept and which
  they would be right to refuse.
- App-only rather than delegated, deliberately: today every mailbox holds its own refresh
  token and expiry silently disconnects accounts, which has already cost Wrenchlane live
  campaigns. App-only removes that failure mode entirely.

Admin consent is usually the slowest external step in the whole programme. Start the
conversation with each customer's IT long before this phase begins.

## Implementation notes

- **Throttling.** Exchange Online caps near 10,000 recipients per day and 30 messages per
  minute, and returns 429 with `Retry-After`. The existing `min_send_interval_seconds`,
  `max_daily_sends` and circuit breaker all still apply, but the numbers become per provider
  rather than global. Honour `Retry-After` rather than using the existing backoff.
- **Reading.** Prefer `/messages/delta` on the Inbox folder over `$search`. Graph's `$search`
  cannot be combined with `$filter` or `orderby` and will fight you. Delta is also genuinely
  better than the Gmail polling it replaces, which is a known scaling problem.
- **Shared mailboxes** are unlicensed and work under app-only access, so sender rotation is
  cheaper on Microsoft than on Google. Use them.
- **NDR parsing** already handles the Microsoft 365 format explicitly in
  `lib/gmail/parse-ndr.ts` (move it to `lib/mail/`). Microsoft NDRs come from
  `MicrosoftExchange...@<tenant>.onmicrosoft.com` and do **not** match the
  `mailer-daemon` / `postmaster` patterns, so the query that finds them must differ per
  provider.

## Done when

- The four spike checks pass, recorded in `cc-session-log.md` with what was actually observed.
- `GraphProvider` implements the same interface as `GmailProvider`.
- A real two-step sequence sends from a Microsoft mailbox and the whole loop works: open
  pixel, click wrapping, unsubscribe, a reply stopping the sequence, an out-of-office
  correctly **not** counting as a reply, a hard bounce parsed into a suppression, send caps
  and intervals enforced.
- Wrenchlane's Gmail sending is untouched and still working.

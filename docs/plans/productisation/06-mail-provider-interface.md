# 06. Move Gmail behind a `MailProvider` interface

**Depends on:** 05 (not strictly, but keep the order so phases stay serial).
**Visible change for Wrenchlane:** none. This is a pure refactor and Wrenchlane keeps
sending through Gmail the entire time.

## Why this is smaller than it looks

84 files mention Gmail, which sounds alarming. Almost all are UI labels, table names and
copy. The real Google API surface is **seven method calls**:

| Call | Used by |
|---|---|
| `users.messages.send` | send engine, one-off compose |
| `users.messages.list` | mailbox sync |
| `users.messages.get` | mailbox sync, inbox |
| `users.threads.list` | reply detection |
| `users.threads.get` | inbox thread view |
| `users.getProfile` | OAuth connect |

They live in six places: `lib/gmail/client.ts`, `lib/gmail/token-refresh.ts`,
`lib/gmail/send.ts`, `api/auth/gmail/*`, the three crons (`process-emails`,
`check-replies`, `mailbox-sync`), and the inbox reply routes.

Everything downstream is already provider agnostic: the queue, the tracking pixel, click
wrapping, unsubscribes, suppressions, throttling, warmup, the circuit breaker and sequence
rendering. Do not touch any of it.

## The interface

`src/lib/mail/provider.ts`:

- `sendMime(account, mime, opts)` returning the provider message id, the thread key, and
  the **real `Message-ID` as accepted by the provider**
- `listMessages(account, since | deltaToken)`
- `getMessage(account, id)`
- `listThreads(account, query)`
- `getThread(account, threadKey)`
- `getProfile(account)`
- `refreshCredentials(account)`

`getSentMessageId` is folded into `sendMime`'s return because Microsoft cannot supply it
any other way. Design the interface around the harder provider, not the easier one, or
phase 07 will have to change it.

## Schema

Rename `gmail_accounts` to `mail_accounts` and add `provider text not null default 'google'`.

Per ground rule R3 this is **two releases**:

- This release: create `mail_accounts`, backfill from `gmail_accounts`, dual-write, and
  point reads at the new table. Leave `gmail_accounts` in place as a view or a synced table.
- A later release, once every tenant is on this code: drop the old table.

Also add a provider-tagged thread key column wherever a Gmail `threadId` is stored today
(`sequence_enrollments`, `inbox_messages`, and check for others). Gmail's `threadId` and
Graph's `conversationId` do not mean the same thing and must not share a column's semantics.

## Done when

- `GmailProvider` implements the interface with no behaviour change.
- The eleven call sites go through the interface; nothing imports `googleapis` for mail
  outside `lib/mail/google/`. (`lib/ceo/sync/*` still may: that is analytics, not mail.)
- Wrenchlane sends a real sequence email through the refactored path, and the reply is
  detected, in production.
- All four checks pass.

# Open contract steps

Ground rule R3 makes every destructive schema change take two releases:

- **Release N (expand)** — add the new thing, dual-write, point reads at it. Never drop,
  never rename, never tighten.
- **Release N+1 (contract)** — once *every* tenant is confirmed on release N, remove the
  old thing.

The contract half is easy to forget, and each forgotten one is a small permanent tax: a
duplicated column that has to be kept in sync, a table two names refer to, a comment
explaining why both exist. Phase 10 D asks for this list to be kept somewhere visible.
This is that list.

**Nothing here may be actioned while any tenant is still on a release that reads the old
shape.** Today one tenant is *deployed* (Wrenchlane), so "every tenant" is still a low bar.
Since 2026-08-31 the control plane also holds rows for Animech and Spennare as
`provisioning`; those have no database yet, so they do not constrain a contract step — but
the moment either is stood up, it is stood up from `main`, and a contract step landed just
before that is the exact failure R3 exists to prevent.

The safe window is therefore **now**, before customer two exists, not later.

---

## Open

### 1. `gmail_accounts` → `mail_accounts`

- **Opened by:** phase 06, migration `20260830120000`
- **Current state:** `mail_accounts` is an auto-updatable single-table VIEW over the
  `gmail_accounts` table, with `security_invoker = true`. All application code reads and
  writes the view. There is exactly one copy of every row.
- **Contract step:** rename the table `gmail_accounts` → `mail_accounts` and drop the view.
  Because the view is a pure passthrough, this is a rename, not a reconciliation.
- **Blocked until:** every tenant is on a release whose code says `mail_accounts`.
- **Watch out:** `security_invoker = true` on the view is load-bearing. If the view is ever
  recreated without it, it runs as its OWNER and silently bypasses the RLS policies on the
  base table, which turns a rename into a workspace-isolation hole.

### 2. `gmail_thread_id` → `thread_key`

- **Opened by:** phase 06, migration `20260830120000`
- **Current state:** `email_queue.thread_key` and `inbox_messages.thread_key` exist and are
  backfilled (15,198 and 4,324 rows, zero mismatches). Ten writers dual-write both columns.
- **Contract step:** drop `email_queue.gmail_thread_id` and `inbox_messages.gmail_thread_id`,
  and remove the dual-write blocks (they are commented as such).
- **Blocked until:** every tenant is on a release that reads `thread_key`.
- **Why the rename matters at all:** Gmail's `threadId` and Microsoft Graph's
  `conversationId` are different ideas with different rules about when two messages belong
  together. Keeping a Graph value in a column named `gmail_thread_id` would be a lie that
  surfaces later as mis-threaded replies in a customer's inbox.

### 3. The seven Gmail call sites

- **Opened by:** phase 06, which landed the `MailProvider` interface but deliberately did
  not rewire the live call sites.
- **Current state:** `lib/gmail/client.ts` is a re-export of `lib/mail/google/client`. The
  send engine, `check-replies`, `mailbox-sync`, `activities/[id]/email-body`,
  `process-emails`' body fetch and the OAuth connect still call Gmail directly.
- **Contract step:** move each onto `MailProvider`, then delete `lib/gmail/client.ts`.
- **Blocked until:** a session where a real sequence send and reply detection can be watched
  in production, which is what the phase 06 brief requires as its "done when".
- **Watch out:** `GoogleMailProvider.sendMime` performs one extra metadata GET per send, to
  read the RFC `Message-ID` back. The current code does not. Small quota change.

---

## Closed

*(none yet)*

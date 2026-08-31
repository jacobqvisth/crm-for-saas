/**
 * RFC 5322 Message-ID generation for outbound sequence mail.
 *
 * Why this exists: follow-up steps used to put `email_queue.gmail_message_id`
 * straight into `In-Reply-To` / `References`. That column holds the Gmail *API*
 * id (e.g. `1a0384f90cd42904`), which is not a message identifier at all, and
 * it was emitted without angle brackets. So every follow-up shipped
 *
 *     In-Reply-To: 1a0384f90cd42904
 *
 * a syntactically invalid header on a message whose subject also claimed to be
 * a reply. "Claims to be a reply, carries a broken threading header" is a
 * forged-thread fingerprint, and it is one of the cheapest things for a filter
 * to score against. Gmail-to-Gmail threading survived on `threadId`; every
 * other receiver saw the forgery shape.
 *
 * The fix is to mint our own identifier that we can recompute later without
 * storing anything. It is derived from the `email_queue` row id, so the
 * Message-ID we set on step N is exactly the value step N+1 can reference by
 * looking up the previous row. No new column, no backfill.
 *
 * Gmail preserves a well-formed `<id@domain>` Message-ID on `messages.send`
 * and only rewrites malformed ones (moving the original to
 * `X-Google-Original-Message-ID`), so the value we set here is what actually
 * lands in the recipient's headers.
 */

/** Local-part prefix, so these are identifiable in a header dump. */
const PREFIX = "crm";

/**
 * Domain part of the Message-ID. Uses the sending mailbox's own domain so the
 * identifier is aligned with the From address rather than pointing somewhere
 * unrelated, which is what a receiver expects from a legitimate sender.
 */
function domainFor(senderEmail: string): string {
  const at = senderEmail.lastIndexOf("@");
  const domain = at === -1 ? "" : senderEmail.slice(at + 1).trim().toLowerCase();
  // Fall back to a stable literal rather than emitting `<id@>`. An invalid
  // Message-ID is the exact failure this module exists to prevent, so a
  // wrong-but-valid domain beats a malformed header.
  if (!domain || !domain.includes(".") || /[\s<>@,;:"\\[\]]/.test(domain)) {
    return "wrenchlane.com";
  }
  return domain;
}

/**
 * Deterministic Message-ID for one `email_queue` row.
 *
 * Deterministic on purpose: the follow-up step recomputes the previous send's
 * Message-ID from its row id, so threading needs no extra state.
 *
 * Returns null when the row id is unusable, so callers omit the header rather
 * than emit a broken one.
 */
export function messageIdForQueueRow(
  queueRowId: string | null | undefined,
  senderEmail: string,
): string | null {
  const id = (queueRowId ?? "").trim();
  // Row ids are UUIDs. Anything with header-significant characters in it would
  // let a malformed row inject a header, so refuse rather than sanitize.
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) return null;
  return `<${PREFIX}-${id}@${domainFor(senderEmail)}>`;
}

/**
 * Normalize a value destined for `In-Reply-To` / `References`.
 *
 * Adds the angle brackets when they are missing and rejects anything that
 * cannot be a message identifier (CR/LF, spaces, a missing `@`). Returns null
 * when the input is unusable so the caller drops the header entirely, which is
 * always better than sending a malformed one.
 */
export function normalizeMessageId(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (/[\r\n]/.test(raw)) return null;

  const inner = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1).trim() : raw;
  // A bare Gmail API id (no `@`) is the exact bug this guards against: it is
  // not a message identifier, so there is nothing meaningful to reference.
  if (!inner || !inner.includes("@")) return null;
  if (/[\s<>,;]/.test(inner)) return null;

  return `<${inner}>`;
}

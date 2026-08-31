/**
 * Reads the RFC 5322 threading headers off a message we received.
 *
 * Why this is a fetch and not a column: `inbox_messages` stores only the Gmail
 * *API* id (`gmail_message_id`, e.g. `1a04c29dff0d12db`). That is not a message
 * identifier, so a reply built from it emits a header no receiver can match —
 * see `message-id.ts` for the long version. Our own sends can recompute their
 * Message-ID from the `email_queue` row id, but an inbound message's identifier
 * is the sender's, so the only place it exists is the stored message itself.
 *
 * Fetching at reply time rather than adding a column means the 4k inbox rows
 * already on disk get correct threading with no migration and no backfill.
 *
 * Never throws: threading is a nice-to-have next to actually delivering the
 * reply, so every failure degrades to "no headers" and the caller sends without
 * them.
 */

import { getGmailClient } from "./client";
import { getValidAccessToken } from "./token-refresh";
import { getHeader, type GmailHeader } from "./messages";
import { normalizeMessageId } from "./message-id";

export interface ThreadingHeaders {
  /** The message's own Message-ID, normalized, or null when unusable. */
  messageId: string | null;
  /** Its References chain, oldest first, already normalized. */
  references: string[];
}

const EMPTY: ThreadingHeaders = { messageId: null, references: [] };

/**
 * Pulls the threading headers out of a Gmail payload's header list.
 *
 * Split out from the fetch so the parsing is testable on its own — the network
 * call has nothing interesting in it, this does.
 */
export function parseThreadingHeaders(headers: GmailHeader[]): ThreadingHeaders {
  // References is a whitespace-separated list; splitting on whitespace is
  // enough because every token is `<...>` and normalizeMessageId rejects
  // anything that isn't.
  const references = getHeader(headers, "References")
    .split(/\s+/)
    .map(normalizeMessageId)
    .filter((id): id is string => Boolean(id));

  return {
    messageId: normalizeMessageId(getHeader(headers, "Message-ID")),
    references,
  };
}

export async function fetchThreadingHeaders(
  accountId: string | null | undefined,
  gmailMessageId: string | null | undefined,
): Promise<ThreadingHeaders> {
  if (!accountId || !gmailMessageId) return EMPTY;

  try {
    const token = await getValidAccessToken(accountId);
    if ("error" in token) return EMPTY;

    const gmail = getGmailClient(token.accessToken);
    const { data } = await gmail.users.messages.get({
      userId: "me",
      id: gmailMessageId,
      format: "metadata",
      metadataHeaders: ["Message-ID", "References"],
    });

    return parseThreadingHeaders((data.payload?.headers ?? []) as GmailHeader[]);
  } catch {
    return EMPTY;
  }
}

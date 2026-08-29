import { getGmailClient } from "./client";
import { getValidAccessToken } from "@/lib/gmail/token-refresh";
import {
  extractHtmlBody,
  extractTextBody,
  getHeader,
  parseAddressList,
  parseEmailAddress,
  type GmailHeader,
  type GmailPayload,
} from "@/lib/gmail/messages";
import type {
  ListOptions,
  ListResult,
  MailAccount,
  MailMessage,
  MailProfile,
  MailProvider,
  MailThread,
  SendMimeParams,
  SendMimeResult,
} from "../provider";

// Google Workspace, behind the MailProvider interface.
//
// This is a WRAPPER, not a rewrite. Every call it makes is the same call the
// same code made before phase 06, in the same order, with the same arguments.
// The parsing helpers in lib/gmail/messages.ts are reused rather than
// reimplemented, so there is no second interpretation of a Gmail payload that
// could drift from the first.
//
// The one thing that is genuinely new is the RFC Message-ID on the send result.
// Gmail does not return it from `messages.send`, so it is read back with a
// metadata GET. That extra call is here rather than at the call sites because
// Microsoft will supply it differently in phase 07, and no caller should have
// to know which provider it is talking to.

function base64url(mime: string): string {
  return Buffer.from(mime)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

type GmailApi = ReturnType<typeof getGmailClient>;

function toMailMessage(
  raw: {
    id?: string | null;
    threadId?: string | null;
    internalDate?: string | null;
    labelIds?: string[] | null;
    payload?: GmailPayload | null;
  },
  mailboxEmail: string,
): MailMessage {
  const headers = (raw.payload?.headers ?? []) as GmailHeader[];
  const from = parseEmailAddress(getHeader(headers, "From"));
  return {
    providerMessageId: raw.id ?? "",
    threadKey: raw.threadId ?? "",
    rfcMessageId: getHeader(headers, "Message-ID") || null,
    from,
    to: parseAddressList(getHeader(headers, "To")),
    cc: parseAddressList(getHeader(headers, "Cc")),
    subject: getHeader(headers, "Subject"),
    sentAt: raw.internalDate ? new Date(Number(raw.internalDate)).toISOString() : null,
    bodyText: raw.payload ? extractTextBody(raw.payload) : null,
    bodyHtml: raw.payload ? extractHtmlBody(raw.payload) : null,
    // Gmail labels SENT on anything the mailbox sent. Falling back to comparing
    // the From address covers messages fetched without labels.
    outbound:
      (raw.labelIds ?? []).includes("SENT") ||
      from.email.toLowerCase() === mailboxEmail.toLowerCase(),
  };
}

export class GoogleMailProvider implements MailProvider {
  readonly name = "google" as const;

  async refreshCredentials(
    accountId: string,
  ): Promise<{ accessToken: string } | { error: string }> {
    const res = await getValidAccessToken(accountId);
    if (res.error) return { error: res.error };
    if (!res.accessToken) return { error: "No access token returned" };
    return { accessToken: res.accessToken };
  }

  private async client(accountId: string): Promise<GmailApi | { error: string }> {
    const token = await this.refreshCredentials(accountId);
    if ("error" in token) return { error: token.error };
    return getGmailClient(token.accessToken);
  }

  async sendMime(account: MailAccount, params: SendMimeParams): Promise<SendMimeResult> {
    const gmail = await this.client(account.id);
    if ("error" in gmail) return { ok: false, error: gmail.error };

    const raw = base64url(params.mime);
    try {
      const res = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw, threadId: params.replyToThreadKey ?? undefined },
      });

      const id = res.data.id ?? undefined;
      let rfcMessageId: string | undefined;
      if (id) {
        // Gmail assigns the Message-ID itself and does not return it from
        // send. Read it back so later steps can thread with In-Reply-To.
        // Best effort: a send that succeeded must not be reported as failed
        // because this follow-up call did not.
        try {
          const meta = await gmail.users.messages.get({
            userId: "me",
            id,
            format: "metadata",
            metadataHeaders: ["Message-ID"],
          });
          rfcMessageId =
            getHeader((meta.data.payload?.headers ?? []) as GmailHeader[], "Message-ID") ||
            undefined;
        } catch {
          rfcMessageId = undefined;
        }
      }

      return {
        ok: true,
        providerMessageId: id,
        threadKey: res.data.threadId ?? undefined,
        rfcMessageId,
      };
    } catch (err) {
      const e = err as { code?: number; message?: string };
      // 429 is "slow down", which the send engine treats differently from a
      // permanent failure: the account is parked, the message is not burned.
      if (e.code === 429) {
        return { ok: false, rateLimited: true, error: "Google API rate limit reached" };
      }
      return { ok: false, error: e.message ?? "Unknown Gmail error" };
    }
  }

  async listMessages(
    account: MailAccount,
    opts: ListOptions,
  ): Promise<ListResult<MailMessage>> {
    const gmail = await this.client(account.id);
    if ("error" in gmail) return { items: [], nextToken: null };

    const q = opts.since ? `after:${Math.floor(opts.since.getTime() / 1000)}` : undefined;
    const list = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: opts.maxResults ?? 100,
      pageToken: opts.deltaToken ?? undefined,
    });

    const items: MailMessage[] = [];
    for (const m of list.data.messages ?? []) {
      if (!m.id) continue;
      const full = await gmail.users.messages.get({ userId: "me", id: m.id, format: "full" });
      items.push(toMailMessage(full.data, account.email_address));
    }
    return { items, nextToken: list.data.nextPageToken ?? null };
  }

  async getMessage(account: MailAccount, providerMessageId: string): Promise<MailMessage | null> {
    const gmail = await this.client(account.id);
    if ("error" in gmail) return null;
    try {
      const res = await gmail.users.messages.get({
        userId: "me",
        id: providerMessageId,
        format: "full",
      });
      return toMailMessage(res.data, account.email_address);
    } catch {
      return null;
    }
  }

  async listThreads(
    account: MailAccount,
    opts: ListOptions & { query?: string },
  ): Promise<ListResult<{ threadKey: string }>> {
    const gmail = await this.client(account.id);
    if ("error" in gmail) return { items: [], nextToken: null };

    const parts: string[] = [];
    if (opts.query) parts.push(opts.query);
    if (opts.since) parts.push(`after:${Math.floor(opts.since.getTime() / 1000)}`);

    const res = await gmail.users.threads.list({
      userId: "me",
      q: parts.join(" ") || undefined,
      maxResults: opts.maxResults ?? 100,
      pageToken: opts.deltaToken ?? undefined,
    });
    return {
      items: (res.data.threads ?? []).flatMap((t) => (t.id ? [{ threadKey: t.id }] : [])),
      nextToken: res.data.nextPageToken ?? null,
    };
  }

  async getThread(account: MailAccount, threadKey: string): Promise<MailThread | null> {
    const gmail = await this.client(account.id);
    if ("error" in gmail) return null;
    try {
      const res = await gmail.users.threads.get({
        userId: "me",
        id: threadKey,
        format: "full",
      });
      return {
        threadKey,
        messages: (res.data.messages ?? []).map((m) =>
          toMailMessage(m, account.email_address),
        ),
      };
    } catch {
      return null;
    }
  }

  async getProfile(account: MailAccount): Promise<MailProfile | null> {
    const gmail = await this.client(account.id);
    if ("error" in gmail) return null;
    try {
      const res = await gmail.users.getProfile({ userId: "me" });
      return { emailAddress: res.data.emailAddress ?? "", displayName: null };
    } catch {
      return null;
    }
  }
}

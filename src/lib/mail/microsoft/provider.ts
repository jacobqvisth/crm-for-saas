import {
  GraphClient,
  MAX_MIME_BYTES,
  graphConfigFromEnv,
  isThrottled,
  type GraphConfig,
} from "./client";
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

// Microsoft 365, behind the MailProvider interface.
//
// UNVERIFIED AGAINST A REAL TENANT. Phase 07 opens with a four-check spike on a
// throwaway mailbox, and that spike has not been run: it needs a Microsoft 365
// mailbox and an Entra app registration with admin consent, neither of which
// exists yet. `scripts/graph-spike.mjs` runs all four checks and prints what it
// observed. Nothing here should be trusted in production until it has passed.
//
// THREE PLACES GRAPH IS NOT GMAIL, AND ALL THREE BITE
// --------------------------------------------------
// 1. SENDING. Graph's /sendMail is fire-and-forget: it returns 202 and no id,
//    so there is nothing to thread from and nothing to match a bounce against.
//    The only way to learn the message's identity is to create it as a draft,
//    send that draft, and read the result back. So this provider always takes
//    the draft path. It is two round trips instead of one, on purpose.
//
// 2. THE MESSAGE-ID. Exchange rewrites `Message-ID:` on send. Reply detection,
//    the sequence stop rules and bounce matching all key off the id the CRM
//    believes it sent, so believing the draft's id would silently break all
//    three. The real id is read back from Sent Items after sending.
//
// 3. THREADING. There is no way to say "put this in that conversation" the way
//    Gmail's `threadId` does on send. Graph decides conversation membership
//    from the `In-Reply-To` and `References` headers in the MIME. Those headers
//    are already written by the sequence engine, so replies thread correctly by
//    virtue of the MIME being right — but `replyToThreadKey` is therefore an
//    assertion this provider cannot act on, and it is deliberately not used.

const MESSAGE_FIELDS =
  "id,conversationId,internetMessageId,subject,sentDateTime,receivedDateTime,from,toRecipients,ccRecipients,body,isDraft";

interface GraphRecipient {
  emailAddress?: { name?: string | null; address?: string | null } | null;
}

interface GraphMessage {
  id?: string;
  conversationId?: string | null;
  internetMessageId?: string | null;
  subject?: string | null;
  sentDateTime?: string | null;
  receivedDateTime?: string | null;
  from?: GraphRecipient | null;
  toRecipients?: GraphRecipient[] | null;
  ccRecipients?: GraphRecipient[] | null;
  body?: { contentType?: string | null; content?: string | null } | null;
}

interface GraphCollection<T> {
  value?: T[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

function addresses(list: GraphRecipient[] | null | undefined): string[] {
  return (list ?? []).flatMap((r) => {
    const a = r.emailAddress?.address;
    return a ? [a] : [];
  });
}

function toMailMessage(raw: GraphMessage, mailboxEmail: string): MailMessage {
  const fromAddr = raw.from?.emailAddress?.address ?? "";
  const contentType = (raw.body?.contentType ?? "").toLowerCase();
  const content = raw.body?.content ?? null;
  return {
    providerMessageId: raw.id ?? "",
    // Graph's conversationId is the closest thing to a Gmail threadId, and the
    // interface calls it threadKey precisely because they are not equivalent:
    // a conversation can span mailboxes and survives subject changes.
    threadKey: raw.conversationId ?? "",
    rfcMessageId: raw.internetMessageId ?? null,
    from: {
      name: raw.from?.emailAddress?.name ?? "",
      email: fromAddr,
    },
    to: addresses(raw.toRecipients),
    cc: addresses(raw.ccRecipients),
    subject: raw.subject ?? "",
    // A received message has no sentDateTime in some shapes; fall back rather
    // than reporting null, because the reply-detection window is time based.
    sentAt: raw.sentDateTime ?? raw.receivedDateTime ?? null,
    // Graph returns ONE body in ONE format, not both. Asking for the other
    // needs a `Prefer: outlook.body-content-type` header and a second fetch,
    // which is not worth it: every consumer here falls back to the other field.
    bodyHtml: contentType === "html" ? content : null,
    bodyText: contentType === "text" ? content : null,
    // No SENT label exists. The mailbox's own address in From is the only
    // signal available without a second call for parentFolderId.
    outbound: fromAddr.toLowerCase() === mailboxEmail.toLowerCase(),
  };
}

export interface MicrosoftProviderOptions {
  config?: GraphConfig;
  fetchImpl?: typeof fetch;
  /**
   * How hard to look for the sent item to recover the rewritten Message-ID.
   * Exchange takes a moment to file it, so a single immediate read usually
   * misses. Bounded because this runs inside a send.
   */
  sentItemLookup?: { attempts: number; delayMs: number };
  /** Injected in tests so a bounded wait does not become a slow suite. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_SENT_LOOKUP = { attempts: 4, delayMs: 750 };

export class MicrosoftMailProvider implements MailProvider {
  readonly name = "microsoft" as const;

  private readonly opts: MicrosoftProviderOptions;
  private client: GraphClient | null = null;
  private configError: string | null = null;

  constructor(opts: MicrosoftProviderOptions = {}) {
    this.opts = opts;
  }

  /**
   * Resolved lazily rather than in the constructor.
   *
   * `lib/mail/index.ts` instantiates every provider at module load, on every
   * deployment including Wrenchlane's. Throwing here for missing Microsoft
   * credentials would take down a Google-only tenant at import time.
   */
  private graph(): GraphClient | { error: string } {
    if (this.client) return this.client;
    if (this.configError) return { error: this.configError };

    const cfg = this.opts.config ?? graphConfigFromEnv();
    if ("error" in cfg) {
      this.configError = cfg.error;
      return { error: cfg.error };
    }
    this.client = new GraphClient(cfg, this.opts.fetchImpl);
    return this.client;
  }

  private mailbox(account: MailAccount): string {
    return encodeURIComponent(account.email_address);
  }

  async refreshCredentials(
    _accountId: string,
  ): Promise<{ accessToken: string } | { error: string }> {
    // App-only: the token belongs to the application, not the mailbox, which is
    // exactly why Microsoft accounts cannot silently disconnect the way Google
    // ones do. The account id is accepted to satisfy the interface and is
    // deliberately unused.
    const g = this.graph();
    if ("error" in g) return { error: g.error };
    return g.token();
  }

  async sendMime(account: MailAccount, params: SendMimeParams): Promise<SendMimeResult> {
    const g = this.graph();
    if ("error" in g) return { ok: false, error: g.error };

    const bytes = Buffer.byteLength(params.mime, "utf8");
    if (bytes > MAX_MIME_BYTES) {
      return {
        ok: false,
        error: `MIME is ${bytes} bytes, over the ${MAX_MIME_BYTES}-byte limit for a direct create`,
      };
    }

    const box = this.mailbox(account);

    // 1. Create the draft FROM MIME. Graph accepts a base64 RFC 5322 message
    //    when the content type is text/plain, which is the only path that
    //    preserves the headers the sequence engine wrote: custom headers, the
    //    tracking pixel, wrapped links, In-Reply-To and References.
    const created = await g.request<GraphMessage>(`/users/${box}/messages`, {
      method: "POST",
      contentType: "text/plain",
      body: Buffer.from(params.mime, "utf8").toString("base64"),
    });
    if (!created.ok || !created.body?.id) {
      return {
        ok: false,
        error: created.error ?? "Graph did not return a draft id",
        ...(isThrottled(created.status) ? { rateLimited: true } : {}),
      };
    }

    const draftId = created.body.id;
    const conversationId = created.body.conversationId ?? undefined;
    const draftMessageId = created.body.internetMessageId ?? undefined;

    // 2. Send it. 202 with no body.
    const sent = await g.request(`/users/${box}/messages/${draftId}/send`, {
      method: "POST",
    });
    if (!sent.ok) {
      return {
        ok: false,
        error: sent.error ?? "Graph refused the send",
        ...(isThrottled(sent.status) ? { rateLimited: true } : {}),
      };
    }

    // 3. Recover the real Message-ID from Sent Items.
    //
    //    Best effort by design: the mail HAS GONE. Reporting a failure here
    //    would make the send engine retry and send it twice, which is far worse
    //    than losing the id. The draft's id is the fallback, and it is usually
    //    right — but "usually" is what spike check 2 exists to measure.
    const found = await this.findSentItem(account, {
      conversationId,
      internetMessageId: draftMessageId,
    });

    return {
      ok: true,
      providerMessageId: found?.id ?? draftId,
      threadKey: found?.conversationId ?? conversationId,
      rfcMessageId: found?.internetMessageId ?? draftMessageId,
    };
  }

  /**
   * Locate the just-sent message in Sent Items.
   *
   * Filters on conversationId when Graph gave us one, because that survives the
   * Message-ID rewrite; falls back to internetMessageId for the case where it
   * did not.
   */
  private async findSentItem(
    account: MailAccount,
    key: { conversationId?: string; internetMessageId?: string },
  ): Promise<GraphMessage | null> {
    const g = this.graph();
    if ("error" in g) return null;

    const filter = key.conversationId
      ? `conversationId eq '${key.conversationId.replace(/'/g, "''")}'`
      : key.internetMessageId
        ? `internetMessageId eq '${key.internetMessageId.replace(/'/g, "''")}'`
        : null;
    if (!filter) return null;

    const box = this.mailbox(account);
    const path =
      `/users/${box}/mailFolders/sentitems/messages` +
      `?$filter=${encodeURIComponent(filter)}` +
      `&$select=${encodeURIComponent("id,conversationId,internetMessageId,sentDateTime")}` +
      `&$orderby=${encodeURIComponent("sentDateTime desc")}&$top=1`;

    const { attempts, delayMs } = this.opts.sentItemLookup ?? DEFAULT_SENT_LOOKUP;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

    for (let i = 0; i < attempts; i++) {
      const res = await g.request<GraphCollection<GraphMessage>>(path);
      const hit = res.ok ? res.body?.value?.[0] : undefined;
      if (hit) return hit;
      if (i < attempts - 1) await sleep(delayMs);
    }
    return null;
  }

  async listMessages(
    account: MailAccount,
    opts: ListOptions,
  ): Promise<ListResult<MailMessage>> {
    const g = this.graph();
    if ("error" in g) return { items: [], nextToken: null };

    const box = this.mailbox(account);

    // Delta, not $search. Graph's $search cannot be combined with $filter or
    // $orderby, and delta is genuinely better than the polling it replaces: it
    // returns only what changed since the last token.
    //
    // A delta token is a fully formed URL, so a continuation is an absolute
    // request rather than a path with a query.
    let res;
    if (opts.deltaToken) {
      res = await g.request<GraphCollection<GraphMessage>>("", {
        absoluteUrl: opts.deltaToken,
      });
    } else {
      const params = new URLSearchParams({ $select: MESSAGE_FIELDS });
      if (opts.since) {
        params.set("$filter", `receivedDateTime ge ${opts.since.toISOString()}`);
      }
      if (opts.maxResults) params.set("$top", String(opts.maxResults));
      res = await g.request<GraphCollection<GraphMessage>>(
        `/users/${box}/mailFolders/inbox/messages/delta?${params.toString()}`,
      );
    }

    if (!res.ok) return { items: [], nextToken: null };

    const body = res.body;
    // NOTE THE DIFFERENCE FROM GMAIL. A Gmail page token is null when the
    // listing is finished. A Graph delta always ends with a deltaLink, and that
    // link IS the thing to store for the next poll. Returning null on the last
    // page, the way the Gmail provider does, would throw away the token and
    // turn every poll into a full resync.
    const nextToken = body?.["@odata.nextLink"] ?? body?.["@odata.deltaLink"] ?? null;

    return {
      items: (body?.value ?? []).map((m) => toMailMessage(m, account.email_address)),
      nextToken,
    };
  }

  async getMessage(
    account: MailAccount,
    providerMessageId: string,
  ): Promise<MailMessage | null> {
    const g = this.graph();
    if ("error" in g) return null;
    const res = await g.request<GraphMessage>(
      `/users/${this.mailbox(account)}/messages/${encodeURIComponent(providerMessageId)}` +
        `?$select=${encodeURIComponent(MESSAGE_FIELDS)}`,
    );
    if (!res.ok || !res.body) return null;
    return toMailMessage(res.body, account.email_address);
  }

  async listThreads(
    account: MailAccount,
    opts: ListOptions & { query?: string },
  ): Promise<ListResult<{ threadKey: string }>> {
    const g = this.graph();
    if ("error" in g) return { items: [], nextToken: null };

    // Graph has no threads collection. Conversations are derived by grouping
    // messages, so this lists messages and returns their distinct
    // conversationIds in first-seen order.
    const params = new URLSearchParams({
      $select: "id,conversationId",
      $orderby: "receivedDateTime desc",
      $top: String(opts.maxResults ?? 100),
    });
    const filters: string[] = [];
    if (opts.since) filters.push(`receivedDateTime ge ${opts.since.toISOString()}`);
    if (filters.length) params.set("$filter", filters.join(" and "));
    // `query` is Gmail search syntax at every call site. It means nothing to
    // Graph and silently matching on it would return the wrong messages, so it
    // is ignored rather than mistranslated.

    const res = opts.deltaToken
      ? await g.request<GraphCollection<GraphMessage>>("", { absoluteUrl: opts.deltaToken })
      : await g.request<GraphCollection<GraphMessage>>(
          `/users/${this.mailbox(account)}/messages?${params.toString()}`,
        );
    if (!res.ok) return { items: [], nextToken: null };

    const seen = new Set<string>();
    const items: { threadKey: string }[] = [];
    for (const m of res.body?.value ?? []) {
      const id = m.conversationId;
      if (id && !seen.has(id)) {
        seen.add(id);
        items.push({ threadKey: id });
      }
    }
    return { items, nextToken: res.body?.["@odata.nextLink"] ?? null };
  }

  async getThread(account: MailAccount, threadKey: string): Promise<MailThread | null> {
    const g = this.graph();
    if ("error" in g) return null;

    const filter = `conversationId eq '${threadKey.replace(/'/g, "''")}'`;
    const res = await g.request<GraphCollection<GraphMessage>>(
      `/users/${this.mailbox(account)}/messages` +
        `?$filter=${encodeURIComponent(filter)}` +
        `&$select=${encodeURIComponent(MESSAGE_FIELDS)}` +
        `&$orderby=${encodeURIComponent("receivedDateTime asc")}`,
    );
    if (!res.ok || !res.body) return null;
    return {
      threadKey,
      messages: (res.body.value ?? []).map((m) => toMailMessage(m, account.email_address)),
    };
  }

  async getProfile(account: MailAccount): Promise<MailProfile | null> {
    const g = this.graph();
    if ("error" in g) return null;
    const res = await g.request<{ mail?: string; userPrincipalName?: string; displayName?: string }>(
      `/users/${this.mailbox(account)}?$select=${encodeURIComponent("mail,userPrincipalName,displayName")}`,
    );
    if (!res.ok || !res.body) return null;
    return {
      emailAddress: res.body.mail ?? res.body.userPrincipalName ?? account.email_address,
      displayName: res.body.displayName ?? null,
    };
  }
}

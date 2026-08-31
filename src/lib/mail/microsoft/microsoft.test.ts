import { describe, expect, it } from "vitest";
import { GraphClient, graphConfigFromEnv, isThrottled } from "./client";
import { MicrosoftMailProvider } from "./provider";
import type { MailAccount } from "../provider";

// These tests pin the three places Graph is not Gmail, because those are the
// places a plausible-looking change breaks a customer's mail silently:
//
//   - the send is a draft-then-send, and the Message-ID comes back from Sent
//     Items rather than from the send itself;
//   - a delta listing ends with a deltaLink that MUST be kept, where a Gmail
//     page token would be null;
//   - a send that succeeded is never reported as failed just because the
//     follow-up read did not, because the retry would send the mail twice.
//
// They do not prove Graph behaves as documented. Only the spike on a real
// mailbox can do that. They prove this code does what it intends to.

const CFG = { tenantId: "tid", clientId: "cid", clientSecret: "secret" };

const account = (over: Partial<MailAccount> = {}): MailAccount => ({
  id: "acc-1",
  workspace_id: "ws-1",
  provider: "microsoft",
  email_address: "sales@animech.example",
  display_name: "Sales",
  status: "active",
  daily_sends_count: 0,
  daily_limit: 80,
  min_send_interval_seconds: 60,
  last_sent_at: null,
  ...over,
});

interface Route {
  match: (url: string, init: { method?: string }) => boolean;
  respond: (
    url: string,
    init: { method?: string; body?: string },
  ) => { status: number; body?: unknown; headers?: Record<string, string> };
}

function mockFetch(routes: Route[]) {
  const calls: { url: string; method: string; body?: string; headers: Record<string, string> }[] =
    [];
  const impl = (async (input: unknown, init: Record<string, unknown> = {}) => {
    const url = String(input);
    const method = String(init.method ?? "GET");
    calls.push({
      url,
      method,
      body: init.body as string | undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    for (const r of routes) {
      if (r.match(url, { method })) {
        const out = r.respond(url, { method, body: init.body as string | undefined });
        return {
          ok: out.status >= 200 && out.status < 300,
          status: out.status,
          headers: {
            get: (k: string) => out.headers?.[k.toLowerCase()] ?? null,
          },
          json: async () => {
            if (out.body === undefined) throw new Error("no body");
            return out.body;
          },
        };
      }
    }
    throw new Error(`unmocked request: ${method} ${url}`);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const tokenRoute: Route = {
  match: (u) => u.includes("login.microsoftonline.com"),
  respond: () => ({ status: 200, body: { access_token: "tok-1", expires_in: 3600 } }),
};

function provider(routes: Route[], over: Record<string, unknown> = {}) {
  const { impl, calls } = mockFetch([tokenRoute, ...routes]);
  const p = new MicrosoftMailProvider({
    config: CFG,
    fetchImpl: impl,
    sleep: async () => {},
    ...over,
  });
  return { p, calls };
}

describe("configuration", () => {
  it("reports missing credentials instead of throwing", () => {
    const res = graphConfigFromEnv({});
    expect("error" in res).toBe(true);
  });

  it("reads all three values from the environment", () => {
    const res = graphConfigFromEnv({
      MICROSOFT_TENANT_ID: " t ",
      MICROSOFT_CLIENT_ID: "c",
      MICROSOFT_CLIENT_SECRET: "s",
    });
    expect(res).toEqual({ tenantId: "t", clientId: "c", clientSecret: "s" });
  });

  // A Google-only tenant must not be harmed by Microsoft being unconfigured.
  it("fails the call, not the process, when unconfigured", async () => {
    const p = new MicrosoftMailProvider({ config: undefined, fetchImpl: mockFetch([]).impl });
    const res = await p.sendMime(account(), { mime: "x" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not configured/i);
    // The read paths degrade to empty rather than throwing.
    expect(await p.getMessage(account(), "m")).toBeNull();
    expect((await p.listMessages(account(), {})).items).toEqual([]);
  });
});

describe("the app-only token", () => {
  it("asks for .default with client_credentials", async () => {
    const { impl, calls } = mockFetch([tokenRoute]);
    const c = new GraphClient(CFG, impl);
    expect(await c.token()).toEqual({ accessToken: "tok-1" });
    const body = calls[0].body!;
    expect(body).toContain("grant_type=client_credentials");
    expect(body).toContain(encodeURIComponent("https://graph.microsoft.com/.default"));
  });

  it("caches the token rather than fetching per request", async () => {
    const { impl, calls } = mockFetch([tokenRoute]);
    const c = new GraphClient(CFG, impl);
    await c.token();
    await c.token();
    await c.token();
    expect(calls.filter((x) => x.url.includes("login.microsoft")).length).toBe(1);
  });

  it("refetches once the token is inside the expiry margin", async () => {
    const { impl, calls } = mockFetch([tokenRoute]);
    const c = new GraphClient(CFG, impl);
    const t0 = 1_000_000;
    await c.token(t0);
    // 3600s token, 60s margin: still good at +3500s, stale at +3550s.
    await c.token(t0 + 3_500_000);
    expect(calls.length).toBe(1);
    await c.token(t0 + 3_550_000);
    expect(calls.length).toBe(2);
  });

  it("collapses concurrent token requests into one", async () => {
    const { impl, calls } = mockFetch([tokenRoute]);
    const c = new GraphClient(CFG, impl);
    await Promise.all([c.token(), c.token(), c.token()]);
    expect(calls.length).toBe(1);
  });

  it("surfaces an auth failure as an error, never a throw", async () => {
    const { impl } = mockFetch([
      {
        match: (u) => u.includes("login.microsoftonline.com"),
        respond: () => ({
          status: 401,
          body: { error: "invalid_client", error_description: "bad secret" },
        }),
      },
    ]);
    const c = new GraphClient(CFG, impl);
    expect(await c.token()).toEqual({ error: "bad secret" });
  });

  it("drops the cached token when Graph rejects it with 401", async () => {
    let tokens = 0;
    const { impl } = mockFetch([
      {
        match: (u) => u.includes("login.microsoftonline.com"),
        respond: () => {
          tokens++;
          return { status: 200, body: { access_token: `tok-${tokens}`, expires_in: 3600 } };
        },
      },
      {
        match: (u) => u.includes("/me"),
        respond: () => ({ status: 401, body: { error: { message: "expired" } } }),
      },
    ]);
    const c = new GraphClient(CFG, impl);
    await c.request("/me");
    await c.request("/me");
    // Without invalidation the second call would reuse tok-1 and fail the same way.
    expect(tokens).toBe(2);
  });
});

describe("sending", () => {
  const MIME = "From: a@b\r\nSubject: Hej då\r\n\r\nHallå";

  const draftRoute: Route = {
    match: (u, i) => u.endsWith("/messages") && i.method === "POST",
    respond: () => ({
      status: 201,
      body: {
        id: "draft-1",
        conversationId: "conv-1",
        internetMessageId: "<draft@animech.example>",
      },
    }),
  };
  const sendRoute: Route = {
    match: (u, i) => u.includes("/messages/draft-1/send") && i.method === "POST",
    respond: () => ({ status: 202 }),
  };
  const sentItemsRoute: Route = {
    match: (u) => u.includes("sentitems"),
    respond: () => ({
      status: 200,
      body: {
        value: [
          {
            id: "sent-1",
            conversationId: "conv-1",
            internetMessageId: "<rewritten@exchange>",
          },
        ],
      },
    }),
  };

  it("creates the draft from base64 MIME, as text/plain", async () => {
    const { p, calls } = provider([draftRoute, sendRoute, sentItemsRoute]);
    await p.sendMime(account(), { mime: MIME });

    const create = calls.find((c) => c.url.endsWith("/messages") && c.method === "POST")!;
    expect(create.headers["content-type"]).toBe("text/plain");
    // Byte-faithful: this is what carries the Swedish characters, the custom
    // headers, the tracking pixel and the wrapped links through unchanged.
    expect(Buffer.from(create.body!, "base64").toString("utf8")).toBe(MIME);
  });

  it("addresses the mailbox by its own address, url-encoded", async () => {
    const { p, calls } = provider([draftRoute, sendRoute, sentItemsRoute]);
    await p.sendMime(account({ email_address: "a+b@animech.example" }), { mime: MIME });
    expect(calls.some((c) => c.url.includes(encodeURIComponent("a+b@animech.example")))).toBe(
      true,
    );
  });

  // Spike check 2, encoded. Exchange rewrites Message-ID on send; believing the
  // draft's id would silently break reply detection and bounce matching.
  it("returns the REWRITTEN Message-ID from Sent Items, not the draft's", async () => {
    const { p } = provider([draftRoute, sendRoute, sentItemsRoute]);
    const res = await p.sendMime(account(), { mime: MIME });
    expect(res.ok).toBe(true);
    expect(res.rfcMessageId).toBe("<rewritten@exchange>");
    expect(res.providerMessageId).toBe("sent-1");
    expect(res.threadKey).toBe("conv-1");
  });

  it("falls back to the draft's id when the sent item never appears", async () => {
    const { p } = provider([
      draftRoute,
      sendRoute,
      { match: (u) => u.includes("sentitems"), respond: () => ({ status: 200, body: { value: [] } }) },
    ]);
    const res = await p.sendMime(account(), { mime: MIME });
    expect(res.ok).toBe(true);
    expect(res.rfcMessageId).toBe("<draft@animech.example>");
    expect(res.providerMessageId).toBe("draft-1");
  });

  // The mail has already gone. Reporting failure here would make the send
  // engine retry and the recipient receive it twice.
  it("still reports success when the sent-item lookup errors outright", async () => {
    const { p } = provider([
      draftRoute,
      sendRoute,
      {
        match: (u) => u.includes("sentitems"),
        respond: () => ({ status: 500, body: { error: { message: "boom" } } }),
      },
    ]);
    const res = await p.sendMime(account(), { mime: MIME });
    expect(res.ok).toBe(true);
    expect(res.rfcMessageId).toBe("<draft@animech.example>");
  });

  it("retries the sent-item lookup a bounded number of times", async () => {
    let hits = 0;
    const { p } = provider(
      [
        draftRoute,
        sendRoute,
        {
          match: (u) => u.includes("sentitems"),
          respond: () => {
            hits++;
            return hits < 3
              ? { status: 200, body: { value: [] } }
              : {
                  status: 200,
                  body: { value: [{ id: "sent-1", internetMessageId: "<late@exchange>" }] },
                };
          },
        },
      ],
      { sentItemLookup: { attempts: 4, delayMs: 1 } },
    );
    const res = await p.sendMime(account(), { mime: MIME });
    expect(hits).toBe(3);
    expect(res.rfcMessageId).toBe("<late@exchange>");
  });

  it("reports a 429 as rate limited, not as a permanent failure", async () => {
    const { p } = provider([
      {
        match: (u, i) => u.endsWith("/messages") && i.method === "POST",
        respond: () => ({
          status: 429,
          body: { error: { message: "throttled" } },
          headers: { "retry-after": "30" },
        }),
      },
    ]);
    const res = await p.sendMime(account(), { mime: MIME });
    expect(res.ok).toBe(false);
    expect(res.rateLimited).toBe(true);
  });

  it("rejects an oversized MIME without calling Graph at all", async () => {
    const { p, calls } = provider([]);
    const res = await p.sendMime(account(), { mime: "x".repeat(5 * 1024 * 1024) });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/over the/);
    expect(calls.length).toBe(0);
  });

  // Graph offers no equivalent of Gmail's threadId-on-send. Threading comes
  // from In-Reply-To and References in the MIME. Quietly inventing a use for
  // this argument would produce conversations that look right in tests and
  // wrong in a customer's inbox.
  it("does not attempt to use replyToThreadKey", async () => {
    const { p, calls } = provider([draftRoute, sendRoute, sentItemsRoute]);
    await p.sendMime(account(), { mime: MIME, replyToThreadKey: "conv-should-be-ignored" });
    expect(calls.some((c) => (c.body ?? "").includes("conv-should-be-ignored"))).toBe(false);
    expect(calls.some((c) => c.url.includes("conv-should-be-ignored"))).toBe(false);
  });
});

describe("reading", () => {
  const message = {
    id: "m1",
    conversationId: "conv-9",
    internetMessageId: "<x@y>",
    subject: "Re: offert",
    sentDateTime: "2026-08-31T09:00:00Z",
    from: { emailAddress: { name: "Kund", address: "kund@example.com" } },
    toRecipients: [{ emailAddress: { address: "sales@animech.example" } }],
    ccRecipients: [],
    body: { contentType: "html", content: "<p>hej</p>" },
  };

  it("maps conversationId to threadKey and keeps the internet message id", async () => {
    const { p } = provider([
      { match: (u) => u.includes("/messages/m1"), respond: () => ({ status: 200, body: message }) },
    ]);
    const m = (await p.getMessage(account(), "m1"))!;
    expect(m.threadKey).toBe("conv-9");
    expect(m.rfcMessageId).toBe("<x@y>");
    expect(m.bodyHtml).toBe("<p>hej</p>");
    // Graph returns one body in one format. The text field is honestly null
    // rather than a stripped copy of the HTML.
    expect(m.bodyText).toBeNull();
    expect(m.outbound).toBe(false);
  });

  it("treats a message from the mailbox itself as outbound", async () => {
    const own = { ...message, from: { emailAddress: { address: "Sales@Animech.Example" } } };
    const { p } = provider([
      { match: (u) => u.includes("/messages/m1"), respond: () => ({ status: 200, body: own }) },
    ]);
    expect((await p.getMessage(account(), "m1"))!.outbound).toBe(true);
  });

  it("uses the delta endpoint on the inbox", async () => {
    const { p, calls } = provider([
      {
        match: (u) => u.includes("/delta"),
        respond: () => ({
          status: 200,
          body: { value: [message], "@odata.deltaLink": "https://graph/delta?token=abc" },
        }),
      },
    ]);
    await p.listMessages(account(), {});
    expect(calls.some((c) => c.url.includes("mailFolders/inbox/messages/delta"))).toBe(true);
  });

  // THE GMAIL DIFFERENCE. A Gmail page token is null when the listing ends. A
  // Graph delta ends with a deltaLink, and that link is the resume point for
  // the NEXT poll. Returning null here would turn every poll into a full
  // resync of the mailbox.
  it("returns the deltaLink as the next token, not null", async () => {
    const { p } = provider([
      {
        match: (u) => u.includes("/delta"),
        respond: () => ({
          status: 200,
          body: { value: [message], "@odata.deltaLink": "https://graph/delta?token=abc" },
        }),
      },
    ]);
    const res = await p.listMessages(account(), {});
    expect(res.items).toHaveLength(1);
    expect(res.nextToken).toBe("https://graph/delta?token=abc");
  });

  it("prefers the nextLink while pages remain", async () => {
    const { p } = provider([
      {
        match: (u) => u.includes("/delta"),
        respond: () => ({
          status: 200,
          body: {
            value: [],
            "@odata.nextLink": "https://graph/next?p=2",
            "@odata.deltaLink": "https://graph/delta?token=abc",
          },
        }),
      },
    ]);
    expect((await p.listMessages(account(), {})).nextToken).toBe("https://graph/next?p=2");
  });

  it("continues from a delta token as an absolute URL", async () => {
    const { p, calls } = provider([
      {
        match: (u) => u.startsWith("https://graph/delta"),
        respond: () => ({ status: 200, body: { value: [] } }),
      },
    ]);
    await p.listMessages(account(), { deltaToken: "https://graph/delta?token=abc" });
    expect(calls.some((c) => c.url === "https://graph/delta?token=abc")).toBe(true);
    // Not appended to the Graph base.
    expect(calls.some((c) => c.url.includes("graph.microsoft.com/v1.0https://"))).toBe(false);
  });

  it("groups messages into distinct conversations for listThreads", async () => {
    const { p } = provider([
      {
        match: (u) => u.includes("/messages?"),
        respond: () => ({
          status: 200,
          body: {
            value: [
              { id: "a", conversationId: "c1" },
              { id: "b", conversationId: "c1" },
              { id: "c", conversationId: "c2" },
              { id: "d" },
            ],
          },
        }),
      },
    ]);
    const res = await p.listThreads(account(), {});
    expect(res.items).toEqual([{ threadKey: "c1" }, { threadKey: "c2" }]);
  });

  it("escapes a quote in a conversation id rather than breaking the filter", async () => {
    const { p, calls } = provider([
      { match: (u) => u.includes("/messages?"), respond: () => ({ status: 200, body: { value: [] } }) },
    ]);
    await p.getThread(account(), "c'1");
    const url = calls.find((c) => c.url.includes("$filter"))!.url;
    expect(decodeURIComponent(url)).toContain("conversationId eq 'c''1'");
  });

  it("reads the profile from the user object", async () => {
    const { p } = provider([
      {
        match: (u) => u.includes("$select=mail") || u.includes("select=mail"),
        respond: () => ({
          status: 200,
          body: { mail: "sales@animech.example", displayName: "Sales" },
        }),
      },
    ]);
    expect(await p.getProfile(account())).toEqual({
      emailAddress: "sales@animech.example",
      displayName: "Sales",
    });
  });
});

describe("throttling classification", () => {
  it("counts 429 and the backend-pressure codes as slow down", () => {
    expect(isThrottled(429)).toBe(true);
    expect(isThrottled(503)).toBe(true);
    expect(isThrottled(504)).toBe(true);
    expect(isThrottled(400)).toBe(false);
    expect(isThrottled(401)).toBe(false);
  });

  it("surfaces Retry-After so the caller can honour it", async () => {
    const { impl } = mockFetch([
      tokenRoute,
      {
        match: (u) => u.includes("/me"),
        respond: () => ({
          status: 429,
          body: { error: { message: "slow down" } },
          headers: { "retry-after": "42" },
        }),
      },
    ]);
    const res = await new GraphClient(CFG, impl).request("/me");
    expect(res.retryAfterSeconds).toBe(42);
  });
});

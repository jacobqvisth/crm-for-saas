import { describe, expect, it } from "vitest";
import { isProviderSupported, providerFor } from "./index";
import { GoogleMailProvider } from "./google/provider";
import { MicrosoftMailProvider } from "./microsoft/provider";
import type { MailAccount } from "./provider";

const account = (over: Partial<MailAccount> = {}): MailAccount => ({
  id: "acc-1",
  workspace_id: "ws-1",
  provider: "google",
  email_address: "jacob@wrenchlane.com",
  display_name: "Jacob",
  status: "active",
  daily_sends_count: 0,
  daily_limit: 80,
  min_send_interval_seconds: 60,
  last_sent_at: null,
  ...over,
});

describe("provider selection", () => {
  it("serves a google account with the Google implementation", () => {
    const p = providerFor(account());
    expect(p).toBeInstanceOf(GoogleMailProvider);
    expect(p?.name).toBe("google");
  });

  // Filled in by phase 07. The implementation is registered even though the
  // four-check spike has not been run against a real tenant, because no account
  // carries provider='microsoft' until one is connected deliberately.
  it("serves a microsoft account with the Graph implementation", () => {
    const p = providerFor(account({ provider: "microsoft" }));
    expect(p).toBeInstanceOf(MicrosoftMailProvider);
    expect(p?.name).toBe("microsoft");
    expect(isProviderSupported("microsoft")).toBe(true);
  });

  // Constructing a provider must never need credentials. Both are instantiated
  // at import on every deployment, and Wrenchlane has no Microsoft secrets: a
  // constructor that demanded them would break a Google-only tenant at boot.
  it("constructs the Microsoft provider with no credentials present", () => {
    expect(() => new MicrosoftMailProvider()).not.toThrow();
  });

  it("returns null for a provider it has never heard of", () => {
    expect(providerFor(account({ provider: "carrier-pigeon" as never }))).toBeNull();
    expect(isProviderSupported("carrier-pigeon")).toBe(false);
  });

  it("knows google is supported", () => {
    expect(isProviderSupported("google")).toBe(true);
  });

  // Selection is by ACCOUNT, not by tenant default. A tenant mid-migration has
  // both kinds connected at once, and every message must leave through the
  // mailbox it was composed from.
  it("selects per account, so two providers can coexist in one workspace", () => {
    const g = providerFor(account({ id: "a", provider: "google" }));
    const m = providerFor(account({ id: "b", provider: "microsoft" }));
    expect(g?.name).toBe("google");
    expect(m?.name).toBe("microsoft");
  });
});

describe("the interface shape", () => {
  const p = new GoogleMailProvider();

  it("implements all seven methods", () => {
    for (const m of [
      "sendMime",
      "listMessages",
      "getMessage",
      "listThreads",
      "getThread",
      "getProfile",
      "refreshCredentials",
    ] as const) {
      expect(typeof p[m], m).toBe("function");
    }
  });

  // The two shapes that exist because of Microsoft, not Gmail. If either is
  // ever "simplified" away, phase 07 has to change the interface instead of
  // just implementing it.
  it("returns the RFC Message-ID from send, not from a separate call", () => {
    const send = p.sendMime.toString();
    expect(send).toContain("rfcMessageId");
  });

  it("talks about threadKey rather than threadId in its own surface", () => {
    // Gmail's threadId and Graph's conversationId are different ideas with
    // different rules about when two messages belong together. One name for
    // both would surface as mis-threaded replies in a customer's inbox.
    const send = p.sendMime.toString();
    expect(send).toContain("replyToThreadKey");
  });
});

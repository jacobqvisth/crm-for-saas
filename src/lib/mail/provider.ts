// The mail provider interface.
//
// WHY THIS EXISTS
// ---------------
// Wrenchlane sends through Google Workspace. Animech and Spennare are on
// Microsoft 365. All three run the same code, so the seven places this codebase
// actually talks to a mail API have to go through one seam.
//
// It is a smaller seam than it looks. 84 files mention Gmail, but almost all of
// them are UI labels, table names and copy. The real API surface is the seven
// methods below, and everything downstream of them — the queue, the tracking
// pixel, click wrapping, unsubscribes, suppressions, throttling, warmup, the
// circuit breaker, sequence rendering — is already provider agnostic and must
// not be touched.
//
// DESIGNED AROUND THE HARDER PROVIDER
// -----------------------------------
// Two shapes here exist because of Microsoft Graph, not because of Gmail. Both
// would be simpler if Gmail were the only target, and both would then have to
// change in phase 07, which is the mistake this note exists to prevent.
//
//   1. `sendMime` returns the real RFC `Message-ID` alongside the provider's
//      own id. Gmail can be asked for it afterwards; Graph cannot supply it any
//      other way than by reading it back off the sent item. Folding it into the
//      send result means the caller never has to know which is which.
//
//   2. A message carries a `threadKey`, not a `threadId`. Gmail's `threadId`
//      and Graph's `conversationId` are different things with different
//      lifetimes and different rules about when two messages share one. Giving
//      them one name would be a lie that only shows up as mis-threaded replies
//      in a customer's inbox.

import type { SupabaseClient } from "@supabase/supabase-js";

export type MailProviderName = "google" | "microsoft";

/** A connected sending mailbox, as stored in `mail_accounts`. */
export interface MailAccount {
  id: string;
  workspace_id: string;
  provider: MailProviderName;
  email_address: string;
  display_name: string | null;
  status: string | null;
  daily_sends_count: number | null;
  daily_limit: number | null;
  min_send_interval_seconds: number | null;
  last_sent_at: string | null;
}

export interface SendMimeParams {
  /** The full RFC 5322 message, already rendered and tracked. */
  mime: string;
  /**
   * Thread to attach this message to, in the provider's own terms. Always a
   * value this provider previously returned as `threadKey`; never one from a
   * different provider.
   */
  replyToThreadKey?: string | null;
}

export interface SendMimeResult {
  ok: boolean;
  /** The provider's own identifier for the stored message. */
  providerMessageId?: string;
  /** Provider-scoped conversation key. Gmail threadId, Graph conversationId. */
  threadKey?: string;
  /**
   * The real `Message-ID:` header the provider accepted or assigned.
   *
   * Needed for `In-Reply-To` and `References` on later steps, and for matching
   * bounces. Returned here rather than fetched later because Graph rewrites it
   * on send and will not tell you outside the sent item.
   */
  rfcMessageId?: string;
  error?: string;
  /** True when the provider said "slow down" rather than "no". */
  rateLimited?: boolean;
}

export interface MailMessage {
  providerMessageId: string;
  threadKey: string;
  rfcMessageId: string | null;
  from: { name: string; email: string };
  to: string[];
  cc: string[];
  subject: string;
  /** Provider timestamp, ISO 8601. */
  sentAt: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  /** True when the provider considers this message one the mailbox sent. */
  outbound: boolean;
}

export interface MailThread {
  threadKey: string;
  messages: MailMessage[];
}

export interface ListOptions {
  /**
   * Only messages after this instant. Providers differ in resolution and in
   * whether the bound is inclusive, so callers must tolerate re-seeing the
   * boundary message and de-duplicate on `providerMessageId`.
   */
  since?: Date;
  /** Provider-specific continuation token from a previous call. */
  deltaToken?: string | null;
  maxResults?: number;
}

export interface ListResult<T> {
  items: T[];
  /** Pass back as `deltaToken` to continue. Null when the listing is complete. */
  nextToken: string | null;
}

export interface MailProfile {
  emailAddress: string;
  displayName: string | null;
}

/**
 * Everything this application does with a mail API.
 *
 * Implementations must not throw for ordinary remote failures. Return an error
 * on the result instead: the send engine runs on a cron and a thrown error
 * there stops a whole batch rather than one message.
 */
export interface MailProvider {
  readonly name: MailProviderName;

  sendMime(account: MailAccount, params: SendMimeParams): Promise<SendMimeResult>;

  listMessages(account: MailAccount, opts: ListOptions): Promise<ListResult<MailMessage>>;

  getMessage(account: MailAccount, providerMessageId: string): Promise<MailMessage | null>;

  listThreads(
    account: MailAccount,
    opts: ListOptions & { query?: string },
  ): Promise<ListResult<{ threadKey: string }>>;

  getThread(account: MailAccount, threadKey: string): Promise<MailThread | null>;

  getProfile(account: MailAccount): Promise<MailProfile | null>;

  /**
   * Ensure the account has a usable access token, refreshing if needed.
   * Returns the token, or an error to surface without throwing.
   */
  refreshCredentials(
    accountId: string,
  ): Promise<{ accessToken: string } | { error: string }>;
}

/** How a provider implementation reaches the database. */
export interface ProviderContext {
  supabase: SupabaseClient;
}

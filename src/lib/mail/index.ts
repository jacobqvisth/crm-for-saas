import { GoogleMailProvider } from "./google/provider";
import type { MailAccount, MailProvider, MailProviderName } from "./provider";

export type {
  ListOptions,
  ListResult,
  MailAccount,
  MailMessage,
  MailProfile,
  MailProvider,
  MailProviderName,
  MailThread,
  SendMimeParams,
  SendMimeResult,
} from "./provider";

// Which implementation serves an account.
//
// Keyed off the ACCOUNT's provider column, not the tenant's configured default.
// They are usually the same, but a tenant migrating from one provider to the
// other will have both kinds connected at once, and every message must go out
// through the mailbox it was composed from. Reading the tenant default here
// would send half of them through the wrong system.

const google = new GoogleMailProvider();

const PROVIDERS: Record<MailProviderName, MailProvider | null> = {
  google,
  // Phase 07. Deliberately null rather than absent: the type stays exhaustive,
  // so adding "microsoft" to MailProviderName was already a compile error here
  // until this line existed.
  microsoft: null,
};

/**
 * The provider for this account.
 *
 * Returns null for a provider this build cannot serve, which callers must
 * handle by skipping the account rather than throwing: one unsupported mailbox
 * must not stop a send batch that also contains working ones.
 */
export function providerFor(account: Pick<MailAccount, "provider">): MailProvider | null {
  return PROVIDERS[account.provider] ?? null;
}

/** Whether this build can serve a given provider at all. */
export function isProviderSupported(name: string): name is MailProviderName {
  return name in PROVIDERS && PROVIDERS[name as MailProviderName] !== null;
}

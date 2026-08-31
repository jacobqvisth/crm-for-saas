import { GoogleMailProvider } from "./google/provider";
import { MicrosoftMailProvider } from "./microsoft/provider";
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

// Constructed eagerly, configured lazily. Both providers are instantiated on
// every deployment, Wrenchlane's included, so neither constructor may need
// credentials it does not have: the Microsoft one resolves its config on first
// use and reports a missing-config error instead of throwing at import time.
const microsoft = new MicrosoftMailProvider();

const PROVIDERS: Record<MailProviderName, MailProvider | null> = {
  google,
  // Phase 07. The implementation is complete but has NOT been run against a
  // real Microsoft 365 tenant — the four-check spike in the phase 07 brief
  // needs a mailbox and an admin-consented app registration that do not exist
  // yet. It is registered here rather than left null so the spike script can
  // drive the real class; no account has provider='microsoft', so nothing
  // reaches it in production until one is connected deliberately.
  microsoft,
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

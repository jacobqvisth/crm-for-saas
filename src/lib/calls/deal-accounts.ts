// Accounts that are being worked as direct deals by a named rep and should be
// kept out of the automated call lists (we don't want to cold-call a chain
// that's mid-negotiation). Hans owns the minbil.se / bilia.se relationships,
// so their contacts are excludable from the Call Planner and are assigned to
// him as primary owner. Add domains here as more chains move to direct deals.
export const DEAL_ACCOUNT_DOMAINS = ["minbil.se", "bilia.se"] as const;

/** True when the email belongs to one of the direct-deal chains above. */
export function isDealAccountEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain) return false;
  return DEAL_ACCOUNT_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

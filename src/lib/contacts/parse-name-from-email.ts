// Best-effort extraction of a person's name from the local part of an email
// address. Deliberately conservative: it only fires on the high-confidence
// `firstname.lastname@domain` shape so we never suggest garbage names for
// role inboxes (info@, sales@) or opaque locals (j.larsson, user12345).
//
// Used to offer a one-click "fill name from email" suggestion on the contact
// profile when both name fields are empty.

export interface ParsedName {
  firstName: string;
  lastName: string;
}

// Role / functional mailbox locals that are never a person's name.
const ROLE_LOCALS = new Set([
  'info', 'sales', 'support', 'contact', 'kontakt', 'hello', 'help', 'office',
  'team', 'mail', 'email', 'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'kundservice', 'kundtjanst', 'service', 'post', 'order', 'orders', 'billing',
  'accounts', 'accounting', 'hr', 'jobs', 'career', 'careers', 'marketing',
  'press', 'media', 'webmaster', 'postmaster', 'abuse', 'security', 'privacy',
  'legal', 'finance', 'invoice', 'invoices', 'reception', 'booking', 'bookings',
  'customerservice', 'customer', 'enquiries', 'inquiries', 'general', 'verkstad',
]);

function isNameToken(token: string): boolean {
  // At least two characters (drops single-letter initials like the "j" in
  // j.larsson) and letters only — Unicode-aware so å/ä/ö/ü/é etc. pass.
  return token.length >= 2 && /^\p{L}+$/u.test(token);
}

function capitalize(token: string): string {
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/**
 * Parse a `firstname.lastname@domain` email into a {firstName, lastName} pair.
 * Returns null for anything that isn't confidently a two-part personal name.
 */
export function parseNameFromEmail(email: string | null | undefined): ParsedName | null {
  if (!email) return null;

  const at = email.indexOf('@');
  if (at <= 0) return null;

  // Lowercase, drop any "+tag" suffix (timo.larsson+crm@…).
  const local = email.slice(0, at).toLowerCase().trim().split('+')[0];
  if (!local || ROLE_LOCALS.has(local)) return null;

  // Only the unambiguous two-token shape. Three+ tokens (first.middle.last,
  // hyphenated names) or a single token are too risky to guess.
  const tokens = local.split(/[._-]+/).filter(Boolean);
  if (tokens.length !== 2) return null;

  const [first, last] = tokens;
  if (ROLE_LOCALS.has(first) || ROLE_LOCALS.has(last)) return null;
  if (!isNameToken(first) || !isNameToken(last)) return null;

  return { firstName: capitalize(first), lastName: capitalize(last) };
}

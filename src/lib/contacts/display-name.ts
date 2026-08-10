/**
 * A human-usable label for a contact.
 *
 * Most outbound contacts are shared shop inboxes (info@…) with no personal
 * name, so falling back to a literal like "Contact" produced 232 auto-generated
 * tasks that all read the same and were impossible to tell apart. Prefer the
 * real name, then the company, then the address itself, which is always
 * something the reader can act on.
 */
export function contactDisplayName(c: {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  companies?: { name: string | null } | null;
  company_name?: string | null;
}): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;

  const company = c.companies?.name ?? c.company_name ?? null;
  if (company?.trim()) return company.trim();

  return c.email?.trim() || "Unknown contact";
}

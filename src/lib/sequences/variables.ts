import type { Tables } from "@/lib/database.types";

type Contact = Tables<"contacts">;
type Company = Tables<"companies">;

/** Matches bare {{variable}} and {{custom.field}} placeholders */
const VARIABLE_PATTERN = /\{\{(\w+(?:\.\w+)?)\}\}/g;

/**
 * Matches the serialized TipTap variable node:
 *   <span data-variable="first_name">{{first_name}}</span>
 *
 * The inner text may be {{var}} (newly saved) or a human-readable label
 * (legacy spans that slipped through).  We capture the variable name from
 * the data-variable attribute and ignore the inner text entirely.
 */
const SPAN_VARIABLE_PATTERN =
  /<span[^>]+data-variable="([a-z_]+(?:\.[a-z_]+)?)"[^>]*>(?:[^<]*)<\/span>/g;

const FALLBACKS: Record<string, string> = {
  first_name: "there",
  last_name: "",
  email: "",
  company_name: "your company",
  phone: "",
  sender_first_name: "",
  sender_company: "",
  unsubscribe_link: "",
};

function resolveVariable(
  variable: string,
  contact: Contact,
  company?: Company | null,
  trackingId?: string
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  switch (variable) {
    case "first_name":
      return contact.first_name || FALLBACKS.first_name;
    case "last_name":
      return contact.last_name || FALLBACKS.last_name;
    case "email":
      return contact.email || FALLBACKS.email;
    case "company_name":
      return company?.name || FALLBACKS.company_name;
    case "phone":
      return contact.phone || FALLBACKS.phone;
    case "sender_first_name":
      // Populated by the send pipeline from the Gmail account; empty string here
      return FALLBACKS.sender_first_name;
    case "sender_company":
      return FALLBACKS.sender_company;
    case "unsubscribe_link":
      return trackingId
        ? `${appUrl}/api/tracking/unsubscribe/${trackingId}`
        : "";
    default:
      // Handle custom.X variables
      if (variable.startsWith("custom.")) {
        const key = variable.slice(7);
        const customFields = contact.custom_fields as Record<string, string> | null;
        return customFields?.[key] ?? "";
      }
      return "";
  }
}

export function resolveVariables(
  template: string,
  contact: Contact,
  company?: Company | null,
  trackingId?: string
): string {
  // 1. Replace TipTap span-wrapped variables first (takes priority)
  //    Pattern: <span data-variable="first_name">{{first_name}}</span>
  let result = template.replace(SPAN_VARIABLE_PATTERN, (_, variable: string) => {
    return resolveVariable(variable, contact, company, trackingId);
  });

  // 2. Replace remaining bare {{variable}} patterns (backward compat with old sequences)
  result = result.replace(VARIABLE_PATTERN, (match, variable: string) => {
    const resolved = resolveVariable(variable, contact, company, trackingId);
    // If no resolver matched (unknown variable), return empty string rather
    // than leaving the raw placeholder in the sent email.
    return resolved !== undefined ? resolved : "";
  });

  return result;
}

/**
 * Compliance gate for unsubscribe handling. Now a passthrough.
 *
 * Used to auto-inject a visible "Unsubscribe" link + horizontal divider at
 * the bottom of every outbound body. That looked terrible on a 1:1 cold
 * outreach email — the divider landed between the closing greeting and the
 * sender's signature card, and the link itself read like a bulk-newsletter
 * footer in a context where each email is supposed to feel hand-sent.
 *
 * Compliance + deliverability are now covered by the List-Unsubscribe and
 * List-Unsubscribe-Post: One-Click headers set in `buildMimeMessage`
 * (src/lib/gmail/send.ts) — Gmail, Outlook, and Apple Mail all surface a
 * one-click unsubscribe affordance from those headers without polluting
 * the visible body. Template authors who want a visible link can drop
 * {{unsubscribe_link}} into the body and resolveVariable will turn it
 * into a clickable URL.
 *
 * The function is kept (not deleted) so the existing call sites in
 * enrollment.ts / process-emails / render.ts / enrollments[id] don't have
 * to change. If we ever want a tiny inline disclaimer back, it goes here.
 */
export function ensureUnsubscribeLink(
  bodyHtml: string,
  _trackingId: string,
): string {
  return bodyHtml;
}

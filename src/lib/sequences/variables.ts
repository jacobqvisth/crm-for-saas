import type { Tables } from "@/lib/database.types";

type Contact = Tables<"contacts">;
type Company = Tables<"companies">;

const VARIABLE_PATTERN = /\{\{(\w+(?:\.\w+)?)\}\}/g;

const FALLBACKS: Record<string, string> = {
  first_name: "there",
  last_name: "",
  email: "",
  company_name: "your company",
  phone: "",
  unsubscribe_link: "",
};

export function resolveVariables(
  template: string,
  contact: Contact,
  company?: Company | null,
  trackingId?: string
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return template.replace(VARIABLE_PATTERN, (match, variable: string) => {
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
      case "unsubscribe_link":
        return trackingId
          ? `${appUrl}/api/tracking/unsubscribe/${trackingId}`
          : "";
      default:
        // Handle custom.X variables
        if (variable.startsWith("custom.")) {
          const key = variable.slice(7);
          const customFields = contact.custom_fields as Record<string, string> | null;
          return customFields?.[key] || "";
        }
        return match;
    }
  });
}

/**
 * Ensures the email body contains an unsubscribe link.
 * If not present, appends one before sending (CAN-SPAM compliance).
 */
export function ensureUnsubscribeLink(bodyHtml: string, trackingId: string): string {
  if (bodyHtml.includes("{{unsubscribe_link}}") || bodyHtml.includes("/api/tracking/unsubscribe/")) {
    return bodyHtml;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const unsubUrl = `${appUrl}/api/tracking/unsubscribe/${trackingId}`;

  return `${bodyHtml}
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;text-align:center;font-size:12px;color:#94a3b8;">
  <a href="${unsubUrl}" style="color:#94a3b8;text-decoration:underline;">Unsubscribe</a>
</div>`;
}

/**
 * Returns the list of available template variables for the UI picker.
 */
export const TEMPLATE_VARIABLES = [
  { key: "first_name", label: "First Name", example: "John" },
  { key: "last_name", label: "Last Name", example: "Doe" },
  { key: "email", label: "Email", example: "john@example.com" },
  { key: "company_name", label: "Company Name", example: "Acme Inc" },
  { key: "phone", label: "Phone", example: "+1 555-0123" },
  { key: "unsubscribe_link", label: "Unsubscribe Link", example: "#" },
] as const;

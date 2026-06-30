// Contact resolution helpers shared by mail-ingestion paths.
//
// Today the mapping "email address -> CRM contact" is duplicated ad-hoc in
// check-replies and the inbox routes (exact-email match only). This module is
// the shared, slightly smarter version used by the mailbox-sync cron: exact
// email, then the `all_emails` array, then a domain -> company association.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Supabase = SupabaseClient<Database>;

export type ContactMatch = {
  contactId: string | null;
  companyId: string | null;
  matchType: "email" | "all_emails" | "domain_company" | "none";
};

/** Lower-cased domain of an email address, or null if malformed. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const d = email.slice(at + 1).trim().toLowerCase();
  return d || null;
}

// Free / consumer mail providers. We never attach these to a company by domain
// (a prospect on gmail.com is their own contact, not "everyone @gmail.com").
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "outlook.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "telia.com",
  "hotmail.se",
  "live.se",
  "spray.se",
]);

export function isGenericEmailDomain(domain: string): boolean {
  return GENERIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}

// Role / automated addresses that should never become a contact, even inside a
// genuine two-way thread (a no-reply that happens to receive a reply, mailing
// lists, transactional senders, etc.).
const ROLE_LOCALPART_PATTERNS = [
  /^no-?reply/i,
  /^do-?not-?reply/i,
  /^donotreply/i,
  /^noreply/i,
  /^mailer-daemon/i,
  /^postmaster/i,
  /^bounce/i,
  /^bounces/i,
  /^notifications?/i,
  /^newsletter/i,
  /^news$/i,
  /^mail$/i,
  /^mailing/i,
  /^automated/i,
  /^auto-?reply/i,
  /^unsubscribe/i,
  /^marketing@/i,
];

const ROLE_DOMAIN_HINTS = [
  "bounce",
  "mailer",
  "email.",
  "mail.",
  "notifications.",
  "send",
  "sg.", // sendgrid
  "mailgun",
  "amazonses",
];

/** True for no-reply / mailer-daemon / newsletter style senders. */
export function isRoleOrNoReplyAddress(email: string): boolean {
  const e = email.trim().toLowerCase();
  const at = e.indexOf("@");
  const localPart = at === -1 ? e : e.slice(0, at);
  if (ROLE_LOCALPART_PATTERNS.some((re) => re.test(localPart))) return true;
  const domain = emailDomain(e);
  if (domain && ROLE_DOMAIN_HINTS.some((h) => domain.includes(h))) return true;
  return false;
}

/**
 * Resolve an email address to a CRM contact within a workspace.
 * Order: exact `email` → `all_emails` array → domain → company (contact null).
 */
export async function findContactByEmail(
  supabase: Supabase,
  workspaceId: string,
  email: string,
): Promise<ContactMatch> {
  const e = email.trim().toLowerCase();
  if (!e || !e.includes("@")) {
    return { contactId: null, companyId: null, matchType: "none" };
  }

  // 1. Exact primary email.
  const { data: exact } = await supabase
    .from("contacts")
    .select("id, company_id")
    .eq("workspace_id", workspaceId)
    .eq("email", e)
    .maybeSingle();
  if (exact) {
    return { contactId: exact.id, companyId: exact.company_id, matchType: "email" };
  }

  // 2. Secondary emails scraped onto the contact.
  const { data: viaAll } = await supabase
    .from("contacts")
    .select("id, company_id")
    .eq("workspace_id", workspaceId)
    .contains("all_emails", [e])
    .limit(1)
    .maybeSingle();
  if (viaAll) {
    return { contactId: viaAll.id, companyId: viaAll.company_id, matchType: "all_emails" };
  }

  // 3. Domain → company (leaves contact null; caller decides whether to create
  //    a contact and attach it to this company).
  const domain = emailDomain(e);
  if (domain && !isGenericEmailDomain(domain)) {
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("domain", domain)
      .limit(1)
      .maybeSingle();
    if (company) {
      return { contactId: null, companyId: company.id, matchType: "domain_company" };
    }
  }

  return { contactId: null, companyId: null, matchType: "none" };
}

/** Split a display name ("Hans Andersson") into first / last. */
function splitName(name: string | null): { first: string | null; last: string | null } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { first: null, last: null };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * Create a contact discovered from synced mail, or return the existing one if a
 * concurrent insert already created it. Provenance is recorded in
 * custom_fields / tags (source stays a known-safe value).
 */
export async function autoCreateContactFromMail(
  supabase: Supabase,
  params: {
    workspaceId: string;
    email: string;
    name: string | null;
    companyId: string | null;
  },
): Promise<string | null> {
  const email = params.email.trim().toLowerCase();
  if (!email.includes("@")) return null;

  const { first, last } = splitName(params.name);
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      workspace_id: params.workspaceId,
      email,
      first_name: first,
      last_name: last,
      company_id: params.companyId,
      source: "manual",
      lead_status: "engaged",
      status: "active",
      last_contacted_at: new Date().toISOString(),
      tags: ["inbox-sync"],
      custom_fields: { synced_from: "mailbox_sync" },
      notes: "Auto-created from synced mailbox correspondence.",
    })
    .select("id")
    .single();

  if (!error && data) return data.id;

  // Lost a race (or hit a unique email constraint) — fall back to the existing row.
  const { data: existing } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", params.workspaceId)
    .eq("email", email)
    .maybeSingle();
  return existing?.id ?? null;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Client = SupabaseClient<Database>;

interface PromoteOpts {
  workspaceId: string;
  supabase: Client;
}

interface PromoteResult {
  companyId: string;
  contactId: string | null;
  alreadyPromoted: boolean;
  matchedExistingCompany: boolean;
}

const LANGUAGE_BY_COUNTRY: Record<string, string> = {
  EE: "et",
  SE: "sv",
  FI: "fi",
  LV: "lv",
  LT: "lt",
  NO: "no",
  DK: "da",
};

function extractDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Promote a single discovered_shops row to companies (+ a primary contact).
 * Idempotent — returns the existing company id if the shop is already linked
 * or if a same-domain / same-name+country company already exists.
 *
 * The bulk /api/discovery/promote endpoint has its own batched implementation
 * tuned for thousands of rows; it is intentionally not refactored to call
 * this lib (one round-trip per shop would lose its prefetch-once dedup).
 * Phase 4 follow-up to consolidate.
 */
export async function promoteDiscoveredShop(
  shopId: string,
  { workspaceId, supabase }: PromoteOpts,
): Promise<PromoteResult> {
  const { data: shop, error: shopErr } = await supabase
    .from("discovered_shops")
    .select(
      "id, name, website, domain, phone, address, street, city, postal_code, country, country_code, primary_email, all_emails, all_phones, instagram_url, facebook_url, google_place_id, rating, review_count, category, email_status, email_verified_at, crm_company_id, crm_contact_id",
    )
    .eq("id", shopId)
    .maybeSingle();

  if (shopErr) throw new Error(`promoteDiscoveredShop: load shop: ${shopErr.message}`);
  if (!shop) throw new Error(`promoteDiscoveredShop: shop ${shopId} not found`);

  if (shop.crm_company_id) {
    return {
      companyId: shop.crm_company_id,
      contactId: shop.crm_contact_id ?? null,
      alreadyPromoted: true,
      matchedExistingCompany: false,
    };
  }

  const resolvedDomain = shop.domain ?? extractDomain(shop.website);
  const nameKey =
    shop.name && shop.country_code
      ? { country_code: shop.country_code.toUpperCase(), name: shop.name }
      : null;

  let matchedCompanyId: string | null = null;

  if (resolvedDomain) {
    const { data: byDomain } = await supabase
      .from("companies")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("domain", resolvedDomain.toLowerCase())
      .limit(1)
      .maybeSingle();
    if (byDomain) matchedCompanyId = byDomain.id;
  }

  if (!matchedCompanyId && nameKey) {
    const { data: byName } = await supabase
      .from("companies")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("country_code", nameKey.country_code)
      .ilike("name", nameKey.name)
      .limit(1)
      .maybeSingle();
    if (byName) matchedCompanyId = byName.id;
  }

  if (matchedCompanyId) {
    await supabase
      .from("discovered_shops")
      .update({ status: "imported", crm_company_id: matchedCompanyId })
      .eq("id", shopId);
    return {
      companyId: matchedCompanyId,
      contactId: null,
      alreadyPromoted: false,
      matchedExistingCompany: true,
    };
  }

  const { data: company, error: companyErr } = await supabase
    .from("companies")
    .insert({
      workspace_id: workspaceId,
      name: shop.name,
      website: shop.website ?? null,
      domain: resolvedDomain,
      phone: shop.phone ?? null,
      address: shop.address ?? shop.street ?? null,
      city: shop.city ?? null,
      postal_code: shop.postal_code ?? null,
      country: shop.country ?? null,
      country_code: shop.country_code ?? null,
      instagram_url: shop.instagram_url ?? null,
      facebook_url: shop.facebook_url ?? null,
      google_place_id: shop.google_place_id ?? null,
      rating: shop.rating ?? null,
      review_count: shop.review_count ?? null,
      industry: "Automotive",
      category: shop.category ?? null,
      tags: ["independent"],
    })
    .select("id")
    .single();

  if (companyErr || !company) {
    throw new Error(`promoteDiscoveredShop: insert company: ${companyErr?.message ?? "no row"}`);
  }

  let contactId: string | null = null;
  if (shop.primary_email) {
    const language = shop.country_code ? LANGUAGE_BY_COUNTRY[shop.country_code.toUpperCase()] ?? null : null;
    const { data: contact, error: contactErr } = await supabase
      .from("contacts")
      .insert({
        workspace_id: workspaceId,
        first_name: null,
        last_name: null,
        email: shop.primary_email,
        phone: shop.phone ?? null,
        address: shop.address ?? shop.street ?? null,
        city: shop.city ?? null,
        postal_code: shop.postal_code ?? null,
        country: shop.country ?? null,
        country_code: shop.country_code ?? null,
        all_emails: shop.all_emails ?? null,
        all_phones: shop.all_phones ?? null,
        instagram_url: shop.instagram_url ?? null,
        facebook_url: shop.facebook_url ?? null,
        company_id: company.id,
        is_primary: true,
        source: "discovery",
        language,
        email_status: shop.email_status ?? "unknown",
        email_verified_at: shop.email_verified_at ?? null,
        lead_status: "new",
        status: "active",
        tags: ["owner"],
      })
      .select("id")
      .single();
    if (contactErr) {
      throw new Error(`promoteDiscoveredShop: insert contact: ${contactErr.message}`);
    }
    contactId = contact?.id ?? null;
  }

  await supabase
    .from("discovered_shops")
    .update({ status: "imported", crm_company_id: company.id, crm_contact_id: contactId })
    .eq("id", shopId);

  return {
    companyId: company.id,
    contactId,
    alreadyPromoted: false,
    matchedExistingCompany: false,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { findPhones, type FindPhonesResult, type PhoneCandidate } from "@/lib/enrich/find-phone";
import { findWebsite } from "@/lib/enrich/find-website";
import { rejectedPhonesFrom } from "@/lib/enrich/rejected-phones";

export type PhoneSearchOutcome = "found" | "none" | "blocked" | "error";

/** Summarize a finder run into a single outcome for tracking. */
export function classifyPhoneSearchOutcome(result: FindPhonesResult): PhoneSearchOutcome {
  if (result.phones.length) return "found";
  const d = result.debug;
  if (d?.searchError) return "error";
  // Every website fetch failed with something other than a real 200/404 →
  // the host is refusing us; distinct from "searched and genuinely nothing".
  if (d && d.fetchLog.length && d.fetchLog.every((f) => f.status !== 200 && f.status !== 404)) {
    return "blocked";
  }
  return "none";
}

/**
 * Resolve a contact/company, make sure we have a website to work with (finding
 * and persisting one when it's missing — the natural first step), then find its
 * phone numbers. Shared by the single-contact "Find numbers" button and the
 * bulk call-planner action so both behave identically.
 */

export interface FindPhonesForRecordResult extends FindPhonesResult {
  /** The website we discovered and saved on this run, if the record had none. */
  websiteAdded: string | null;
  /** The company the contact belongs to (resolved internally) — so a caller can
   *  save found numbers into the shared company pool. */
  companyId: string | null;
  /** ISO alpha-2 hint resolved from the contact/company, for saving numbers. */
  countryCode: string | null;
}

interface Args {
  workspaceId: string;
  contactId?: string | null;
  companyId?: string | null;
  /** When true (default), look up + persist a website if the record has none. */
  autoFindWebsite?: boolean;
}

export async function findPhonesForRecord(
  supabase: SupabaseClient,
  { workspaceId, contactId, companyId, autoFindWebsite = true }: Args,
): Promise<FindPhonesForRecordResult> {
  let name: string | null = null;
  let companyName: string | null = null;
  const websites: (string | null | undefined)[] = [];
  let city: string | null = null;
  let country: string | null = null;
  let countryCode: string | null = null;
  let industry: string | null = null;
  let category: string | null = null;
  let placeId: string | null = null;
  // Whether the company already carries website / place_id, so we only backfill
  // when they're missing (never overwrite a real value).
  let companyHasWebsite = false;
  let companyHasPlaceId = false;
  const existing: (string | null | undefined)[] = [];

  // For website discovery, when it's missing.
  let email: string | null = null;
  let extraEmails: string[] | null = null;
  let resolvedContactId: string | null = contactId ?? null;
  let resolvedCompanyId: string | null = companyId ?? null;

  if (contactId) {
    const { data: contact } = await supabase
      .from("contacts")
      .select(
        "first_name, last_name, email, all_emails, phone, all_phones, website, city, country, country_code, company_id, custom_fields",
      )
      .eq("id", contactId)
      .eq("workspace_id", workspaceId)
      .single();
    if (!contact) {
      return {
        found: false,
        phones: [],
        reasoning: "Contact not found",
        websiteAdded: null,
        companyId: null,
        countryCode: null,
      };
    }
    name = [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim() || null;
    email = contact.email;
    extraEmails = contact.all_emails as string[] | null;
    websites.push(contact.website);
    city = contact.city;
    country = contact.country;
    countryCode = contact.country_code;
    resolvedCompanyId = contact.company_id ?? null;
    existing.push(contact.phone, ...((contact.all_phones as string[] | null) ?? []));
    // Numbers the user marked "not correct" on this contact — never re-surface.
    existing.push(...rejectedPhonesFrom(contact.custom_fields));

    if (contact.company_id) {
      const { data: company } = await supabase
        .from("companies")
        .select("name, website, phone, city, country, country_code, industry, category, google_place_id, custom_fields")
        .eq("id", contact.company_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (company) {
        companyName = company.name;
        websites.push(company.website);
        city = city || company.city;
        country = country || company.country;
        countryCode = countryCode || company.country_code;
        industry = company.industry;
        category = company.category;
        placeId = company.google_place_id ?? null;
        companyHasWebsite = !!(company.website && String(company.website).trim());
        companyHasPlaceId = !!company.google_place_id;
        existing.push(company.phone);
        existing.push(...rejectedPhonesFrom(company.custom_fields));
      }
    }
  } else if (companyId) {
    const { data: company } = await supabase
      .from("companies")
      .select("name, website, phone, city, country, country_code, industry, category, google_place_id, custom_fields")
      .eq("id", companyId)
      .eq("workspace_id", workspaceId)
      .single();
    if (!company) {
      return {
        found: false,
        phones: [],
        reasoning: "Company not found",
        websiteAdded: null,
        companyId: null,
        countryCode: null,
      };
    }
    name = company.name;
    companyName = company.name;
    websites.push(company.website);
    city = company.city;
    country = company.country;
    countryCode = company.country_code;
    industry = company.industry;
    category = company.category;
    placeId = company.google_place_id ?? null;
    companyHasWebsite = !!(company.website && String(company.website).trim());
    companyHasPlaceId = !!company.google_place_id;
    existing.push(company.phone);
    existing.push(...rejectedPhonesFrom(company.custom_fields));
  } else {
    return {
      found: false,
      phones: [],
      reasoning: "No contact or company",
      websiteAdded: null,
      companyId: null,
      countryCode: null,
    };
  }

  // --- Website-first: if we have nothing to scrape, go find one -------------
  let websiteAdded: string | null = null;
  const haveWebsite = websites.some((w) => (w || "").trim());
  if (autoFindWebsite && !haveWebsite) {
    const site = await findWebsite({ name, email, extraEmails, city, country, industry, category });
    // Only trust + persist a confident find; a low-confidence guess would just
    // send the scraper at the wrong domain.
    if (site.found && site.website && (site.confidence === "high" || site.confidence === "medium")) {
      websiteAdded = site.website;
      websites.push(site.website);
      // Persist so it shows on the profile and future runs skip this step.
      if (resolvedContactId) {
        await supabase
          .from("contacts")
          .update({ website: site.website })
          .eq("id", resolvedContactId)
          .eq("workspace_id", workspaceId);
      } else if (resolvedCompanyId) {
        await supabase
          .from("companies")
          .update({ website: site.website })
          .eq("id", resolvedCompanyId)
          .eq("workspace_id", workspaceId);
      }
    }
  }

  const result = await findPhones({
    name,
    companyName,
    websites,
    city,
    country,
    countryCode,
    industry,
    category,
    placeId,
    existing,
  });

  // Backfill the company's website + Google place_id from what the Google-Maps
  // leg discovered, when they're missing — never overwriting a real value. This
  // makes the record self-improving: next time the scrape leg has a real site to
  // hit, and a stored place_id makes future lookups exact. Best-effort.
  if (resolvedCompanyId && (result.discoveredWebsite || result.discoveredPlaceId)) {
    const compUpd: { website?: string; google_place_id?: string } = {};
    if (!companyHasWebsite && result.discoveredWebsite) {
      compUpd.website = result.discoveredWebsite;
      websiteAdded = websiteAdded || result.discoveredWebsite;
    }
    if (!companyHasPlaceId && result.discoveredPlaceId) {
      compUpd.google_place_id = result.discoveredPlaceId;
    }
    if (Object.keys(compUpd).length) {
      try {
        await supabase
          .from("companies")
          .update(compUpd)
          .eq("id", resolvedCompanyId)
          .eq("workspace_id", workspaceId);
      } catch {
        /* backfill is best-effort — never break the finder */
      }
    }
  }
  // Mirror a discovered website onto the contact too, when it has none.
  if (resolvedContactId && result.discoveredWebsite) {
    try {
      const { data: c } = await supabase
        .from("contacts")
        .select("website")
        .eq("id", resolvedContactId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (c && !(c.website && String(c.website).trim())) {
        await supabase
          .from("contacts")
          .update({ website: result.discoveredWebsite })
          .eq("id", resolvedContactId)
          .eq("workspace_id", workspaceId);
      }
    } catch {
      /* best-effort */
    }
  }

  // Record the attempt on the searched record so we can show "searched — none
  // found" everywhere and skip re-searching. Best-effort: if the columns aren't
  // there yet (migration not applied), the update just returns an error we
  // ignore — it must never break the finder.
  if (contactId) {
    const stamp = {
      phone_searched_at: new Date().toISOString(),
      phone_search_outcome: classifyPhoneSearchOutcome(result),
    };
    try {
      await supabase.from("contacts").update(stamp).eq("id", contactId).eq("workspace_id", workspaceId);
    } catch {
      /* tracking is best-effort — never break the finder */
    }
  }

  return { ...result, websiteAdded, companyId: resolvedCompanyId, countryCode };
}

/**
 * Persist the best of a set of found phone numbers into the shared phone pool so
 * the contact becomes callable. Conservative on purpose: only auto-saves numbers
 * we're confident about (scraped from the website, or high-confidence web
 * results), at most the top 2. Skips anything already in the pool.
 *
 * Returns how many numbers were saved.
 */
export async function saveFoundPhones(
  supabase: SupabaseClient,
  args: {
    workspaceId: string;
    contactId?: string | null;
    companyId?: string | null;
    countryCode?: string | null;
    phones: PhoneCandidate[];
  },
): Promise<number> {
  const { workspaceId, contactId, companyId, countryCode } = args;

  const worthSaving = args.phones.filter(
    (p) => p.source === "website" || p.confidence === "high",
  );
  const toSave = (worthSaving.length ? worthSaving : []).slice(0, 2);
  if (!toSave.length) return 0;

  // Owner columns mirror PhoneNumbersPanel: a contact keeps company_id when it
  // has one (shared company pool) plus its own contact_id.
  const ownerCols = { company_id: companyId ?? null, contact_id: contactId ?? null };

  // Existing pool numbers, so we don't insert duplicates or clobber a primary.
  let poolQuery = supabase
    .from("phone_numbers")
    .select("number, is_primary")
    .eq("workspace_id", workspaceId);
  if (companyId) poolQuery = poolQuery.eq("company_id", companyId);
  else if (contactId) poolQuery = poolQuery.is("company_id", null).eq("contact_id", contactId);
  const { data: pool } = await poolQuery;
  const existingNums = new Set((pool ?? []).map((r) => r.number));
  let hasPrimary = (pool ?? []).some((r) => r.is_primary);

  let saved = 0;
  let primaryNumber: string | null = null;
  for (const p of toSave) {
    if (existingNums.has(p.number)) continue;
    const isPrimary = !hasPrimary;
    const { error } = await supabase.from("phone_numbers").insert({
      workspace_id: workspaceId,
      ...ownerCols,
      number: p.number,
      label: p.label,
      country_code: countryCode ?? null,
      is_primary: isPrimary,
      source: p.source,
    });
    if (error) continue;
    saved += 1;
    existingNums.add(p.number);
    if (isPrimary) {
      hasPrimary = true;
      primaryNumber = p.number;
    }
  }

  // Mirror the new primary to the legacy phone columns (dialer / list views).
  if (primaryNumber) {
    if (companyId) {
      await supabase.from("companies").update({ phone: primaryNumber }).eq("id", companyId);
    }
    if (contactId) {
      await supabase.from("contacts").update({ phone: primaryNumber }).eq("id", contactId);
    }
  }

  return saved;
}

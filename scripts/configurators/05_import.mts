#!/usr/bin/env npx tsx
// Phase E — load the configurator directory into a tenant's CRM.
//
// Each entry becomes a `companies` row, a `configurator_prospects` row and N contacts.
// Idempotent on configurator_prospects.external_key and contacts.email.
//
// THE TENANT IS NAMED ON THE COMMAND LINE AND NEVER INFERRED. This script does not read
// `.env.local`; it resolves the target through lib_tenant.mjs, which fetches that one
// project's service key from the Management API and refuses `wrenchlane` outright. This
// list is Animech's, Wrenchlane has the feature flag off, and the cost of getting that
// wrong is 500 companies in the wrong customer's CRM.
//
//   npx tsx scripts/configurators/05_import.mts --tenant animech            # dry run
//   npx tsx scripts/configurators/05_import.mts --tenant animech --commit

import fs from "node:fs";
import path from "node:path";
import { parseNameFromEmail } from "../../src/lib/contacts/parse-name-from-email";
import { prospectRoleFor } from "./lib_prospect_roles.mjs";
import { tenantRest, soleWorkspace } from "./lib_tenant.mjs";

const DATA = path.join(import.meta.dirname, "data");
const COMMIT = process.argv.includes("--commit");
const ti = process.argv.indexOf("--tenant");
const TENANT = ti === -1 ? null : process.argv[ti + 1];
if (!TENANT) {
  console.error("Which tenant? e.g. --tenant animech");
  process.exit(1);
}

const EMAIL_OK = /^[^@\s,;:<>()[\]\\]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
const isEmail = (v: unknown): v is string =>
  typeof v === "string" && EMAIL_OK.test(v.trim()) && !/^https?:/i.test(v.trim());

// A role inbox is a perfectly good contact for a manufacturer, which routes internally,
// but a title scraped near it belongs to whichever human was listed alongside. The orgs
// import learned this when info@transportforetagen.se came through as "branschchef".
const ROLE_INBOX =
  /^(info|kontakt|kontakta|contact|post|mail|email|office|kantoor|buero|b[üu]ro|sales|verkauf|vertrieb|verkoop|ventes|vendite|ventas|myynti|salg|f[oö]rs[aä]ljning|support|service|hello|hallo|bonjour|ciao|enquiries|enquiry|reception|empfang|admin|administration|marketing|press|presse|jobs|karriere|career|hr|webmaster|noreply|no-reply|order|bestellung|shop|webshop|export|import|technik|technical)$/i;

const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

type Prospect = {
  domain: string; name: string | null; website: string; resolved_website: string | null;
  page_title: string | null; description: string | null; country: string | null;
  country_code: string | null; country_source?: string | null; email: string | null;
  phone: string | null; is_vendor: boolean; vendor_kind?: string | null;
  platforms: string[]; platform_source: string | null; vendors: string[];
  configurator_url: string | null; configurator_score: number;
  configurator_candidates: { url: string; text: string | null; score: number }[];
  verified: boolean; blocked: boolean; http_status: string; notes?: string | null;
};
type Vendor = {
  name: string; hq: string; hq_code: string; website: string; kind: string;
  segment: string; verified: boolean; blocked: boolean; http_status: string;
  resolved_website: string | null; page_title: string | null;
};
type Scraped = {
  people: { email: string; name: string | null; title: string | null }[];
  emails: string[]; phones: string[]; reachable: boolean;
};

const prospects: Prospect[] = JSON.parse(
  fs.readFileSync(path.join(DATA, "verified_prospects.json"), "utf8"),
).prospects;
const vendors: Vendor[] = JSON.parse(
  fs.readFileSync(path.join(DATA, "verified_vendors.json"), "utf8"),
).vendors;
const enrichPath = path.join(DATA, "prospect_enrichment.json");
const scraped: Record<string, Scraped> = fs.existsSync(enrichPath)
  ? JSON.parse(fs.readFileSync(enrichPath, "utf8")).results
  : {};

// --- what gets written -------------------------------------------------------------

type Entry = {
  key: string;
  name: string;
  domain: string | null;
  entry_type: "prospect" | "vendor";
  vendor_kind: string | null;
  country: string | null;
  country_code: string | null;
  country_source: string | null;
  industry: string | null;
  website: string;
  resolved_website: string | null;
  page_title: string | null;
  description: string | null;
  email: string | null;
  phone: string | null;
  configurator_url: string | null;
  configurator_score: number;
  configurator_candidates: unknown;
  platforms: string[];
  platform_source: string | null;
  cited_by: string[];
  verified: boolean;
  blocked: boolean;
  http_status: string;
  notes: string | null;
  people: { email: string; name: string | null; title: string | null; role: string | null; priority: number }[];
};

// A company name, best source first. The harvested link text is usually the logo's alt
// attribute and is the most reliable; the page title is a marketing sentence and needs
// its tagline cut off; the domain is the floor.
function nameFor(p: Prospect): string {
  if (p.name && p.name.length >= 2) return p.name;
  const t = (p.page_title ?? "").split(/\s*[|–—\-·:]\s*/)[0]?.trim();
  if (t && t.length >= 2 && t.length <= 60) return t;
  const base = p.domain.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function peopleFor(domain: string) {
  const s = scraped[domain];
  return (s?.people ?? [])
    .filter((p) => isEmail(p.email))
    .map((p) => {
      const local = p.email.split("@")[0];
      const generic = ROLE_INBOX.test(local);
      const r = prospectRoleFor(generic ? null : p.title);
      return {
        email: p.email.toLowerCase(),
        name: generic ? null : p.name,
        title: generic ? null : p.title,
        role: generic ? "General enquiries" : r.role,
        priority: generic ? 9 : r.priority,
      };
    });
}

const entries: Entry[] = [];

for (const p of prospects) {
  // An entry whose website never resolved is not shipped as if it were real.
  if (!p.verified && !p.blocked) continue;
  const isVendor = p.is_vendor;
  entries.push({
    key: `cfg:${slug(p.domain)}`,
    name: nameFor(p),
    domain: p.domain,
    entry_type: isVendor ? "vendor" : "prospect",
    vendor_kind: isVendor ? p.vendor_kind ?? "cpq" : null,
    country: p.country,
    country_code: p.country_code,
    country_source: p.country_source ?? null,
    industry: null,
    website: p.website,
    resolved_website: p.resolved_website,
    page_title: p.page_title,
    description: p.description,
    email: p.email,
    phone: scraped[p.domain]?.phones?.[0] ?? p.phone,
    configurator_url: p.configurator_url,
    configurator_score: p.configurator_score ?? 0,
    configurator_candidates: p.configurator_candidates?.length ? p.configurator_candidates : null,
    platforms: p.platforms ?? [],
    platform_source: p.platform_source,
    cited_by: p.vendors ?? [],
    verified: p.verified,
    blocked: p.blocked,
    http_status: p.http_status,
    notes: p.notes ?? null,
    people: peopleFor(p.domain),
  });
}

// The vendors themselves. Axel asked for "all companies in Europe that sell
// configurators" as well as the companies running them, and these are also the
// competitors -- so they belong on the same page, marked as what they are.
const seenKeys = new Set(entries.map((e) => e.key));
for (const v of vendors) {
  if (!v.verified && !v.blocked) continue;
  let domain: string | null = null;
  try { domain = new URL(v.resolved_website ?? v.website).hostname.replace(/^www\./, ""); } catch { /* leave null */ }
  const key = `cfg:${slug(domain ?? v.name)}`;
  if (seenKeys.has(key)) continue;
  seenKeys.add(key);
  entries.push({
    key,
    name: v.name,
    domain,
    entry_type: "vendor",
    vendor_kind: v.kind,
    country: v.hq,
    country_code: v.hq_code,
    country_source: "vendor headquarters",
    industry: "configurator software",
    website: v.website,
    resolved_website: v.resolved_website,
    page_title: v.page_title,
    description: v.segment,
    email: null,
    phone: null,
    configurator_url: null,
    configurator_score: 0,
    configurator_candidates: null,
    platforms: [],
    platform_source: null,
    cited_by: [],
    verified: v.verified,
    blocked: v.blocked,
    http_status: v.http_status,
    notes: null,
    people: [],
  });
}

// One contact per address across the whole directory: a contact belongs to one company.
const MAX_PER_COMPANY = 8;
const contactOwner = new Map<string, { entry: Entry; email: string; name: string | null; title: string | null; role: string | null; priority: number }>();
for (const e of entries) {
  const ranked = [...e.people].sort((a, b) => a.priority - b.priority || a.email.localeCompare(b.email));
  for (const p of ranked.slice(0, MAX_PER_COMPANY)) {
    const prev = contactOwner.get(p.email);
    if (!prev || p.priority < prev.priority) contactOwner.set(p.email, { entry: e, ...p });
  }
}

// --- report ------------------------------------------------------------------------

const prospectsOut = entries.filter((e) => e.entry_type === "prospect");
const vendorsOut = entries.filter((e) => e.entry_type === "vendor");
const byCountry: Record<string, number> = {};
for (const e of prospectsOut) byCountry[e.country ?? "(unknown)"] = (byCountry[e.country ?? "(unknown)"] ?? 0) + 1;
const byRole: Record<string, number> = {};
for (const c of contactOwner.values()) byRole[c.role ?? "(no title)"] = (byRole[c.role ?? "(no title)"] ?? 0) + 1;

console.log(`Tenant: ${TENANT}`);
console.log(`Plan: ${entries.length} entries (${prospectsOut.length} prospects, ${vendorsOut.length} vendors), ${contactOwner.size} contacts`);
console.log(`  with a configurator URL: ${prospectsOut.filter((e) => e.configurator_url).length}`);
console.log(`  platform confirmed on the configurator itself: ${prospectsOut.filter((e) => e.platform_source === "configurator page").length}`);
console.log(`  cited by 2+ vendors (have switched before): ${prospectsOut.filter((e) => e.cited_by.length > 1).length}`);
console.log(`  countries: ${Object.keys(byCountry).length}`);
console.log("  by country:", Object.fromEntries(Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 18)));
console.log("  contacts by role:", Object.fromEntries(Object.entries(byRole).sort((a, b) => b[1] - a[1])));

if (!COMMIT) { console.log("\nDry run. Re-run with --commit to write."); process.exit(0); }

// --- write -------------------------------------------------------------------------

const t = await tenantRest(TENANT);
const ws = await soleWorkspace(t);
console.log(`\nWriting to ${t.slug} (${t.ref}), workspace ${ws.name} ${ws.id}...`);
const WORKSPACE_ID = ws.id;

const existingEntries = new Map<string, Record<string, unknown>>(
  (await t.selectAll("configurator_prospects", `select=id,external_key,company_id&workspace_id=eq.${WORKSPACE_ID}`))
    .map((r) => [String(r.external_key), r]),
);
const existingContacts = new Map<string, Record<string, unknown>>(
  (await t.selectAll("contacts", `select=id,email&workspace_id=eq.${WORKSPACE_ID}`))
    .map((r) => [String(r.email).toLowerCase(), r]),
);

let cCreated = 0, cUpdated = 0, eUpserted = 0, ctCreated = 0, ctUpdated = 0;

for (const e of entries) {
  const existing = existingEntries.get(e.key);
  const mine = [...contactOwner.values()].filter((c) => c.entry === e);

  // NOTE: `domain` is left NULL on the companies row, exactly as for schools and orgs.
  // Several of these share a registrable domain (a vendor's own brands, group
  // companies), and companies_domain_workspace_unique would collapse them into one row.
  const companyPayload = {
    workspace_id: WORKSPACE_ID,
    name: e.name,
    website: e.resolved_website ?? e.website,
    phone: e.phone,
    country: e.country,
    country_code: e.country_code,
    industry: e.entry_type === "vendor" ? "configurator software" : "manufacturing",
    category: e.entry_type === "vendor" ? "Configurator vendor" : "Runs a configurator",
    description: [e.description, e.platforms.length ? `Platform: ${e.platforms.join(", ")}` : null]
      .filter(Boolean).join(". ").slice(0, 500),
    tags: [
      "configurators",
      e.entry_type,
      ...(e.configurator_url ? ["has-configurator"] : []),
      ...e.platforms.map((p) => `platform:${p}`),
    ],
    source: "configurators",
    lifecycle_stage: "lead",
  };

  let companyId = existing?.company_id as string | undefined;
  if (companyId) {
    await t.rest(`companies?id=eq.${companyId}`, {
      method: "PATCH", body: JSON.stringify(companyPayload), headers: { Prefer: "return=minimal" },
    });
    cUpdated++;
  } else {
    const created = await t.rest("companies", {
      method: "POST", body: JSON.stringify(companyPayload), headers: { Prefer: "return=representation" },
    });
    companyId = created[0].id;
    cCreated++;
  }

  await t.rest("configurator_prospects?on_conflict=workspace_id,external_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      workspace_id: WORKSPACE_ID,
      company_id: companyId,
      external_key: e.key,
      name: e.name,
      domain: e.domain,
      entry_type: e.entry_type,
      vendor_kind: e.vendor_kind,
      country: e.country,
      country_code: e.country_code,
      country_source: e.country_source,
      industry: e.industry,
      website: e.website,
      resolved_website: e.resolved_website,
      page_title: e.page_title,
      description: e.description,
      email: e.email,
      phone: e.phone,
      configurator_url: e.configurator_url,
      configurator_score: e.configurator_score,
      configurator_candidates: e.configurator_candidates,
      platforms: e.platforms,
      platform_source: e.platform_source,
      cited_by: e.cited_by,
      verified: e.verified,
      blocked: e.blocked,
      http_status: e.http_status,
      contact_count: mine.length,
      source: "configurators",
      notes: e.notes,
    }),
  });
  eUpserted++;

  for (const c of mine) {
    const derived = c.name
      ? { firstName: c.name.split(" ")[0], lastName: c.name.split(" ").slice(1).join(" ") }
      : parseNameFromEmail(c.email);
    const payload = {
      workspace_id: WORKSPACE_ID,
      company_id: companyId,
      email: c.email,
      first_name: derived?.firstName ?? null,
      last_name: derived?.lastName ?? null,
      title: c.role ?? c.title ?? null,
      country: e.country,
      country_code: e.country_code,
      tags: ["configurators", e.entry_type, e.country_code].filter(Boolean),
      source: "configurators",
      lead_status: "new",
    };
    const found = existingContacts.get(c.email);
    if (found) {
      await t.rest(`contacts?id=eq.${found.id}`, {
        method: "PATCH", body: JSON.stringify(payload), headers: { Prefer: "return=minimal" },
      });
      ctUpdated++;
    } else {
      await t.rest("contacts", {
        method: "POST", body: JSON.stringify(payload), headers: { Prefer: "return=minimal" },
      });
      ctCreated++;
    }
  }

  if (eUpserted % 50 === 0) console.log(`  ${eUpserted}/${entries.length}`);
}

console.log(`companies: ${cCreated} created, ${cUpdated} updated`);
console.log(`entries:   ${eUpserted} upserted`);
console.log(`contacts:  ${ctCreated} created, ${ctUpdated} updated`);

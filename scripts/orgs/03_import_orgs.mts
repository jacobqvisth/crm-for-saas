#!/usr/bin/env npx tsx
// Phase D — load the industry-organisation directory into the CRM.
//
// Each org becomes a companies row, an industry_orgs row and N contacts.
// Idempotent on industry_orgs.external_key and contacts.email.
//
//   npx tsx scripts/orgs/03_import_orgs.mts            # dry run
//   npx tsx scripts/orgs/03_import_orgs.mts --commit

import fs from "node:fs";
import path from "node:path";
import { parseNameFromEmail } from "../../src/lib/contacts/parse-name-from-email";
import { orgRoleFor } from "./lib_org_roles.mjs";

const DATA = path.join(import.meta.dirname, "data");
const COMMIT = process.argv.includes("--commit");
const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";

function loadEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv(path.resolve(process.cwd(), ".env.local"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE) throw new Error("Missing Supabase env");
const H = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json" };

async function rest(q: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${q}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function selectAll(table: string, query: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = await rest(`${table}?${query}&order=id.asc&limit=1000&offset=${from}`);
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const EMAIL_OK = /^[^@\s,;:<>()[\]\\]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
const isEmail = (v: unknown): v is string =>
  typeof v === "string" && EMAIL_OK.test(v.trim()) && !/^https?:/i.test(v.trim());

// A role inbox is the right contact for an association, which routes internally, but a
// title scraped near it belongs to whichever human was listed alongside. Titles are
// therefore dropped for these: info@transportforetagen.se was coming through as
// "branschchef" and info@svenskafordonsbranschen.se as "jurist".
const ROLE_INBOX = /^(info|kontakt|kontakta|post|mail|office|kansli|sekretariat|admin|administration|enquiries|enquiry|contact|press|presse|redaktionen|redaktion|medlem|member|membership|invoice|faktura|ekonomi|jour|varvning|verwaltung|politik|mpm|saleslocations|firmapost|autig|bgs|mrf|anfia|autosap|sisa|ganvam|nmda|cvd|ambulance|vergaderen)$/i;

const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

type SeedOrg = {
  name: string; acronym: string; country: string; country_code: string;
  org_type: string; sector: string; website: string; umbrellas: string[]; notes: string;
  verified: boolean; blocked?: boolean; http_status: string;
  resolved_website: string | null; page_title: string | null;
};
type Scraped = {
  people: { email: string; name: string | null; title: string | null }[];
  affiliated?: { email: string; name: string | null; title: string | null; domain?: string }[];
  emails: string[]; phones: string[]; reachable: boolean;
};

const orgs: SeedOrg[] = JSON.parse(fs.readFileSync(path.join(DATA, "verified_orgs.json"), "utf8")).orgs;
const scraped: Record<string, Scraped> = JSON.parse(fs.readFileSync(path.join(DATA, "org_enrichment.json"), "utf8")).results;

const ORG_TYPE_LABEL: Record<string, string> = {
  association: "Branschorganisation",
  umbrella: "Europeisk paraplyorganisation",
  trade_fair: "Mässa",
  event_organiser: "Mässarrangör",
  media: "Branschmedia",
};

// One contact per address across the whole directory: a contact belongs to one company.
const contactOwner = new Map<string, { org: SeedOrg; role: string | null; title: string | null; name: string | null; priority: number }>();

const plan = orgs
  // An entry whose website never resolved is not shipped as if it were real.
  .filter((o) => o.verified || o.blocked)
  .map((o) => {
    const s = scraped[o.website];
    const people = (s?.people ?? [])
      .filter((p) => isEmail(p.email))
      .map((p) => {
        const local = p.email.split("@")[0];
        const generic = ROLE_INBOX.test(local);
        const r = orgRoleFor(generic ? null : p.title);
        return {
          email: p.email.toLowerCase(),
          name: generic ? null : p.name,
          title: generic ? null : p.title,
          role: generic ? "Allmän kontaktadress" : r.role,
          priority: generic ? 8 : r.priority,
        };
      });
    return { org: o, scraped: s, people };
  });

const MAX_PER_ORG = 10;
for (const { org, people } of plan) {
  const ranked = [...people].sort((a, b) => a.priority - b.priority || a.email.localeCompare(b.email));
  for (const p of ranked.slice(0, MAX_PER_ORG)) {
    const prev = contactOwner.get(p.email);
    if (!prev || p.priority < prev.priority) contactOwner.set(p.email, { org, ...p });
  }
}

const byType: Record<string, number> = {};
const byCountry: Record<string, number> = {};
for (const { org } of plan) {
  byType[org.org_type] = (byType[org.org_type] ?? 0) + 1;
  byCountry[org.country] = (byCountry[org.country] ?? 0) + 1;
}
const byRole: Record<string, number> = {};
for (const c of contactOwner.values()) byRole[c.role ?? "(ingen titel)"] = (byRole[c.role ?? "(ingen titel)"] ?? 0) + 1;

console.log(`Plan: ${plan.length} organisations, ${contactOwner.size} contacts`);
console.log("  by type:", byType);
console.log(`  countries: ${Object.keys(byCountry).length}`);
console.log("  by role:", byRole);
console.log(`  affiliated (member-company people, stored on the org, not imported as contacts): ${plan.reduce((n, p) => n + (p.scraped?.affiliated?.length ?? 0), 0)}`);

if (!COMMIT) { console.log("\nDry run. Re-run with --commit to write."); process.exit(0); }

console.log("\nWriting...");
const existingOrgs = new Map<string, Record<string, unknown>>(
  (await selectAll("industry_orgs", `select=id,external_key,company_id&workspace_id=eq.${WORKSPACE_ID}`))
    .map((r) => [String(r.external_key), r]),
);
const existingContacts = new Map<string, Record<string, unknown>>(
  (await selectAll("contacts", `select=id,email&workspace_id=eq.${WORKSPACE_ID}`))
    .map((r) => [String(r.email).toLowerCase(), r]),
);

let cCreated = 0, cUpdated = 0, oUpserted = 0, ctCreated = 0, ctUpdated = 0;

for (const { org, scraped: s, people } of plan) {
  const key = `org:${slug(org.country_code + "-" + (org.acronym || org.name))}`;
  const existing = existingOrgs.get(key);
  const mine = [...contactOwner.values()].filter((c) => c.org === org);

  // NOTE: `domain` is left NULL, exactly as for schools. Several of these bodies share
  // a domain (IGA and RMI both sit on rmif.co.uk, Motortec on ifema.es), and
  // companies_domain_workspace_unique would collapse them into one row.
  const companyPayload = {
    workspace_id: WORKSPACE_ID,
    name: org.name,
    website: org.resolved_website ?? org.website,
    phone: s?.phones?.[0] ?? null,
    country: org.country,
    country_code: org.country_code === "EU" ? null : org.country_code,
    industry: "trade association",
    category: ORG_TYPE_LABEL[org.org_type] ?? "Organisation",
    description: [ORG_TYPE_LABEL[org.org_type], org.sector, org.notes].filter(Boolean).join(". ").slice(0, 500),
    tags: ["industry-org", org.org_type, ...(org.umbrellas ?? []).map((u) => `umbrella:${u}`)],
    source: "industry-orgs",
    lifecycle_stage: "lead",
  };

  let companyId = existing?.company_id as string | undefined;
  if (companyId) {
    await rest(`companies?id=eq.${companyId}`, { method: "PATCH", body: JSON.stringify(companyPayload), headers: { Prefer: "return=minimal" } });
    cUpdated++;
  } else {
    const created = await rest("companies", { method: "POST", body: JSON.stringify(companyPayload), headers: { Prefer: "return=representation" } });
    companyId = created[0].id;
    cCreated++;
  }

  await rest("industry_orgs?on_conflict=workspace_id,external_key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      workspace_id: WORKSPACE_ID,
      company_id: companyId,
      external_key: key,
      name: org.name,
      acronym: org.acronym || null,
      country: org.country,
      country_code: org.country_code,
      org_type: org.org_type,
      sector: org.sector || null,
      website: org.website,
      resolved_website: org.resolved_website,
      page_title: org.page_title,
      email: people.find((p) => p.role === "Allmän kontaktadress")?.email ?? people[0]?.email ?? null,
      phone: s?.phones?.[0] ?? null,
      umbrellas: org.umbrellas ?? [],
      verified: !!org.verified,
      blocked: !!org.blocked,
      http_status: org.http_status,
      contact_count: mine.length,
      affiliated_contacts: s?.affiliated?.length ? s.affiliated : null,
      source: "industry-orgs",
      notes: org.notes || null,
    }),
  });
  oUpserted++;

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
      country: org.country,
      country_code: org.country_code === "EU" ? null : org.country_code,
      tags: ["industry-org", org.org_type, org.country_code],
      source: "industry-orgs",
      lead_status: "new",
    };
    const found = existingContacts.get(c.email);
    if (found) {
      await rest(`contacts?id=eq.${found.id}`, { method: "PATCH", body: JSON.stringify(payload), headers: { Prefer: "return=minimal" } });
      ctUpdated++;
    } else {
      await rest("contacts", { method: "POST", body: JSON.stringify(payload), headers: { Prefer: "return=minimal" } });
      ctCreated++;
    }
  }
}

console.log(`companies: ${cCreated} created, ${cUpdated} updated`);
console.log(`orgs:      ${oUpserted} upserted`);
console.log(`contacts:  ${ctCreated} created, ${ctUpdated} updated`);

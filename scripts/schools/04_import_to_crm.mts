#!/usr/bin/env npx tsx
// Phase 5 — load the collected directory into the CRM.
//
// Each school becomes a `companies` row (so it can be owned, sequenced and emailed),
// a `schools` row (education-registry identity) and N `school_programs` rows. Named
// staff become `contacts` attached to the company.
//
// Idempotent: re-running matches on schools.external_key,
// school_programs.education_event_id and contacts.email, and updates in place.
//
//   npx tsx scripts/schools/04_import_to_crm.mts            # dry run, prints a plan
//   npx tsx scripts/schools/04_import_to_crm.mts --commit   # writes

import fs from "node:fs";
import path from "node:path";
import { parseNameFromEmail } from "../../src/lib/contacts/parse-name-from-email";

const DATA = path.join(import.meta.dirname, "data");
const COMMIT = process.argv.includes("--commit");
const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";

// ---------------------------------------------------------------- env + rest client
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

const H = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  "Content-Type": "application/json",
};

async function rest(pathAndQuery: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { ...H, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${pathAndQuery}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// PostgREST caps a response at 1000 rows regardless of the filter, so anything that
// could exceed that has to be paged explicitly with a unique tiebreaker.
async function selectAll(table: string, query: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const rows = await rest(`${table}?${query}&order=id.asc&limit=${size}&offset=${from}`);
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

// ------------------------------------------------------------------------- helpers
const EMAIL_OK = /^[^@\s,;:<>()[\]\\]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i;
// The adult feed puts a support URL in contactInfo.email for Arbetsförmedlingen rows,
// so an address has to be validated, not just trimmed.
const isEmail = (v: unknown): v is string =>
  typeof v === "string" && EMAIL_OK.test(v.trim()) && !/^https?:/i.test(v.trim());

const clean = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length ? s : null;
};

function normWebsite(u: unknown): string | null {
  const s = clean(u);
  if (!s) return null;
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).toString(); } catch { return null; }
}

const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// ------------------------------------------------------------------- role modelling
// Maps a scraped title to a normalised role plus a priority. Priority drives which
// contacts survive the per-school cap: the people who decide on or actually use
// workshop equipment come first, pastoral staff are dropped entirely.
const ROLE_RULES: [RegExp, string, number][] = [
  [/biträdande rektor|bitr\.? ?rektor/i, "Biträdande rektor", 1],
  [/^rektor$|tf rektor|programrektor/i, "Rektor", 1],
  [/programansvarig/i, "Programansvarig", 1],
  [/verkstadschef/i, "Verkstadschef", 1],
  [/utbildningsledare|utbildningschef/i, "Utbildningsledare", 1],
  [/yrkeslärare|karaktärsämneslärare/i, "Yrkeslärare", 2],
  [/instruktör|handledare/i, "Instruktör", 2],
  [/arbetslagsledare/i, "Arbetslagsledare", 3],
  [/verksamhetschef|skolchef|skolledare/i, "Verksamhetschef", 3],
  [/apl-samordnare|praktiksamordnare/i, "APL-samordnare", 3],
  [/^lärare$/i, "Lärare", 4],
  [/studie- och yrkesvägledare|studie och yrkesvägledare|studievägledare|^syv$/i, "Studie- och yrkesvägledare", 5],
  [/skoladministratör|administratör/i, "Skoladministratör", 6],
  [/expedition|reception/i, "Expedition", 6],
];
// Pastoral roles: real staff, but never the buyer or the user of diagnostic kit.
const ROLE_SKIP = /kurator|specialpedagog|^mentor$/i;

// Municipal school sites are hosted inside the kommun's own site, so a crawl of one
// reaches the whole council: kommunstyrelsen@, socialnamnden@, arbetsutskottet@,
// bildningsnamnden@. These are committee inboxes, not people at the school.
const COMMITTEE_MAILBOX =
  /^(.*n[aä]mnd(en)?|kommunstyrelsen?|.*styrelsen|arbetsutskottet?|.*utskottet|registrator|kansli|diarium|.*forvaltning(en)?|.*f[oö]rvaltning(en)?|press|media|jobb|rekrytering|faktura|ekonomi|webmaster|postmaster|noreply|no-reply)$/i;

// Generic inboxes are kept, but only ever as a school's fallback address -- never
// ranked as if they were a named person.
const GENERIC_MAILBOX = /^(info|kontakt|kontakta|post|mail|expedition|reception|skola|admin|it|support|webb)/i;

const registrable = (host: string) => host.replace(/^www\./i, "").split(".").slice(-2).join(".");

function hostOf(u: string | null): string | null {
  if (!u) return null;
  try { return new URL(u).host; } catch { return null; }
}

// Keep a scraped address only if it belongs to the school's own domain. Without this,
// anything linked from the page comes along -- a consultant's hans@affarsradgivarna.se
// was being imported as staff of VFG Jönköping.
function onSchoolDomain(email: string, website: string | null, registryEmail: string | null): boolean {
  const dom = registrable(email.split("@")[1] ?? "");
  if (!dom) return false;
  const allowed = new Set<string>();
  const h = hostOf(website);
  if (h) allowed.add(registrable(h));
  if (registryEmail) allowed.add(registrable(registryEmail.split("@")[1] ?? ""));
  if (allowed.size === 0) return true;
  return allowed.has(dom);
}

function roleFor(title: string | null): { role: string | null; priority: number } | null {
  if (!title) return { role: null, priority: 7 };
  if (ROLE_SKIP.test(title)) return null;
  for (const [re, role, priority] of ROLE_RULES) if (re.test(title)) return { role, priority };
  return { role: null, priority: 7 };
}

// Shared gate for every scraped address, applied before ranking.
function acceptContact(email: string, website: string | null, registryEmail: string | null) {
  const local = email.split("@")[0];
  if (COMMITTEE_MAILBOX.test(local)) return false;
  if (GENERIC_MAILBOX.test(local)) return false;
  return onSchoolDomain(email, website, registryEmail);
}

// ------------------------------------------------------------------------ load data
type GymSchool = {
  school_unit_code: string; name: string; school_types: string[];
  principal_organizer_type: string | null; corporation_name: string | null;
  org_number: string | null; email: string | null; phone: string | null; website: string | null;
  address: string | null; postal_code: string | null; city: string | null;
  municipality: string | null; municipality_code: string | null; county: string | null;
  latitude: number | null; longitude: number | null; relevance_tier: string;
  programs: Record<string, unknown>[];
};
type AdultProgram = Record<string, string | boolean | null>;
type SiteResult = {
  people: { email: string; name: string | null; title: string | null; source_url: string }[];
  orientations: string[];
};

const gym: GymSchool[] = JSON.parse(fs.readFileSync(path.join(DATA, "gymnasium.json"), "utf8")).schools;
const adult: AdultProgram[] = JSON.parse(fs.readFileSync(path.join(DATA, "adult.json"), "utf8")).programs;
const enrich: Record<string, SiteResult> = JSON.parse(fs.readFileSync(path.join(DATA, "enrichment.json"), "utf8")).results;

const SCHOOL_TYPE_BY_FORM: Record<string, string> = {
  Yrkeshögskoleutbildning: "yrkeshogskola",
  "Gymnasial vuxenutbildning": "komvux",
  "Nationell yrkesutbildning": "nationell_yrkesutbildning",
  Folkhögskola: "folkhogskola",
  Högskoleutbildning: "hogskola",
  Arbetsmarknadsutbildning: "arbetsmarknadsutbildning",
  "Test och kartläggning inför AUB": "arbetsmarknadsutbildning",
  "Förberedande utbildning": "forberedande",
};

type PlanSchool = {
  external_key: string; school_unit_code: string | null; name: string; school_type: string;
  relevance_tier: string; principal_organizer_type: string | null; corporation_name: string | null;
  org_number: string | null; website: string | null; email: string | null; phone: string | null;
  address: string | null; postal_code: string | null; city: string | null;
  municipality: string | null; municipality_code: string | null; county: string | null;
  latitude: number | null; longitude: number | null; orientations: string[];
  source: string; notes: string | null;
  programs: Record<string, unknown>[];
  people: { email: string; name: string | null; title: string | null; role: string | null; source_url: string | null; priority: number }[];
};

const plan: PlanSchool[] = [];

// ---- gymnasium ---------------------------------------------------------------
for (const s of gym) {
  const site = enrich[`gy:${s.school_unit_code}`];
  const gyWebsite = normWebsite(s.website);
  const gyRegistryEmail = isEmail(s.email) ? s.email!.toLowerCase() : null;
  const people = (site?.people ?? [])
    .filter((p) => isEmail(p.email) && acceptContact(p.email.toLowerCase(), gyWebsite, gyRegistryEmail))
    .map((p) => {
      const r = roleFor(p.title);
      if (!r) return null;
      const onFordonPage = /fordon/i.test(p.source_url ?? "");
      return {
        email: p.email.toLowerCase(),
        name: p.name,
        title: p.title,
        role: r.role,
        source_url: p.source_url ?? null,
        // Someone listed on the vehicle programme's own page is more likely to be the
        // person who teaches or runs it, whatever their generic title says.
        priority: onFordonPage ? r.priority - 1.5 : r.priority,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  plan.push({
    external_key: `gy:${s.school_unit_code}`,
    school_unit_code: s.school_unit_code,
    name: s.name,
    school_type: s.school_types.includes("gy") ? "gymnasium" : "anpassad_gymnasium",
    relevance_tier: s.relevance_tier,
    principal_organizer_type: s.principal_organizer_type,
    corporation_name: s.corporation_name,
    org_number: s.org_number,
    website: normWebsite(s.website),
    email: isEmail(s.email) ? s.email!.toLowerCase() : null,
    phone: clean(s.phone),
    address: clean(s.address),
    postal_code: clean(s.postal_code),
    city: clean(s.city),
    municipality: clean(s.municipality),
    municipality_code: clean(s.municipality_code),
    county: clean(s.county),
    latitude: s.latitude,
    longitude: s.longitude,
    orientations: site?.orientations ?? [],
    source: "skolverket",
    notes: null,
    programs: s.programs,
    people,
  });
}

// ---- adult providers ---------------------------------------------------------
// Grouped by (provider, municipality) so a national provider's local campuses stay
// distinct. Arbetsförmedlingen is the exception: it is the commissioner of every
// arbetsmarknadsutbildning and the actual delivering contractor is not named in the
// feed, so 147 rows would otherwise become 147 identical "schools". They collapse to
// one national record that carries the programmes and gets no contacts.
const adultGroups = new Map<string, AdultProgram[]>();
for (const p of adult) {
  const provider = String(p.provider_name ?? "Okänd");
  const key = /arbetsförmedlingen/i.test(provider)
    ? "ad:arbetsformedlingen"
    : `ad:${slug(provider)}--${slug(String(p.municipality ?? ""))}`;
  if (!adultGroups.has(key)) adultGroups.set(key, []);
  adultGroups.get(key)!.push(p);
}

for (const [key, rows] of adultGroups) {
  const first = rows[0];
  const isAf = key === "ad:arbetsformedlingen";
  const forms = [...new Set(rows.map((r) => String(r.school_form ?? "")))];
  const tiers = rows.map((r) => String(r.relevance_tier));
  const tier = tiers.includes("core") ? "core" : tiers.includes("adjacent") ? "adjacent" : "transport";

  const site = enrich[`ad:${first.education_event_id}`];
  const adWebsite = normWebsite(first.website);
  const adRegistryEmail = isEmail(first.email) ? String(first.email).toLowerCase() : null;
  const people = isAf ? [] : (site?.people ?? [])
    .filter((p) => isEmail(p.email) && acceptContact(p.email.toLowerCase(), adWebsite, adRegistryEmail))
    .map((p) => {
      const r = roleFor(p.title);
      if (!r) return null;
      return { email: p.email.toLowerCase(), name: p.name, title: p.title, role: r.role, source_url: p.source_url ?? null, priority: r.priority };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  plan.push({
    external_key: key,
    school_unit_code: null,
    name: isAf ? "Arbetsförmedlingen (arbetsmarknadsutbildning)" : String(first.provider_name ?? "Okänd"),
    school_type: SCHOOL_TYPE_BY_FORM[forms[0]] ?? "komvux",
    relevance_tier: tier,
    principal_organizer_type: clean(first.organizer_name)?.match(/\(([^)]+)\)/)?.[1] ?? null,
    corporation_name: clean(first.organizer_name),
    org_number: null,
    website: isAf ? "https://arbetsformedlingen.se" : normWebsite(first.website),
    email: isEmail(first.email) ? String(first.email).toLowerCase() : null,
    phone: clean(first.phone),
    address: clean(first.address),
    postal_code: clean(first.postal_code),
    city: isAf ? null : clean(first.city),
    municipality: isAf ? null : clean(first.municipality),
    municipality_code: isAf ? null : clean(first.municipality_code),
    county: isAf ? null : clean(first.county),
    latitude: null,
    longitude: null,
    orientations: site?.orientations ?? [],
    source: "skolverket-adult",
    notes: isAf
      ? "Arbetsförmedlingen commissions these; the delivering training contractor is not named in Skolverket's feed."
      : null,
    programs: rows as unknown as Record<string, unknown>[],
    people,
  });
}

// ---- contact selection --------------------------------------------------------
// One contact row per address, because a contact belongs to exactly one company.
//
// Which school gets a shared address is not a detail. 154 of the 259 gymnasium units
// sit on a domain shared with another unit (praktiska.se carries 25, yrkesgymnasiet.se
// 16), and every one of those crawls sees the whole chain's staff page. Awarding ties
// to whichever school happened to be processed first made one unit hoard the lot:
// Bergstrands Märsta ended up owning syv.stockholm@ and syv.uppsala@ and 12 contacts,
// while Stockholm and Uppsala got one each.
//
// Claims are therefore ranked, strongest first.
const MAX_CONTACTS_PER_SCHOOL = 12;

// 1. The person was listed on a page under this school's own URL path. On a chain
//    site each campus has its own page (beut.se/gymnasium-uppsala/), so this is a
//    direct statement that they work at THAT unit.
function claimsByPage(school: PlanSchool, sourceUrl: string | null): boolean {
  if (!sourceUrl || !school.website) return false;
  try {
    const own = new URL(school.website);
    const src = new URL(sourceUrl);
    if (own.host !== src.host) return false;
    const ownPath = own.pathname.replace(/\/+$/, "");
    return ownPath.length > 1 && src.pathname.startsWith(ownPath);
  } catch { return false; }
}

// 2. The address itself names the campus (syv.uppsala@beut.se at the Uppsala unit).
function claimsByTown(school: PlanSchool, email: string): boolean {
  const local = email.split("@")[0].toLowerCase();
  for (const hint of [school.municipality, school.city]) {
    if (!hint) continue;
    const h = hint.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (h.length >= 4 && local.normalize("NFD").replace(/[̀-ͯ]/g, "").includes(h)) return true;
  }
  return false;
}

const contactOwner = new Map<string, { school: PlanSchool; p: PlanSchool["people"][number]; claim: number }>();
const ownedCount = new Map<PlanSchool, number>();

for (const s of plan) {
  const ranked = [...s.people].sort((a, b) => a.priority - b.priority || a.email.localeCompare(b.email));
  for (const p of ranked.slice(0, MAX_CONTACTS_PER_SCHOOL)) {
    const claim = claimsByPage(s, p.source_url) ? 0 : claimsByTown(s, p.email) ? 1 : 2;
    const prev = contactOwner.get(p.email);
    if (!prev) { contactOwner.set(p.email, { school: s, p, claim }); continue; }
    if (claim !== prev.claim) {
      if (claim < prev.claim) contactOwner.set(p.email, { school: s, p, claim });
      continue;
    }
    if (p.priority !== prev.p.priority) {
      if (p.priority < prev.p.priority) contactOwner.set(p.email, { school: s, p, claim });
      continue;
    }
    // 3. Equal claim and equal role: give it to whichever unit currently holds
    //    fewer contacts, so a shared staff page spreads across the chain's schools
    //    instead of piling onto the first one processed.
    const mine = ownedCount.get(s) ?? 0;
    const theirs = ownedCount.get(prev.school) ?? 0;
    if (mine < theirs) contactOwner.set(p.email, { school: s, p, claim });
  }
  // Recount after each school so the spread tie-break sees current totals.
  ownedCount.clear();
  for (const o of contactOwner.values()) ownedCount.set(o.school, (ownedCount.get(o.school) ?? 0) + 1);
}
// The registry address itself is a contact when nothing better exists for that school.
for (const s of plan) {
  if (!s.email || contactOwner.has(s.email)) continue;
  const alreadyHasSomeone = s.people.some((p) => contactOwner.get(p.email)?.school === s);
  if (!alreadyHasSomeone) {
    contactOwner.set(s.email, { school: s, p: { email: s.email, name: null, title: null, role: "Skolans kontaktadress", priority: 8 } });
  }
}

// ------------------------------------------------------------------------- summary
const totalPrograms = plan.reduce((n, s) => n + s.programs.length, 0);
console.log(`Plan: ${plan.length} schools, ${totalPrograms} programmes, ${contactOwner.size} contacts`);
const byType: Record<string, number> = {};
for (const s of plan) byType[s.school_type] = (byType[s.school_type] ?? 0) + 1;
console.log("  schools by type:", byType);
const byRole: Record<string, number> = {};
for (const { p } of contactOwner.values()) byRole[p.role ?? "(ingen titel)"] = (byRole[p.role ?? "(ingen titel)"] ?? 0) + 1;
console.log("  contacts by role:", byRole);
console.log(`  contacts with a name: ${[...contactOwner.values()].filter(({ p }) => p.name || parseNameFromEmail(p.email)).length}`);

if (!COMMIT) {
  console.log("\nDry run. Re-run with --commit to write.");
  process.exit(0);
}

// ---------------------------------------------------------------------- write pass
console.log("\nWriting...");

// Existing rows keyed for idempotent re-runs.
const existingSchools = new Map<string, Record<string, unknown>>(
  (await selectAll("schools", `select=id,external_key,company_id&workspace_id=eq.${WORKSPACE_ID}`))
    .map((r) => [String(r.external_key), r]),
);
const existingContacts = new Map<string, Record<string, unknown>>(
  (await selectAll("contacts", `select=id,email,company_id&workspace_id=eq.${WORKSPACE_ID}`))
    .map((r) => [String(r.email).toLowerCase(), r]),
);

let companiesCreated = 0, companiesUpdated = 0, schoolsUpserted = 0, programsUpserted = 0;
let contactsCreated = 0, contactsUpdated = 0;

const SCHOOL_TYPE_LABEL: Record<string, string> = {
  gymnasium: "Gymnasieskola", anpassad_gymnasium: "Anpassad gymnasieskola",
  yrkeshogskola: "Yrkeshögskola", komvux: "Komvux", folkhogskola: "Folkhögskola",
  arbetsmarknadsutbildning: "Arbetsmarknadsutbildning", hogskola: "Högskola",
  nationell_yrkesutbildning: "Nationell yrkesutbildning", forberedande: "Förberedande utbildning",
};

for (const s of plan) {
  const existing = existingSchools.get(s.external_key);
  const tags = ["school", "fordonsutbildning", s.school_type, `tier:${s.relevance_tier}`];

  // NOTE: `domain` is deliberately left null. companies_domain_workspace_unique is a
  // unique index on (workspace_id, domain), and municipal schools share one domain
  // (halmstad.se, uppsala.se), so setting it would collapse every school in a
  // municipality into a single company row. `website` carries the URL instead.
  const companyPayload = {
    workspace_id: WORKSPACE_ID,
    name: s.name,
    website: s.website,
    phone: s.phone,
    address: s.address,
    city: s.city,
    postal_code: s.postal_code,
    country: "Sweden",
    country_code: "SE",
    county: s.county,
    industry: "education",
    category: SCHOOL_TYPE_LABEL[s.school_type] ?? "Skola",
    org_number: s.org_number,
    latitude: s.latitude,
    longitude: s.longitude,
    description: `${SCHOOL_TYPE_LABEL[s.school_type] ?? "Skola"} med fordonsutbildning. ${s.programs.length} program.`,
    tags,
    source: "skolverket",
    lifecycle_stage: "lead",
  };

  let companyId = existing?.company_id as string | undefined;
  if (companyId) {
    await rest(`companies?id=eq.${companyId}`, { method: "PATCH", body: JSON.stringify(companyPayload), headers: { Prefer: "return=minimal" } });
    companiesUpdated++;
  } else {
    const created = await rest("companies", { method: "POST", body: JSON.stringify(companyPayload), headers: { Prefer: "return=representation" } });
    companyId = created[0].id;
    companiesCreated++;
  }

  const schoolPayload = {
    workspace_id: WORKSPACE_ID,
    company_id: companyId,
    external_key: s.external_key,
    school_unit_code: s.school_unit_code,
    name: s.name,
    school_type: s.school_type,
    relevance_tier: s.relevance_tier,
    principal_organizer_type: s.principal_organizer_type,
    corporation_name: s.corporation_name,
    org_number: s.org_number,
    website: s.website,
    email: s.email,
    phone: s.phone,
    address: s.address,
    postal_code: s.postal_code,
    city: s.city,
    municipality: s.municipality,
    municipality_code: s.municipality_code,
    county: s.county,
    latitude: s.latitude,
    longitude: s.longitude,
    orientations: s.orientations,
    program_count: s.programs.length,
    contact_count: [...contactOwner.values()].filter((c) => c.school === s).length,
    source: s.source,
    notes: s.notes,
  };

  const savedSchool = await rest("schools?on_conflict=workspace_id,external_key", {
    method: "POST",
    body: JSON.stringify(schoolPayload),
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
  });
  const schoolId = savedSchool[0].id as string;
  schoolsUpserted++;

  const programRows = s.programs.map((p) => ({
    workspace_id: WORKSPACE_ID,
    school_id: schoolId,
    education_event_id: String(p.education_event_id),
    program_code: (p.program_code as string) ?? null,
    program_name: String(p.program_name),
    program_kind: (p.program_kind as string) ?? "adult",
    relevance_tier: (p.relevance_tier as string) ?? s.relevance_tier,
    relevance_reason: (p.relevance_reason as string) ?? null,
    school_form: (p.school_form_label as string) ?? (p.school_form as string) ?? null,
    orientations: (p.orientations as string[]) ?? [],
    start_date: (p.start_date as string) ?? null,
    credits: (p.credits as string) ?? null,
    credits_system: (p.credits_system as string) ?? null,
    pace_of_study: (p.pace_of_study as string) ?? null,
    distance: typeof p.distance === "boolean" ? p.distance : null,
    admission_points_min: (p.admission_points_min as string) ?? null,
    admission_points_average: (p.admission_points_average as string) ?? null,
    admission_points_semester: (p.admission_points_semester as string) ?? null,
    program_url: (p.website as string) ?? null,
    description: (p.description as string) ?? null,
    source: s.source,
  }));
  if (programRows.length) {
    await rest("school_programs?on_conflict=workspace_id,education_event_id", {
      method: "POST",
      body: JSON.stringify(programRows),
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
    programsUpserted += programRows.length;
  }

  for (const [email, owner] of contactOwner) {
    if (owner.school !== s) continue;
    const derived = owner.p.name
      ? { firstName: owner.p.name.split(" ")[0], lastName: owner.p.name.split(" ").slice(1).join(" ") }
      : parseNameFromEmail(email);
    const payload = {
      workspace_id: WORKSPACE_ID,
      company_id: companyId,
      email,
      first_name: derived?.firstName ?? null,
      last_name: derived?.lastName ?? null,
      title: owner.p.role ?? owner.p.title ?? null,
      city: s.city,
      country: "Sweden",
      country_code: "SE",
      language: "sv",
      tags: ["school", "fordonsutbildning", s.school_type],
      source: "skolverket",
      lead_status: "new",
    };
    const found = existingContacts.get(email);
    if (found) {
      await rest(`contacts?id=eq.${found.id}`, { method: "PATCH", body: JSON.stringify(payload), headers: { Prefer: "return=minimal" } });
      contactsUpdated++;
    } else {
      await rest("contacts", { method: "POST", body: JSON.stringify(payload), headers: { Prefer: "return=minimal" } });
      contactsCreated++;
    }
  }
}

console.log(`companies: ${companiesCreated} created, ${companiesUpdated} updated`);
console.log(`schools:   ${schoolsUpserted} upserted`);
console.log(`programs:  ${programsUpserted} upserted`);
console.log(`contacts:  ${contactsCreated} created, ${contactsUpdated} updated`);

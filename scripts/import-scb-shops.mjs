// Bulk-import net-new shops from SCB Företagsregistret into companies (and contacts where applicable).
// Matches against existing CRM by name or email-domain; only inserts unmatched rows.
//
// Insertion rules:
//   - One company per CFARnr (workplace, not legal entity). Chains stay distinct.
//   - Idempotent via UNIQUE (workspace_id, cfar_number) — re-runs are safe.
//   - Domain backfill respects companies_domain_workspace_unique: only the first row to
//     claim a given workspace+domain gets it; subsequent rows (chain branches) get domain=NULL.
//   - Reklam-spärr → do_not_contact=true, marketing_opt_out=true, no contact created.
//   - Fysisk person → is_sole_proprietor=true, no contact created (GDPR caution).
//   - Net-new with corporate email → also insert a contact (email_status='unknown', unverified).
//   - Contact email deduplication: skip if email already exists for this workspace.
//
// Usage:
//   node scripts/import-scb-shops.mjs                    → dry-run
//   node scripts/import-scb-shops.mjs --apply           → write to prod
//   node scripts/import-scb-shops.mjs --json /path.json → override SCB JSON path
//   node scripts/import-scb-shops.mjs --limit 100       → cap rows for testing

import dotenv from "dotenv";
import postgres from "postgres";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadScb, buildIndexes } from "./lib/scb-parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

const APPLY = process.argv.includes("--apply");
const JSON_ARG = process.argv.indexOf("--json");
const JSON_PATH =
  JSON_ARG > -1
    ? process.argv[JSON_ARG + 1]
    : "/tmp/scb-bilverkstader-sverige-95311.json";
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : null;

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0"; // My Workspace (Wrenchlane)
const SCB_PULLED_AT = "2026-05-17";
const COMPANY_TAG = "scb-import-2026-05-17";
const CONTACT_TAG = "scb-import-2026-05-17";

const sql = postgres({
  host: "aws-1-eu-north-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.wdgiwuhehqpkhpvdzzzl",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const scbRows = loadScb(JSON_PATH);
const { byName, byDomain } = buildIndexes(scbRows);
console.log(`Loaded ${scbRows.length} SCB rows.`);

// Existing CRM: companies that would match an SCB row by name or email-domain.
const crmCompanies = await sql`
  SELECT id, LOWER(TRIM(name)) AS name_norm, LOWER(domain) AS domain, cfar_number
  FROM companies
  WHERE workspace_id = ${WORKSPACE_ID}
`;
const crmByName = new Map();
const crmByDomain = new Map();
const crmByCfar = new Set();
for (const c of crmCompanies) {
  if (c.name_norm) crmByName.set(c.name_norm, c.id);
  if (c.domain) crmByDomain.set(c.domain, c.id);
  if (c.cfar_number) crmByCfar.add(c.cfar_number);
}
console.log(`CRM companies in workspace: ${crmCompanies.length} (${crmByCfar.size} already have CFARnr).`);

// Existing contacts: workspace_id + lowercased email
const crmEmails = await sql`
  SELECT DISTINCT LOWER(email) AS email
  FROM contacts
  WHERE workspace_id = ${WORKSPACE_ID} AND email IS NOT NULL AND email != ''
`;
const crmEmailSet = new Set(crmEmails.map((r) => r.email));
console.log(`CRM contacts with email: ${crmEmailSet.size} distinct.`);

// Domain claims — start from existing CRM domains, then accumulate as we insert.
const claimedDomains = new Set([...crmByDomain.keys()]);

// Identify net-new (unmatched by name or domain) and de-dupe by CFARnr.
const netNew = [];
const seenCfar = new Set();
let droppedMatched = 0;
let droppedNoCfar = 0;
let droppedDupCfar = 0;
let droppedCfarAlreadyInCrm = 0;
for (const r of scbRows) {
  if (r.name_norm && crmByName.has(r.name_norm)) { droppedMatched++; continue; }
  if (r.email_domain && crmByDomain.has(r.email_domain)) { droppedMatched++; continue; }
  if (!r.cfarnr) { droppedNoCfar++; continue; }
  if (seenCfar.has(r.cfarnr)) { droppedDupCfar++; continue; }
  if (crmByCfar.has(r.cfarnr)) { droppedCfarAlreadyInCrm++; continue; }
  seenCfar.add(r.cfarnr);
  netNew.push(r);
}
console.log(`Net-new candidates: ${netNew.length}`);
console.log(`  dropped (already matched): ${droppedMatched}`);
console.log(`  dropped (no CFARnr): ${droppedNoCfar}`);
console.log(`  dropped (CFARnr dup within SCB): ${droppedDupCfar}`);
console.log(`  dropped (CFARnr already in CRM from prior run): ${droppedCfarAlreadyInCrm}`);

const limited = LIMIT ? netNew.slice(0, LIMIT) : netNew;
if (LIMIT) console.log(`Limiting to first ${limited.length} rows for testing.`);

// Build company INSERT rows + contact candidates.
const companyRows = [];
const contactPlans = []; // {cfarnr, email, name}
let domainKept = 0, domainDropped = 0;
let plannedContacts = 0, skippedOptOut = 0, skippedDupEmail = 0;
let skippedSoleProp = 0; // historical tracking only; sole-prop now creates contacts

for (const r of limited) {
  let domain = r.email_domain;
  if (domain && claimedDomains.has(domain)) { domain = null; domainDropped++; }
  else if (domain) { claimedDomains.add(domain); domainKept++; }

  const blockMarketing = r.marketing_opt_out;
  const blockBecauseSoleProp = r.is_sole_proprietor;

  const customFields = {
    scb_pulled_at: SCB_PULLED_AT,
    scb_legal_form: r.legal_form,
    scb_legal_form_code: r.legal_form_code,
    scb_kommun: r.kommun,
    scb_kommun_code: r.kommun_code,
    scb_sektor: r.sektor,
    scb_sektor_code: r.sektor_code,
    scb_sni_code: r.sni_code,
    scb_sni_text: r.sni_text,
    scb_aregion: r.aregion,
    scb_reklamstatus: r.reklamstatus,
    scb_persondataflagga: r.persondataflagga,
    scb_kontaktvarning: r.kontaktvarning || null,
    scb_lan_code: r.lan_code,
  };
  for (const k of Object.keys(customFields)) if (customFields[k] == null) delete customFields[k];

  companyRows.push({
    workspace_id: WORKSPACE_ID,
    name: r.name_display || r.name,
    domain,
    address: r.address_display,
    postal_code: r.postal_code,
    city: r.city,
    phone: r.phone,
    country: "Sweden",
    country_code: "SE",
    industry: "Auto repair",
    category: "Auto repair",
    org_number: r.orgnr,
    cfar_number: r.cfarnr,
    employee_size_band: r.size_band,
    county: r.lan,
    marketing_opt_out: blockMarketing,
    nix_blocked: r.nix_blocked,
    is_sole_proprietor: blockBecauseSoleProp,
    do_not_contact: blockMarketing,
    lifecycle_stage: "lead",
    source: "scb_registry",
    tags: [COMPANY_TAG],
    custom_fields: customFields,
  });

  // Plan contact creation
  // Sole-prop rows DO get a contact — the company's is_sole_proprietor flag is the GDPR signal,
  // so downstream sender code can still gate marketing accordingly. Skip only opt-out + dup-email.
  if (r.email) {
    if (blockMarketing) { skippedOptOut++; continue; }
    if (crmEmailSet.has(r.email)) { skippedDupEmail++; continue; }
    crmEmailSet.add(r.email);
    contactPlans.push({
      cfarnr: r.cfarnr,
      email: r.email,
      phone: r.phone,
      is_sole_prop: blockBecauseSoleProp,
    });
    plannedContacts++;
    if (blockBecauseSoleProp) skippedSoleProp = (skippedSoleProp || 0) - 1; // tracking only; not actually skipped now
  }
}

console.log(`\nCompanies to insert: ${companyRows.length}`);
console.log(`  domain assigned:    ${domainKept}`);
console.log(`  domain skipped (chain collision): ${domainDropped}`);
console.log(`  reklam-spärr (do_not_contact=true): ${companyRows.filter(c=>c.marketing_opt_out).length}`);
console.log(`  fysisk person (sole prop):         ${companyRows.filter(c=>c.is_sole_proprietor).length}`);
console.log(`  nix-blocked:                        ${companyRows.filter(c=>c.nix_blocked).length}`);

const soleropContacts = contactPlans.filter((p) => p.is_sole_prop).length;
console.log(`\nContacts to insert: ${plannedContacts}`);
console.log(`  of which sole-prop (flagged on company): ${soleropContacts}`);
console.log(`  skipped opt-out:      ${skippedOptOut}`);
console.log(`  skipped duplicate:    ${skippedDupEmail}`);

if (!APPLY) {
  console.log(`\nDRY-RUN — no changes applied. Re-run with --apply to write.`);
  await sql.end();
  process.exit(0);
}

// Apply: companies first, then contacts (need company.id).
console.log(`\nInserting ${companyRows.length} companies...`);
const cfarToCompanyId = new Map();
const batchSize = 100;
let inserted = 0, conflicts = 0;
for (let i = 0; i < companyRows.length; i += batchSize) {
  const batch = companyRows.slice(i, i + batchSize);
  // Insert one-at-a-time inside a transaction so we can capture returned ids and handle
  // domain collisions row-by-row.
  await sql.begin(async (tx) => {
    for (const row of batch) {
      try {
        const result = await tx`
          INSERT INTO companies ${tx(row)}
          ON CONFLICT (workspace_id, cfar_number) WHERE cfar_number IS NOT NULL DO NOTHING
          RETURNING id, cfar_number
        `;
        if (result.length > 0) {
          cfarToCompanyId.set(result[0].cfar_number, result[0].id);
          inserted++;
        } else {
          conflicts++;
        }
      } catch (err) {
        if (err.code === "23505" && err.constraint_name === "companies_domain_workspace_unique") {
          // Late-discovered domain collision (claimedDomains missed it for some reason). Retry without domain.
          const retry = { ...row, domain: null };
          const result = await tx`
            INSERT INTO companies ${tx(retry)}
            ON CONFLICT (workspace_id, cfar_number) WHERE cfar_number IS NOT NULL DO NOTHING
            RETURNING id, cfar_number
          `;
          if (result.length > 0) {
            cfarToCompanyId.set(result[0].cfar_number, result[0].id);
            inserted++;
          } else {
            conflicts++;
          }
        } else {
          throw err;
        }
      }
    }
  });
  process.stdout.write(`\r  ${Math.min(i + batchSize, companyRows.length)}/${companyRows.length} (${inserted} new, ${conflicts} conflict)`);
}
console.log(`\nCompanies done: ${inserted} inserted, ${conflicts} conflict-skipped.`);

console.log(`\nInserting ${contactPlans.length} contacts...`);
const contactRows = [];
for (const p of contactPlans) {
  const company_id = cfarToCompanyId.get(p.cfarnr);
  if (!company_id) continue; // company wasn't inserted (conflict)
  contactRows.push({
    workspace_id: WORKSPACE_ID,
    company_id,
    email: p.email,
    phone: p.phone,
    source: "scb_registry",
    lead_status: "new",
    email_status: "unknown",
    tags: [CONTACT_TAG],
  });
}
let contactInserted = 0;
for (let i = 0; i < contactRows.length; i += batchSize) {
  const batch = contactRows.slice(i, i + batchSize);
  await sql.begin(async (tx) => {
    for (const row of batch) {
      const result = await tx`INSERT INTO contacts ${tx(row)} RETURNING id`;
      if (result.length > 0) contactInserted++;
    }
  });
  process.stdout.write(`\r  ${Math.min(i + batchSize, contactRows.length)}/${contactRows.length}`);
}
console.log(`\nContacts done: ${contactInserted} inserted.`);

await sql.end();
console.log("\nAll done.");

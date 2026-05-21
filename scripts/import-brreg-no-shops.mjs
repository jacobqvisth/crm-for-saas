// Bulk-import Norwegian motor-vehicle-repair underenheter from brreg into `companies`
// (and `contacts` where epostadresse is present). Port of import-scb-shops.mjs.
//
// Column-mapping note (semantic):
//   - brreg's `organisasjonsnummer` of the underenhet (workplace) → companies.cfar_number
//     The column name is SE-specific but the role is generic ("workplace registry id").
//     This reuses the existing UNIQUE (workspace_id, cfar_number) partial index.
//   - brreg's `overordnetEnhet` (parent legal entity) → companies.org_number (non-unique;
//     multiple workplaces share the same legal entity).
//
// Insertion rules:
//   - One company per underenhet orgnr.
//   - Idempotent via UNIQUE (workspace_id, cfar_number) — re-runs are safe.
//   - Domain backfill respects companies_domain_workspace_unique: first row to claim a
//     workspace+domain gets it; subsequent rows (chain branches) get domain=NULL.
//   - Out-of-ICP parent orgs (Carglass / Scania / Bertel O. Steen LB / Trucknor /
//     Nordic Last+Buss) are dropped at import.
//   - Net-new with corporate email → also insert a contact (email_status='unknown',
//     unverified — MillionVerifier sweep runs later).
//   - Personal-email rows (gmail/hotmail/online.no/icloud/etc.) get a contact with the
//     personal email + a tag `personal-email` so downstream code can treat them specially.
//   - Contact email deduplication: skip if email already exists for this workspace.
//
// Usage:
//   node scripts/import-brreg-no-shops.mjs                     → dry-run
//   node scripts/import-brreg-no-shops.mjs --apply             → write to prod
//   node scripts/import-brreg-no-shops.mjs --json /path.json   → override brreg JSON path
//   node scripts/import-brreg-no-shops.mjs --limit 100         → cap rows for testing

import dotenv from "dotenv";
import postgres from "postgres";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadBrreg, buildIndexes } from "./lib/brreg-parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// .env.local lives in the main checkout, not in worktrees — look up.
const candidatePaths = [
  join(__dirname, "..", ".env.local"),                                         // main checkout
  join(__dirname, "..", "..", "..", "..", ".env.local"),                       // worktree → repo root
];
let envLoaded = false;
for (const p of candidatePaths) {
  const r = dotenv.config({ path: p });
  if (!r.error) { envLoaded = true; break; }
}
if (!envLoaded) {
  console.error("Could not load .env.local from any candidate path.");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const JSON_ARG = process.argv.indexOf("--json");
const JSON_PATH =
  JSON_ARG > -1
    ? process.argv[JSON_ARG + 1]
    : join(__dirname, "data", "brreg-95310-2026-05-21.json");
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : null;

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0"; // My Workspace (Wrenchlane)
const BRREG_PULLED_AT = "2026-05-21";
const COMPANY_TAG = "brreg-import-2026-05-21";
const CONTACT_TAG = "brreg-import-2026-05-21";

const sql = postgres({
  host: "aws-1-eu-north-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.wdgiwuhehqpkhpvdzzzl",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const brregRows = loadBrreg(JSON_PATH);
console.log(`Loaded ${brregRows.length} brreg rows.`);

// Drop out-of-ICP rows (Carglass + truck dealers — see PARENT_CHAIN_MAP in brreg-parse.mjs)
const oosByReason = new Map();
const inIcp = [];
for (const r of brregRows) {
  if (r.out_of_icp) {
    oosByReason.set(r.exclusion_reason, (oosByReason.get(r.exclusion_reason) || 0) + 1);
  } else {
    inIcp.push(r);
  }
}
console.log(`Dropped ${brregRows.length - inIcp.length} out-of-ICP rows:`);
for (const [reason, n] of oosByReason) console.log(`  ${reason.padEnd(15)} ${n}`);
console.log(`In-ICP rows: ${inIcp.length}`);

// Existing CRM: companies that already exist in this workspace
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
console.log(`CRM companies in workspace: ${crmCompanies.length} (${crmByCfar.size} already have workplace registry id).`);

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

// Identify net-new rows
const netNew = [];
const seenOrg = new Set();
let droppedMatched = 0;
let droppedNoOrg = 0;
let droppedDupOrg = 0;
let droppedOrgAlreadyInCrm = 0;
for (const r of inIcp) {
  if (r.name_norm && crmByName.has(r.name_norm)) { droppedMatched++; continue; }
  if (r.email_domain && crmByDomain.has(r.email_domain)) { droppedMatched++; continue; }
  if (!r.orgnr) { droppedNoOrg++; continue; }
  if (seenOrg.has(r.orgnr)) { droppedDupOrg++; continue; }
  if (crmByCfar.has(r.orgnr)) { droppedOrgAlreadyInCrm++; continue; }
  seenOrg.add(r.orgnr);
  netNew.push(r);
}
console.log(`\nNet-new candidates: ${netNew.length}`);
console.log(`  dropped (already matched by name/domain): ${droppedMatched}`);
console.log(`  dropped (no underenhet orgnr): ${droppedNoOrg}`);
console.log(`  dropped (orgnr dup within brreg): ${droppedDupOrg}`);
console.log(`  dropped (orgnr already in CRM from prior run): ${droppedOrgAlreadyInCrm}`);

const limited = LIMIT ? netNew.slice(0, LIMIT) : netNew;
if (LIMIT) console.log(`Limiting to first ${limited.length} rows for testing.`);

// Build INSERT rows
const companyRows = [];
const contactPlans = [];
let domainKept = 0, domainDropped = 0;
let plannedContacts = 0, skippedNoEmail = 0, skippedDupEmail = 0;
let personalEmailContacts = 0, corporateEmailContacts = 0;

for (const r of limited) {
  let domain = r.email_domain;
  // Personal emails are NOT eligible to claim a workspace domain (they'd collide).
  if (r.is_personal_email) domain = null;
  if (domain && claimedDomains.has(domain)) { domain = null; domainDropped++; }
  else if (domain) { claimedDomains.add(domain); domainKept++; }

  const tags = [COMPANY_TAG];
  if (r.chain) tags.push(`chain-${r.chain}`);

  const customFields = {
    brreg_pulled_at: BRREG_PULLED_AT,
    brreg_parent_orgnr: r.parent_orgnr,
    brreg_naerings_code: r.naerings_code,
    brreg_naerings_text: r.naerings_text,
    brreg_kommune: r.kommune,
    brreg_kommune_code: r.kommune_code,
    brreg_org_form: r.org_form,
    brreg_oppstartsdato: r.operational_start,
    brreg_chain: r.chain,
  };
  for (const k of Object.keys(customFields)) if (customFields[k] == null) delete customFields[k];

  companyRows.push({
    workspace_id: WORKSPACE_ID,
    name: r.name_display || r.name,
    domain,
    website: r.website,
    address: r.address,
    postal_code: r.postal_code,
    city: r.city,
    phone: r.phone,
    country: "Norway",
    country_code: "NO",
    industry: "Auto repair",
    category: "Auto repair",
    cfar_number: r.orgnr,          // brreg underenhet orgnr → workplace registry id
    org_number: r.parent_orgnr,    // brreg overordnetEnhet → legal entity (may be null)
    lifecycle_stage: "lead",
    source: "brreg_registry",
    tags,
    custom_fields: customFields,
  });

  if (!r.email) { skippedNoEmail++; continue; }
  if (crmEmailSet.has(r.email)) { skippedDupEmail++; continue; }
  crmEmailSet.add(r.email);

  const contactTags = [CONTACT_TAG];
  if (r.is_personal_email) contactTags.push("personal-email");
  if (r.chain) contactTags.push(`chain-${r.chain}`);

  contactPlans.push({
    orgnr: r.orgnr,
    email: r.email,
    phone: r.phone,
    is_personal: r.is_personal_email,
    tags: contactTags,
  });
  plannedContacts++;
  if (r.is_personal_email) personalEmailContacts++;
  else corporateEmailContacts++;
}

console.log(`\nCompanies to insert: ${companyRows.length}`);
console.log(`  domain assigned:    ${domainKept}`);
console.log(`  domain skipped (chain collision OR personal): ${domainDropped + (companyRows.length - domainKept - domainDropped)}`);

// Chain breakdown
const chainBreakdown = new Map();
for (const row of companyRows) {
  for (const t of row.tags) if (t.startsWith("chain-")) chainBreakdown.set(t, (chainBreakdown.get(t) || 0) + 1);
}
if (chainBreakdown.size > 0) {
  console.log("\nChain breakdown:");
  for (const [t, n] of [...chainBreakdown.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${t.padEnd(25)} ${n}`);
}

console.log(`\nContacts to insert: ${plannedContacts}`);
console.log(`  corporate email: ${corporateEmailContacts}`);
console.log(`  personal email:  ${personalEmailContacts}`);
console.log(`  skipped (no email):    ${skippedNoEmail}`);
console.log(`  skipped (dup email):   ${skippedDupEmail}`);

if (!APPLY) {
  console.log(`\nDRY-RUN — no changes applied. Re-run with --apply to write.`);
  await sql.end();
  process.exit(0);
}

// Apply: companies first, then contacts.
console.log(`\nInserting ${companyRows.length} companies...`);
const orgToCompanyId = new Map();
const batchSize = 100;
let inserted = 0, conflicts = 0;
for (let i = 0; i < companyRows.length; i += batchSize) {
  const batch = companyRows.slice(i, i + batchSize);
  await sql.begin(async (tx) => {
    for (const row of batch) {
      try {
        const result = await tx`
          INSERT INTO companies ${tx(row)}
          ON CONFLICT (workspace_id, cfar_number) WHERE cfar_number IS NOT NULL DO NOTHING
          RETURNING id, cfar_number
        `;
        if (result.length > 0) {
          orgToCompanyId.set(result[0].cfar_number, result[0].id);
          inserted++;
        } else {
          conflicts++;
        }
      } catch (err) {
        if (err.code === "23505" && err.constraint_name === "companies_domain_workspace_unique") {
          const retry = { ...row, domain: null };
          const result = await tx`
            INSERT INTO companies ${tx(retry)}
            ON CONFLICT (workspace_id, cfar_number) WHERE cfar_number IS NOT NULL DO NOTHING
            RETURNING id, cfar_number
          `;
          if (result.length > 0) {
            orgToCompanyId.set(result[0].cfar_number, result[0].id);
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
  const company_id = orgToCompanyId.get(p.orgnr);
  if (!company_id) continue;
  contactRows.push({
    workspace_id: WORKSPACE_ID,
    company_id,
    email: p.email,
    phone: p.phone,
    source: "brreg_registry",
    lead_status: "new",
    email_status: "unknown",
    tags: p.tags,
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

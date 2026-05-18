// Follow-up to scripts/import-scb-shops.mjs.
// Adds contact rows for sole-prop (fysisk person) companies that have an email.
// The original run skipped these for GDPR caution; the decision was reversed —
// we want the contact, with the company's is_sole_proprietor flag carrying the GDPR signal.
//
// Usage:
//   node scripts/backfill-scb-sole-prop-contacts.mjs            → dry-run
//   node scripts/backfill-scb-sole-prop-contacts.mjs --apply    → write to prod
//   node scripts/backfill-scb-sole-prop-contacts.mjs --json /path.json
//   node scripts/backfill-scb-sole-prop-contacts.mjs --limit N

import dotenv from "dotenv";
import postgres from "postgres";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadScb } from "./lib/scb-parse.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env.local") });

const APPLY = process.argv.includes("--apply");
const JSON_ARG = process.argv.indexOf("--json");
const JSON_PATH = JSON_ARG > -1
  ? process.argv[JSON_ARG + 1]
  : "/tmp/scb-bilverkstader-sverige-95311.json";
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : null;

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";
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
console.log(`Loaded ${scbRows.length} SCB rows.`);

// SCB candidates: sole-prop + email + not opted out.
const candidates = scbRows.filter((r) =>
  r.is_sole_proprietor && r.email && !r.marketing_opt_out && r.cfarnr
);
console.log(`SCB sole-prop candidates with email: ${candidates.length}`);

// Look up CRM companies by cfar_number that we already imported (tagged).
const cfarList = candidates.map((r) => r.cfarnr);
const companies = await sql`
  SELECT id, cfar_number, is_sole_proprietor
  FROM companies
  WHERE workspace_id = ${WORKSPACE_ID}
    AND cfar_number IS NOT NULL
    AND cfar_number = ANY(${cfarList})
`;
const cfarToCompany = new Map(companies.map((c) => [c.cfar_number, c]));
console.log(`Matched ${cfarToCompany.size} CRM companies by CFARnr.`);

// Existing contacts: skip if email already in workspace OR if company already has a scb contact.
const existingEmails = await sql`
  SELECT DISTINCT LOWER(email) AS email FROM contacts
  WHERE workspace_id = ${WORKSPACE_ID} AND email IS NOT NULL
`;
const emailSet = new Set(existingEmails.map((r) => r.email));
console.log(`Existing contact emails in workspace: ${emailSet.size}`);

const existingScbContacts = await sql`
  SELECT DISTINCT company_id FROM contacts
  WHERE workspace_id = ${WORKSPACE_ID} AND source='scb_registry'
`;
const companiesWithContact = new Set(existingScbContacts.map((r) => r.company_id));
console.log(`Companies already linked to an scb_registry contact: ${companiesWithContact.size}`);

const toInsert = [];
let skipNoCompany = 0, skipNotSoleProp = 0, skipDupEmail = 0, skipHasContact = 0;
const seenEmails = new Set();

for (const r of candidates) {
  const company = cfarToCompany.get(r.cfarnr);
  if (!company) { skipNoCompany++; continue; }
  if (!company.is_sole_proprietor) { skipNotSoleProp++; continue; }
  if (companiesWithContact.has(company.id)) { skipHasContact++; continue; }
  if (emailSet.has(r.email) || seenEmails.has(r.email)) { skipDupEmail++; continue; }
  seenEmails.add(r.email);
  toInsert.push({
    workspace_id: WORKSPACE_ID,
    company_id: company.id,
    email: r.email,
    phone: r.phone,
    source: "scb_registry",
    lead_status: "new",
    email_status: "unknown",
    tags: [CONTACT_TAG],
  });
}

console.log(`\nContacts to insert: ${toInsert.length}`);
console.log(`  skipped (company not in CRM): ${skipNoCompany}`);
console.log(`  skipped (company not sole-prop): ${skipNotSoleProp}`);
console.log(`  skipped (company already has scb contact): ${skipHasContact}`);
console.log(`  skipped (email duplicate): ${skipDupEmail}`);

const limited = LIMIT ? toInsert.slice(0, LIMIT) : toInsert;

if (!APPLY) {
  console.log(`\nDRY-RUN — no changes applied. Re-run with --apply to write.`);
  await sql.end();
  process.exit(0);
}

console.log(`\nInserting ${limited.length} contacts...`);
let inserted = 0;
const batchSize = 100;
for (let i = 0; i < limited.length; i += batchSize) {
  const batch = limited.slice(i, i + batchSize);
  await sql.begin(async (tx) => {
    for (const row of batch) {
      const r = await tx`INSERT INTO contacts ${tx(row)} RETURNING id`;
      if (r.length > 0) inserted++;
    }
  });
  process.stdout.write(`\r  ${Math.min(i + batchSize, limited.length)}/${limited.length}`);
}
console.log(`\nDone. ${inserted} contacts inserted.`);
await sql.end();

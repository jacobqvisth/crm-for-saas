// Enrich existing CRM companies with SCB Företagsregistret data.
// Matches on (a) lowercased name OR (b) email-domain.
// Always sets registry fields (org_number, cfar_number, size_band, county, compliance flags).
// Backfills domain/address/postal_code/phone only when CRM is currently null.
// Never overwrites an existing non-null value on those four soft fields.
//
// Usage:
//   node scripts/enrich-from-scb.mjs                    → dry-run (default)
//   node scripts/enrich-from-scb.mjs --apply           → write to prod
//   node scripts/enrich-from-scb.mjs --json /path.json → override SCB JSON path

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

const SCB_PULLED_AT = "2026-05-17";
const TAG = "scb-enriched-2026-05-17";

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
const { byName, byDomain, byCfar } = buildIndexes(scbRows);
console.log(`Loaded ${scbRows.length} SCB rows (${byCfar.size} distinct CFAR, ${byName.size} distinct name, ${byDomain.size} distinct domain).`);

const crm = await sql`
  SELECT id, workspace_id, name, LOWER(TRIM(name)) AS name_norm,
         LOWER(domain) AS domain, domain AS domain_raw,
         address, postal_code, phone, city, country,
         tags, custom_fields, org_number, cfar_number,
         marketing_opt_out, nix_blocked, is_sole_proprietor,
         employee_size_band, county
  FROM companies
  WHERE country ILIKE '%swe%' OR country_code='SE'
     OR country='Sweden' OR country='Sverige' OR country IS NULL
`;
console.log(`Loaded ${crm.length} CRM matching pool companies.`);

// Workspace-wide domain map so we don't try to backfill a domain another company already owns.
const allDomains = await sql`
  SELECT workspace_id, LOWER(domain) AS domain
  FROM companies
  WHERE domain IS NOT NULL AND domain != ''
`;
const takenDomain = new Set();
for (const r of allDomains) takenDomain.add(`${r.workspace_id}::${r.domain}`);

let matched = 0;
let updates = [];
let stats = {
  by_name: 0,
  by_domain: 0,
  fields_set: { org_number: 0, cfar_number: 0, employee_size_band: 0, county: 0, marketing_opt_out: 0, nix_blocked: 0, is_sole_proprietor: 0, domain: 0, address: 0, postal_code: 0, phone: 0 },
  already_had_orgnr: 0,
  cfar_collision: 0,
};

const usedCfar = new Set();

for (const c of crm) {
  let scb = null;
  if (c.name_norm && byName.has(c.name_norm)) {
    scb = byName.get(c.name_norm);
    stats.by_name++;
  } else if (c.domain && byDomain.has(c.domain)) {
    scb = byDomain.get(c.domain);
    stats.by_domain++;
  }
  if (!scb) continue;
  matched++;

  // CFAR collision: same CFAR can't be used by two CRM rows. Keep the first match,
  // record the rest as "matched by name/domain but CFAR taken — orgnr-only enrichment".
  const cfarKey = `${c.workspace_id}::${scb.cfarnr}`;
  let assignCfar = !!scb.cfarnr;
  if (assignCfar && usedCfar.has(cfarKey)) {
    assignCfar = false;
    stats.cfar_collision++;
  }
  if (assignCfar) usedCfar.add(cfarKey);

  const updateRow = { id: c.id };
  const cfNew = { ...(c.custom_fields || {}) };
  let hasChange = false;

  // Registry fields — always set (these are the new value)
  if (scb.orgnr && c.org_number !== scb.orgnr) {
    updateRow.org_number = scb.orgnr;
    stats.fields_set.org_number++;
    if (c.org_number) stats.already_had_orgnr++;
    hasChange = true;
  }
  if (assignCfar && scb.cfarnr && c.cfar_number !== scb.cfarnr) {
    updateRow.cfar_number = scb.cfarnr;
    stats.fields_set.cfar_number++;
    hasChange = true;
  }
  if (scb.size_band && c.employee_size_band !== scb.size_band) {
    updateRow.employee_size_band = scb.size_band;
    stats.fields_set.employee_size_band++;
    hasChange = true;
  }
  if (scb.lan && c.county !== scb.lan) {
    updateRow.county = scb.lan;
    stats.fields_set.county++;
    hasChange = true;
  }
  if (scb.marketing_opt_out && !c.marketing_opt_out) {
    updateRow.marketing_opt_out = true;
    stats.fields_set.marketing_opt_out++;
    hasChange = true;
  }
  if (scb.nix_blocked && !c.nix_blocked) {
    updateRow.nix_blocked = true;
    stats.fields_set.nix_blocked++;
    hasChange = true;
  }
  if (scb.is_sole_proprietor && !c.is_sole_proprietor) {
    updateRow.is_sole_proprietor = true;
    stats.fields_set.is_sole_proprietor++;
    hasChange = true;
  }

  // Soft backfills — only when CRM null
  if (!c.domain_raw && scb.email_domain) {
    const key = `${c.workspace_id}::${scb.email_domain}`;
    if (!takenDomain.has(key)) {
      updateRow.domain = scb.email_domain;
      takenDomain.add(key);
      stats.fields_set.domain++;
      hasChange = true;
    } else {
      stats.domain_collision = (stats.domain_collision || 0) + 1;
    }
  }
  if (!c.address && scb.address_display) {
    updateRow.address = scb.address_display;
    stats.fields_set.address++;
    hasChange = true;
  }
  if (!c.postal_code && scb.postal_code) {
    updateRow.postal_code = scb.postal_code;
    stats.fields_set.postal_code++;
    hasChange = true;
  }
  if (!c.phone && scb.phone) {
    updateRow.phone = scb.phone;
    stats.fields_set.phone++;
    hasChange = true;
  }

  // custom_fields stamps
  cfNew.scb_pulled_at = SCB_PULLED_AT;
  if (scb.legal_form) cfNew.scb_legal_form = scb.legal_form;
  if (scb.kommun) cfNew.scb_kommun = scb.kommun;
  if (scb.sektor) cfNew.scb_sektor = scb.sektor;
  if (scb.sni_code) cfNew.scb_sni_code = scb.sni_code;
  if (scb.aregion) cfNew.scb_aregion = scb.aregion;
  if (scb.reklamstatus) cfNew.scb_reklamstatus = scb.reklamstatus;
  if (scb.persondataflagga) cfNew.scb_persondataflagga = scb.persondataflagga;
  updateRow.custom_fields = cfNew;
  hasChange = true; // always stamp the pull date

  // Tag
  const tags = Array.isArray(c.tags) ? [...c.tags] : [];
  if (!tags.includes(TAG)) {
    tags.push(TAG);
    updateRow.tags = tags;
  }

  if (hasChange) updates.push(updateRow);
}

console.log(`\nMatched: ${matched} / ${crm.length} CRM companies`);
console.log(`  by name:   ${stats.by_name}`);
console.log(`  by domain: ${stats.by_domain}`);
console.log(`Updates queued: ${updates.length}`);
console.log(`Field-set counts:`);
for (const [k, v] of Object.entries(stats.fields_set)) {
  if (v > 0) console.log(`  ${k}: ${v}`);
}
if (stats.already_had_orgnr) console.log(`  (${stats.already_had_orgnr} rows already had org_number — overwritten where SCB differed)`);
if (stats.cfar_collision) console.log(`  (${stats.cfar_collision} rows had CFAR taken by another match — orgnr enriched, cfar skipped)`);

if (!APPLY) {
  console.log(`\nDRY-RUN — no changes applied. Re-run with --apply to write.`);
  await sql.end();
  process.exit(0);
}

console.log(`\nApplying ${updates.length} updates...`);
let applied = 0;
const batchSize = 100;
for (let i = 0; i < updates.length; i += batchSize) {
  const batch = updates.slice(i, i + batchSize);
  await sql.begin(async (tx) => {
    for (const u of batch) {
      const { id, ...rest } = u;
      await tx`UPDATE companies SET ${tx(rest)}, updated_at = now() WHERE id = ${id}`;
    }
  });
  applied += batch.length;
  process.stdout.write(`\r  ${applied}/${updates.length}`);
}
console.log(`\nDone. ${applied} rows updated.`);
await sql.end();

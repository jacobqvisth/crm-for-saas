// Generic chain-sitemap importer for Norway. Reads scripts/data/no-chains-*.json
// (one file per chain, produced by scrape-{chain}-no.mjs) and upserts into companies.
//
// Match strategy (priority):
//   1. Phone match (E.164 normalized) — high confidence
//   2. (street + postal_code) match — fallback
//   3. (name + city) match — final fallback
//   4. No match → INSERT new company with source='chain_sitemap'
//
// On match: UPDATE existing row with branch email (if missing), website (if missing),
// and add chain-{name} tag. Never overwrite existing non-null contact fields — the
// brreg/registry data is more authoritative for address/phone; chain-sitemap supplies
// email + chain-tag.
//
// Insert path: same chain-domain-NULL retry pattern as brreg importer.
//
// Usage:
//   node scripts/import-no-chains.mjs                                → dry-run all files
//   node scripts/import-no-chains.mjs --chain mekonomen              → just one file
//   node scripts/import-no-chains.mjs --apply                        → write
//   node scripts/import-no-chains.mjs --limit 50                     → cap for testing

import dotenv from "dotenv";
import postgres from "postgres";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const candidatePaths = [
  join(__dirname, "..", ".env.local"),
  join(__dirname, "..", "..", "..", "..", ".env.local"),
];
let envLoaded = false;
for (const p of candidatePaths) {
  const r = dotenv.config({ path: p });
  if (!r.error) { envLoaded = true; break; }
}
if (!envLoaded) { console.error("No .env.local"); process.exit(1); }

const APPLY = process.argv.includes("--apply");
const CHAIN_ARG = process.argv.indexOf("--chain");
const CHAIN_FILTER = CHAIN_ARG > -1 ? process.argv[CHAIN_ARG + 1] : null;
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : null;

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";
const SOURCE_TAG = "chain-sitemap-2026-05-21";

const sql = postgres({
  host: "aws-1-eu-north-1.pooler.supabase.com", port: 5432,
  user: "postgres.wdgiwuhehqpkhpvdzzzl",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false }, max: 1,
});

const DATA_DIR = join(__dirname, "data");
const files = readdirSync(DATA_DIR)
  .filter((f) => /^no-chains-.+\.json$/.test(f))
  .filter((f) => !CHAIN_FILTER || f.includes(CHAIN_FILTER));

if (files.length === 0) {
  console.error(`No chain files found in ${DATA_DIR}`);
  process.exit(1);
}
console.log(`Chain files: ${files.join(", ")}`);

const normalizePhone = (raw) => {
  if (!raw) return null;
  const d = raw.replace(/[^\d]/g, "");
  if (d.length === 8) return `+47${d}`;
  if (d.length === 10 && d.startsWith("47")) return `+${d}`;
  if (d.startsWith("47") && d.length >= 10) return `+${d}`;
  return raw;
};
const norm = (s) => (s || "").trim().toLowerCase();
const extractDomain = (email) => email ? (email.match(/@(.+)$/)?.[1] || null) : null;

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "hotmail.no",
  "live.no", "live.com", "outlook.com", "yahoo.no", "yahoo.com",
  "icloud.com", "me.com", "online.no", "frisurf.no", "c2i.net",
  "start.no", "broadpark.no",
]);

// Load existing NO companies (workspace-scoped) for matching
console.log(`\nLoading existing NO companies from CRM...`);
const existing = await sql`
  SELECT id, name, LOWER(TRIM(name)) AS name_norm, phone, postal_code, city,
         address, domain, cfar_number, tags, custom_fields
  FROM companies
  WHERE workspace_id = ${WORKSPACE_ID} AND country_code = 'NO'
`;
console.log(`  ${existing.length} NO companies loaded.`);

// Build lookup maps
const byPhone = new Map();
const byAddrPostal = new Map();
const byNameCity = new Map();
for (const c of existing) {
  if (c.phone) byPhone.set(normalizePhone(c.phone), c);
  if (c.address && c.postal_code) {
    byAddrPostal.set(`${norm(c.address)}|${c.postal_code}`, c);
  }
  if (c.name_norm && c.city) {
    byNameCity.set(`${c.name_norm}|${norm(c.city)}`, c);
  }
}

const claimedDomains = new Set();
const existingDomains = await sql`
  SELECT DISTINCT LOWER(domain) AS domain FROM companies
  WHERE workspace_id = ${WORKSPACE_ID} AND domain IS NOT NULL
`;
for (const r of existingDomains) claimedDomains.add(r.domain);
console.log(`  ${claimedDomains.size} domains already claimed in workspace.`);

// Existing emails (for contact-dedup)
const existingEmails = await sql`
  SELECT DISTINCT LOWER(email) AS email FROM contacts
  WHERE workspace_id = ${WORKSPACE_ID} AND email IS NOT NULL AND email != ''
`;
const emailSet = new Set(existingEmails.map((r) => r.email));

// Plan + apply per file
const stats = {
  scanned: 0, matchedPhone: 0, matchedAddr: 0, matchedNameCity: 0, unmatched: 0,
  updatedEmail: 0, updatedWebsite: 0, taggedOnly: 0,
  insertedCompany: 0, insertedContact: 0, skippedDupEmail: 0,
  errors: 0,
};

for (const file of files) {
  const chain = file.match(/no-chains-(.+)\.json/)[1];
  const chainTag = `chain-${chain}`;
  console.log(`\n=== ${file} ===`);
  const rows = JSON.parse(readFileSync(join(DATA_DIR, file), "utf8"));
  console.log(`  ${rows.length} branches`);
  const sliced = LIMIT ? rows.slice(0, LIMIT) : rows;

  for (const r of sliced) {
    stats.scanned++;
    const phone = normalizePhone(r.phone);
    const addrKey = r.address && r.postal_code ? `${norm(r.address)}|${r.postal_code}` : null;
    const nameCityKey = r.name && r.city ? `${norm(r.name)}|${norm(r.city)}` : null;

    let match = null;
    if (phone && byPhone.has(phone)) { match = byPhone.get(phone); stats.matchedPhone++; }
    else if (addrKey && byAddrPostal.has(addrKey)) { match = byAddrPostal.get(addrKey); stats.matchedAddr++; }
    else if (nameCityKey && byNameCity.has(nameCityKey)) { match = byNameCity.get(nameCityKey); stats.matchedNameCity++; }
    else { stats.unmatched++; }

    const email = r.email || null;
    const emailDomain = extractDomain(email);
    const isPersonal = emailDomain ? PERSONAL_DOMAINS.has(emailDomain) : false;

    if (match) {
      // UPDATE existing row (add tag; optionally backfill website)
      const existingTags = match.tags || [];
      const newTags = existingTags.includes(chainTag) ? existingTags : [...existingTags, chainTag];
      const wantWebsite = r.website && !match.domain;
      const wantTag = !existingTags.includes(chainTag);

      if (wantWebsite || wantTag) {
        if (APPLY) {
          try {
            const update = { tags: newTags };
            if (wantWebsite) update.website = r.website;
            await sql`UPDATE companies SET ${sql(update)}, updated_at = NOW() WHERE id = ${match.id}`;
          } catch (err) {
            console.error(`  UPDATE failed for ${match.id}:`, err.message);
            stats.errors++;
            continue;
          }
        }
        if (wantWebsite) stats.updatedWebsite++;
        else stats.taggedOnly++;
      }

      // Create contact with branch email if we don't already have it
      if (email && !emailSet.has(email)) {
        emailSet.add(email);
        if (APPLY) {
          try {
            const contactTags = [SOURCE_TAG, chainTag];
            if (isPersonal) contactTags.push("personal-email");
            await sql`INSERT INTO contacts ${sql({
              workspace_id: WORKSPACE_ID,
              company_id: match.id,
              email,
              phone: r.phone,
              source: "chain_sitemap",
              lead_status: "new",
              email_status: "unknown",
              tags: contactTags,
            })}`;
          } catch (err) {
            console.error(`  contact INSERT failed:`, err.message);
            stats.errors++;
            continue;
          }
        }
        stats.insertedContact++;
        stats.updatedEmail++;
      } else if (email) {
        stats.skippedDupEmail++;
      }
    } else {
      // INSERT new company
      let domain = emailDomain;
      if (isPersonal) domain = null;
      if (domain && claimedDomains.has(domain)) domain = null;
      else if (domain) claimedDomains.add(domain);

      const tags = [SOURCE_TAG, chainTag];
      const customFields = {
        chain_sitemap_source: r.source_url,
        chain_brand: r.chain,
        chain_scraped_at: r.scraped_at,
      };

      if (APPLY) {
        try {
          const inserted = await sql`
            INSERT INTO companies ${sql({
              workspace_id: WORKSPACE_ID,
              name: r.name,
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
              lifecycle_stage: "lead",
              source: "chain_sitemap",
              tags,
              custom_fields: customFields,
            })}
            RETURNING id
          `;
          const newId = inserted[0].id;
          stats.insertedCompany++;

          if (email && !emailSet.has(email)) {
            emailSet.add(email);
            const contactTags = [SOURCE_TAG, chainTag];
            if (isPersonal) contactTags.push("personal-email");
            await sql`INSERT INTO contacts ${sql({
              workspace_id: WORKSPACE_ID,
              company_id: newId,
              email,
              phone: r.phone,
              source: "chain_sitemap",
              lead_status: "new",
              email_status: "unknown",
              tags: contactTags,
            })}`;
            stats.insertedContact++;
          }
        } catch (err) {
          if (err.code === "23505" && err.constraint_name === "companies_domain_workspace_unique") {
            // Retry without domain
            try {
              const inserted = await sql`
                INSERT INTO companies ${sql({
                  workspace_id: WORKSPACE_ID,
                  name: r.name,
                  domain: null,
                  website: r.website,
                  address: r.address,
                  postal_code: r.postal_code,
                  city: r.city,
                  phone: r.phone,
                  country: "Norway",
                  country_code: "NO",
                  industry: "Auto repair",
                  category: "Auto repair",
                  lifecycle_stage: "lead",
                  source: "chain_sitemap",
                  tags,
                  custom_fields: customFields,
                })}
                RETURNING id
              `;
              stats.insertedCompany++;
              const newId = inserted[0].id;
              if (email && !emailSet.has(email)) {
                emailSet.add(email);
                const contactTags = [SOURCE_TAG, chainTag];
                if (isPersonal) contactTags.push("personal-email");
                await sql`INSERT INTO contacts ${sql({
                  workspace_id: WORKSPACE_ID, company_id: newId, email, phone: r.phone,
                  source: "chain_sitemap", lead_status: "new", email_status: "unknown",
                  tags: contactTags,
                })}`;
                stats.insertedContact++;
              }
            } catch (err2) {
              console.error(`  retry-INSERT failed:`, err2.message);
              stats.errors++;
            }
          } else {
            console.error(`  INSERT failed:`, err.message);
            stats.errors++;
          }
        }
      } else {
        stats.insertedCompany++;
        if (email) stats.insertedContact++;
      }
    }
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`  scanned:           ${stats.scanned}`);
console.log(`  matched (phone):   ${stats.matchedPhone}`);
console.log(`  matched (addr):    ${stats.matchedAddr}`);
console.log(`  matched (name+city): ${stats.matchedNameCity}`);
console.log(`  unmatched (will INSERT): ${stats.unmatched}`);
console.log(`  ---`);
console.log(`  companies INSERTED: ${stats.insertedCompany}`);
console.log(`  contacts INSERTED:  ${stats.insertedContact}`);
console.log(`  matched-row tagged: ${stats.taggedOnly}`);
console.log(`  matched-row updated with website: ${stats.updatedWebsite}`);
console.log(`  emails updated:     ${stats.updatedEmail}`);
console.log(`  skipped dup-email:  ${stats.skippedDupEmail}`);
console.log(`  errors:             ${stats.errors}`);

if (!APPLY) console.log(`\nDRY-RUN — no changes applied. Re-run with --apply.`);

await sql.end();

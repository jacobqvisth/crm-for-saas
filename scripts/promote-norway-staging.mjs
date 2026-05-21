// Bulk-promote ICP-matching NO discovered_shops rows into companies (and contacts
// where primary_email exists). Unlike backfill-promote-icp-by-shop-type.mjs, this
// does NOT gate on email_status — per Jacob 2026-05-21, NO rows are imported even
// without a verified mailbox (later filled by pattern-MV + MV sweep).
//
// Match priority for "already in CRM":
//   1. Normalized phone (last 8 digits)
//   2. name+postal_code
//   3. name+city
//   → if match: UPDATE existing company with placeId / website / domain / lat-lng /
//     rating / additional_info. INSERT contact if primary_email is net-new. Always
//     set discovered_shops.crm_company_id = matched id.
//   → if no match: INSERT new company + contact (if email). Set crm_company_id.
//
// ICP filter:
//   shop_type IN ('auto_repair','tire_combo','auto_body')
//   AND NOT permanently_closed
//   AND raw_data->>'chain_tag' NOT LIKE 'out-truck-%'  (already out of shop_type but defensive)
//   AND raw_data->>'chain_tag' != 'carglass'
//
// Usage:
//   node scripts/promote-norway-staging.mjs                → dry-run
//   node scripts/promote-norway-staging.mjs --apply        → write
//   node scripts/promote-norway-staging.mjs --limit 50

import dotenv from "dotenv";
import postgres from "postgres";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const p of [join(__dirname, "../.env.local"), join(__dirname, "../../../../.env.local")]) {
  if (!dotenv.config({ path: p }).error) break;
}

const APPLY = process.argv.includes("--apply");
const LIMIT_ARG = process.argv.indexOf("--limit");
const LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1], 10) : null;

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0";
const PROMOTE_TAG = "apify-promoted-2026-05-21";

const sql = postgres({
  host: "aws-1-eu-north-1.pooler.supabase.com", port: 5432,
  user: "postgres.wdgiwuhehqpkhpvdzzzl",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres", ssl: { rejectUnauthorized: false }, max: 1,
});

const last8 = (raw) => {
  if (!raw) return null;
  const d = raw.replace(/[^\d]/g, "");
  return d.length >= 8 ? d.slice(-8) : null;
};
const norm = (s) => (s || "").trim().toLowerCase();
const extractDomain = (website) => {
  if (!website) return null;
  try { return new URL(website.startsWith("http") ? website : "https://" + website).hostname.replace(/^www\./, ""); }
  catch { return null; }
};

// Fetch ICP-qualifying staging rows
console.log("Loading ICP staging rows...");
let stagingQuery = sql`
  SELECT * FROM discovered_shops
  WHERE country_code = 'NO'
    AND shop_type IN ('auto_repair','tire_combo','auto_body')
    AND permanently_closed IS NOT TRUE
    AND (raw_data->>'chain_tag' IS NULL
         OR (raw_data->>'chain_tag' NOT LIKE 'out-truck-%'
             AND raw_data->>'chain_tag' != 'carglass'))
    AND crm_company_id IS NULL
  ORDER BY id
  ${LIMIT ? sql`LIMIT ${LIMIT}` : sql``}
`;
const staging = await stagingQuery;
console.log(`  ${staging.length} staging rows to process.`);

// Load existing NO companies for dedup
console.log("Loading existing NO companies...");
const existing = await sql`
  SELECT id, name, LOWER(TRIM(name)) AS name_norm, phone, postal_code, city, domain, tags, custom_fields, google_place_id
  FROM companies
  WHERE workspace_id = ${WORKSPACE_ID} AND country_code = 'NO'
`;
console.log(`  ${existing.length} existing NO companies loaded.`);

const byPhone = new Map();
const byNamePostal = new Map();
const byNameCity = new Map();
for (const c of existing) {
  const p = last8(c.phone);
  if (p) byPhone.set(p, c);
  if (c.name_norm && c.postal_code) byNamePostal.set(`${c.name_norm}|${c.postal_code}`, c);
  if (c.name_norm && c.city) byNameCity.set(`${c.name_norm}|${norm(c.city)}`, c);
}

// Domains already claimed
const claimedDomains = new Set();
{
  const r = await sql`SELECT DISTINCT LOWER(domain) AS domain FROM companies WHERE workspace_id = ${WORKSPACE_ID} AND domain IS NOT NULL`;
  for (const x of r) claimedDomains.add(x.domain);
}

// Existing emails (for contact dedup)
const emailSet = new Set();
{
  const r = await sql`SELECT DISTINCT LOWER(email) AS email FROM contacts WHERE workspace_id = ${WORKSPACE_ID} AND email IS NOT NULL AND email != ''`;
  for (const x of r) emailSet.add(x.email);
}

const stats = {
  scanned: 0, matchedPhone: 0, matchedNamePostal: 0, matchedNameCity: 0, unmatched: 0,
  newCompanies: 0, updatedCompanies: 0, newContacts: 0, skippedDupEmail: 0,
  errors: 0,
};

for (const r of staging) {
  stats.scanned++;
  const phoneKey = last8(r.phone);
  const nameNorm = norm(r.name);
  const namePostalKey = nameNorm && r.postal_code ? `${nameNorm}|${r.postal_code}` : null;
  const nameCityKey = nameNorm && r.city ? `${nameNorm}|${norm(r.city)}` : null;

  let match = null;
  if (phoneKey && byPhone.has(phoneKey)) { match = byPhone.get(phoneKey); stats.matchedPhone++; }
  else if (namePostalKey && byNamePostal.has(namePostalKey)) { match = byNamePostal.get(namePostalKey); stats.matchedNamePostal++; }
  else if (nameCityKey && byNameCity.has(nameCityKey)) { match = byNameCity.get(nameCityKey); stats.matchedNameCity++; }
  else { stats.unmatched++; }

  let domain = extractDomain(r.website);
  if (domain && claimedDomains.has(domain)) domain = null;

  const email = (r.primary_email || "").toLowerCase().trim() || null;

  if (match) {
    // UPDATE existing — attach Apify data to brreg/chain-sitemap row
    if (APPLY) {
      try {
        const update = {};
        if (r.google_place_id && !match.google_place_id) update.google_place_id = r.google_place_id;
        if (r.website && !match.domain) update.website = r.website;
        if (r.latitude && r.longitude) { update.latitude = r.latitude; update.longitude = r.longitude; }
        if (r.rating) update.rating = r.rating;
        if (r.review_count) update.review_count = r.review_count;
        // Tag: add apify-promoted tag
        const existingTags = match.tags || [];
        if (!existingTags.includes(PROMOTE_TAG)) update.tags = [...existingTags, PROMOTE_TAG];

        if (Object.keys(update).length > 0) {
          await sql`UPDATE companies SET ${sql(update)}, updated_at = NOW() WHERE id = ${match.id}`;
          stats.updatedCompanies++;
        }
        // Mark staging row promoted
        await sql`UPDATE discovered_shops SET crm_company_id = ${match.id}, updated_at = NOW() WHERE id = ${r.id}`;
      } catch (err) {
        console.error(`UPDATE failed for ${match.id}: ${err.message}`);
        stats.errors++;
        continue;
      }
    }

    if (email && !emailSet.has(email)) {
      emailSet.add(email);
      if (APPLY) {
        try {
          await sql`INSERT INTO contacts ${sql({
            workspace_id: WORKSPACE_ID,
            company_id: match.id,
            email,
            phone: r.phone,
            source: "discovery",
            lead_status: "new",
            email_status: r.email_status || "unknown",
            tags: [PROMOTE_TAG],
          })}`;
        } catch (err) {
          console.error(`contact INSERT failed: ${err.message}`);
          stats.errors++;
          continue;
        }
      }
      stats.newContacts++;
    } else if (email) {
      stats.skippedDupEmail++;
    }
  } else {
    // INSERT new
    if (domain) claimedDomains.add(domain);
    if (!APPLY) {
      stats.newCompanies++;
      if (email && !emailSet.has(email)) { emailSet.add(email); stats.newContacts++; }
      else if (email) stats.skippedDupEmail++;
      continue;
    }

    try {
      const inserted = await sql`
        INSERT INTO companies ${sql({
          workspace_id: WORKSPACE_ID,
          name: r.name,
          domain,
          website: r.website,
          address: r.address || r.street,
          postal_code: r.postal_code,
          city: r.city,
          phone: r.phone,
          country: "Norway",
          country_code: "NO",
          industry: "Auto repair",
          category: r.category || "Auto repair",
          rating: r.rating,
          review_count: r.review_count,
          google_place_id: r.google_place_id,
          latitude: r.latitude,
          longitude: r.longitude,
          lifecycle_stage: "lead",
          source: "discovery",
          tags: [PROMOTE_TAG, ...(r.raw_data?.chain_tag ? [`chain-${r.raw_data.chain_tag}`] : [])],
          custom_fields: {
            shop_type: r.shop_type,
            discovered_shops_id: r.id,
            apify_run_id: r.raw_data?.run_id,
            apify_term: r.raw_data?.term,
          },
        })}
        RETURNING id
      `;
      const newId = inserted[0].id;
      stats.newCompanies++;
      // Add to lookup maps so subsequent rows can dedup against this one
      byPhone.set(phoneKey, { id: newId, name: r.name, name_norm: nameNorm });
      if (namePostalKey) byNamePostal.set(namePostalKey, { id: newId });
      if (nameCityKey) byNameCity.set(nameCityKey, { id: newId });

      // Mark staging promoted
      await sql`UPDATE discovered_shops SET crm_company_id = ${newId}, updated_at = NOW() WHERE id = ${r.id}`;

      if (email && !emailSet.has(email)) {
        emailSet.add(email);
        await sql`INSERT INTO contacts ${sql({
          workspace_id: WORKSPACE_ID,
          company_id: newId,
          email,
          phone: r.phone,
          source: "discovery",
          lead_status: "new",
          email_status: r.email_status || "unknown",
          tags: [PROMOTE_TAG],
        })}`;
        stats.newContacts++;
      } else if (email) {
        stats.skippedDupEmail++;
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
              address: r.address || r.street,
              postal_code: r.postal_code, city: r.city, phone: r.phone,
              country: "Norway", country_code: "NO",
              industry: "Auto repair", category: r.category || "Auto repair",
              rating: r.rating, review_count: r.review_count,
              google_place_id: r.google_place_id,
              latitude: r.latitude, longitude: r.longitude,
              lifecycle_stage: "lead", source: "discovery",
              tags: [PROMOTE_TAG, ...(r.raw_data?.chain_tag ? [`chain-${r.raw_data.chain_tag}`] : [])],
              custom_fields: {
                shop_type: r.shop_type, discovered_shops_id: r.id,
                apify_run_id: r.raw_data?.run_id, apify_term: r.raw_data?.term,
              },
            })}
            RETURNING id
          `;
          const newId = inserted[0].id;
          stats.newCompanies++;
          await sql`UPDATE discovered_shops SET crm_company_id = ${newId}, updated_at = NOW() WHERE id = ${r.id}`;
          if (email && !emailSet.has(email)) {
            emailSet.add(email);
            await sql`INSERT INTO contacts ${sql({
              workspace_id: WORKSPACE_ID, company_id: newId, email, phone: r.phone,
              source: "discovery", lead_status: "new", email_status: r.email_status || "unknown",
              tags: [PROMOTE_TAG],
            })}`;
            stats.newContacts++;
          }
        } catch (err2) {
          console.error(`retry-INSERT failed: ${err2.message}`);
          stats.errors++;
        }
      } else {
        console.error(`INSERT failed: ${err.message}`);
        stats.errors++;
      }
    }
  }

  if (stats.scanned % 200 === 0) process.stdout.write(`\r  ${stats.scanned}/${staging.length}`);
}
console.log();

console.log(`\n=== SUMMARY ===`);
console.log(`  scanned:               ${stats.scanned}`);
console.log(`  matched (phone):       ${stats.matchedPhone}`);
console.log(`  matched (name+postal): ${stats.matchedNamePostal}`);
console.log(`  matched (name+city):   ${stats.matchedNameCity}`);
console.log(`  unmatched (new):       ${stats.unmatched}`);
console.log(`  ---`);
console.log(`  new companies:         ${stats.newCompanies}`);
console.log(`  updated companies:     ${stats.updatedCompanies}`);
console.log(`  new contacts:          ${stats.newContacts}`);
console.log(`  skipped dup-email:     ${stats.skippedDupEmail}`);
console.log(`  errors:                ${stats.errors}`);

if (!APPLY) console.log(`\nDRY-RUN — re-run with --apply.`);
await sql.end();

// One-off backfill: promote `discovered_shops` rows that match the canonical
// sequence enrollment filter but never made it through the discovery UI.
//
//   shop_type IN ('auto_repair','tire_combo','auto_glass','auto_body')
//   AND country_code = <country>
//   AND status IN ('new','enriched')
//   AND email_status IN ('valid','catch_all')
//   AND crm_company_id IS NULL
//
// Mirrors the dedup + insert logic in `src/app/api/discovery/promote/route.ts`.
// Once PR #129 (shop_type filter + deliverable email toggle) is in the UI this
// is also doable in one click — kept here as a re-usable template for the next
// time a cleanup migration leaves stranded ICP rows.
//
// Usage:
//   node scripts/backfill-promote-icp-by-shop-type.mjs --country SE [--dry-run]

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return args[i + 1] ?? true;
};

const COUNTRY = (getArg("--country", "SE") ?? "SE").toUpperCase();
const DRY_RUN = args.includes("--dry-run");
const CORE_ICP = ["auto_repair", "tire_combo", "auto_glass", "auto_body"];

const env = Object.fromEntries(
  readFileSync(`${process.env.HOME}/crm-for-saas/.env.local`, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const PAGE = 1000;
const INSERT_BATCH = 500;

const SHOP_FIELDS = [
  "id", "name", "website", "domain", "phone", "address", "street",
  "city", "postal_code", "country", "country_code", "primary_email",
  "all_emails", "all_phones", "instagram_url", "facebook_url",
  "google_place_id", "rating", "review_count", "category",
  "email_valid", "email_status", "email_verified_at",
].join(",");

function extractDomain(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function deriveLanguage(cc) {
  return ({ EE: "et", SE: "sv", FI: "fi", LV: "lv", LT: "lt", NO: "no", DK: "da" })[cc] ?? null;
}

// ── 1. Fetch all matching shops (paginated) ────────────────────────────────
async function fetchTargets() {
  const out = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("discovered_shops")
      .select(SHOP_FIELDS)
      .eq("country_code", COUNTRY)
      .in("shop_type", CORE_ICP)
      .in("status", ["new", "enriched"])
      .in("email_status", ["valid", "catch_all"])
      .is("crm_company_id", null)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// ── 2. Pre-fetch all companies for dedup ───────────────────────────────────
async function fetchWorkspace() {
  const { data, error } = await sb.from("workspaces").select("id").limit(1).single();
  if (error || !data) throw error ?? new Error("No workspace found");
  return data.id;
}

async function fetchCompanyDedupMaps(workspaceId) {
  const domainMap = new Map();
  const nameByCountry = new Map();
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("companies")
      .select("id, domain, name, country_code")
      .eq("workspace_id", workspaceId)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const c of data) {
      if (c.domain) domainMap.set(c.domain.toLowerCase(), c.id);
      if (c.name && c.country_code) {
        nameByCountry.set(`${c.country_code.toUpperCase()}:${c.name.toLowerCase()}`, c.id);
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return { domainMap, nameByCountry };
}

// ── 3. Main ─────────────────────────────────────────────────────────────────
const targets = await fetchTargets();
console.log(`[${COUNTRY}] Matching unpromoted ICP rows: ${targets.length}`);
if (targets.length === 0) process.exit(0);

const workspaceId = await fetchWorkspace();
const { domainMap, nameByCountry } = await fetchCompanyDedupMaps(workspaceId);
console.log(`Companies pre-fetched: ${domainMap.size} unique domains, ${nameByCountry.size} name+country keys`);

// Filter out invalid-email rows (matches route line 132)
const invalidEmail = targets.filter((s) => s.email_valid === false);
const validShops = targets.filter((s) => s.email_valid !== false);
console.log(`Invalid-email skips: ${invalidEmail.length}, processing: ${validShops.length}`);

// Classify
const duplicates = [];
const newShops = [];
for (const shop of validShops) {
  const domain = shop.domain ?? (shop.website ? extractDomain(shop.website) : null);
  const nameKey = shop.name && shop.country_code
    ? `${shop.country_code.toUpperCase()}:${shop.name.toLowerCase()}`
    : null;
  const existingId = (domain && domainMap.get(domain.toLowerCase())) ||
    (nameKey && nameByCountry.get(nameKey));
  if (existingId) duplicates.push({ shop, companyId: existingId });
  else newShops.push(shop);
}
console.log(`Duplicates (existing company): ${duplicates.length}, new companies to create: ${newShops.length}`);

if (DRY_RUN) {
  console.log("DRY RUN — no writes performed.");
  process.exit(0);
}

// ── 4. Mark invalid-email shops as skipped ─────────────────────────────────
for (let i = 0; i < invalidEmail.length; i += PAGE) {
  const chunk = invalidEmail.slice(i, i + PAGE);
  const { error } = await sb
    .from("discovered_shops")
    .update({ status: "skipped" })
    .in("id", chunk.map((s) => s.id));
  if (error) throw error;
}

// ── 5. Mark duplicates as imported (upsert with name to satisfy NOT NULL) ──
for (let i = 0; i < duplicates.length; i += PAGE) {
  const chunk = duplicates.slice(i, i + PAGE);
  const { error } = await sb.from("discovered_shops").upsert(
    chunk.map(({ shop, companyId }) => ({
      id: shop.id,
      name: shop.name,
      status: "imported",
      crm_company_id: companyId,
    })),
  );
  if (error) throw error;
}
console.log(`Marked ${duplicates.length} duplicates as imported.`);

// ── 6. Insert new companies ─────────────────────────────────────────────────
let promoted = 0;

if (newShops.length > 0) {
  // Within-batch domain collision detection (matches route logic exactly).
  // Some scraped "domains" are directory pages (vz.lt, info.lt) shared by
  // dozens of unrelated shops. Inserting them all with the same domain trips
  // the partial UNIQUE index on (workspace_id, domain). Drop the domain on
  // duplicates so each shop becomes a separate company.
  const batchDomainCount = new Map();
  const resolvedDomains = newShops.map((shop) => {
    const d = shop.domain ?? (shop.website ? extractDomain(shop.website) : null);
    if (d) batchDomainCount.set(d.toLowerCase(), (batchDomainCount.get(d.toLowerCase()) ?? 0) + 1);
    return d;
  });
  const insertableDomains = resolvedDomains.map((d) => {
    if (!d) return null;
    const lower = d.toLowerCase();
    if (batchDomainCount.get(lower) > 1) return null;
    if (domainMap.has(lower)) return null;
    return d;
  });

  const insertedCompanyIds = new Array(newShops.length).fill(null);

  for (let i = 0; i < newShops.length; i += INSERT_BATCH) {
    const chunk = newShops.slice(i, i + INSERT_BATCH);
    const { data: inserted, error } = await sb
      .from("companies")
      .insert(
        chunk.map((shop, j) => ({
          workspace_id: workspaceId,
          name: shop.name,
          website: shop.website ?? null,
          domain: insertableDomains[i + j],
          phone: shop.phone ?? null,
          address: shop.address ?? shop.street ?? null,
          city: shop.city ?? null,
          postal_code: shop.postal_code ?? null,
          country: shop.country ?? null,
          country_code: shop.country_code ?? null,
          instagram_url: shop.instagram_url ?? null,
          facebook_url: shop.facebook_url ?? null,
          google_place_id: shop.google_place_id ?? null,
          rating: shop.rating ?? null,
          review_count: shop.review_count ?? null,
          industry: "Automotive",
          category: shop.category ?? null,
          tags: ["independent"],
        })),
      )
      .select("id");
    if (error) throw error;
    if (inserted) {
      for (let j = 0; j < inserted.length; j++) {
        insertedCompanyIds[i + j] = inserted[j].id;
      }
    }
  }

  // ── 7. Insert contacts ────────────────────────────────────────────────────
  const contactEntries = [];
  for (let i = 0; i < newShops.length; i++) {
    const companyId = insertedCompanyIds[i];
    if (companyId) contactEntries.push({ shopIndex: i, companyId });
  }

  const insertedContactIds = new Map();

  for (let i = 0; i < contactEntries.length; i += INSERT_BATCH) {
    const chunk = contactEntries.slice(i, i + INSERT_BATCH);
    const { data: inserted, error } = await sb
      .from("contacts")
      .insert(
        chunk.map(({ shopIndex, companyId }) => {
          const shop = newShops[shopIndex];
          return {
            workspace_id: workspaceId,
            first_name: null,
            last_name: null,
            email: shop.primary_email ?? "",
            phone: shop.phone ?? null,
            address: shop.address ?? shop.street ?? null,
            city: shop.city ?? null,
            postal_code: shop.postal_code ?? null,
            country: shop.country ?? null,
            country_code: shop.country_code ?? null,
            all_emails: shop.all_emails ?? null,
            all_phones: shop.all_phones ?? null,
            instagram_url: shop.instagram_url ?? null,
            facebook_url: shop.facebook_url ?? null,
            company_id: companyId,
            is_primary: true,
            source: "discovery",
            language: deriveLanguage(shop.country_code),
            email_status: shop.email_status ?? "unknown",
            email_verified_at: shop.email_verified_at ?? null,
            lead_status: "new",
            status: "active",
            tags: ["owner"],
          };
        }),
      )
      .select("id");
    if (error) throw error;
    if (inserted) {
      for (let j = 0; j < inserted.length; j++) {
        insertedContactIds.set(chunk[j].shopIndex, inserted[j].id);
      }
    }
  }

  // ── 8. Mark discovered_shops imported ─────────────────────────────────────
  const shopUpdates = newShops
    .map((shop, i) => {
      const companyId = insertedCompanyIds[i];
      if (!companyId) return null;
      promoted++;
      return {
        id: shop.id,
        name: shop.name,
        status: "imported",
        crm_company_id: companyId,
        crm_contact_id: insertedContactIds.get(i) ?? null,
      };
    })
    .filter((u) => u !== null);

  for (let i = 0; i < shopUpdates.length; i += PAGE) {
    const chunk = shopUpdates.slice(i, i + PAGE);
    const { error } = await sb.from("discovered_shops").upsert(chunk);
    if (error) throw error;
  }
}

console.log(`\n✅ Done.`);
console.log(`   promoted (new companies+contacts): ${promoted}`);
console.log(`   duplicates (linked to existing companies): ${duplicates.length}`);
console.log(`   skipped (email_valid=false): ${invalidEmail.length}`);

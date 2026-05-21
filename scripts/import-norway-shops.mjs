// Import Norway Apify scrape into discovered_shops.
// Reads scripts/no-runs.json, fetches each SUCCEEDED dataset from Apify,
// dedupes on placeId, tags chains, upserts to discovered_shops.
//
// Filters: Per Jacob's 2026-05-21 call, NO accepts the brreg category noise
// (car-wash / detailing rows pass through). No inspection-chain hard filter for NO
// (NAF Senter is INCLUDED). Out-of-ICP truck dealers were already filtered upstream
// by the brreg importer, but Apify GM may surface them again — tag them via chain
// regex so we can exclude at promote time.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const p of [join(__dirname, "../.env.local"), join(__dirname, "../../../../.env.local")]) {
  if (!dotenv.config({ path: p }).error) break;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apifyToken = process.env.APIFY_TOKEN;
if (!supabaseUrl || !supabaseServiceKey || !apifyToken) {
  console.error("Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / APIFY_TOKEN)");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

const records = JSON.parse(readFileSync(join(__dirname, "no-runs.json"), "utf8"));
const succeeded = records.filter((r) => r.status === "SUCCEEDED" && r.datasetId);
const skipped = records.filter((r) => r.status !== "SUCCEEDED");
console.log(`Datasets to import: ${succeeded.length} (skipped non-SUCCEEDED: ${skipped.length})`);
if (skipped.length) for (const r of skipped) console.log(`  skip: ${r.label}  status=${r.status||"unset"}`);

const FETCH_BATCH = 500;
const UPSERT_BATCH = 50;

// Norwegian chain regex tagger (mirrors brreg parent-org map + SE-style name regex)
const CHAIN_PATTERNS = [
  { tag: "mekonomen",      re: /\bmekonomen\b/i },
  { tag: "meca",           re: /\b(meca|mecaverksted|mecabilservice)\b/i },
  { tag: "bilxtra",        re: /\bbilxtra\b/i },
  { tag: "automester",     re: /\bautomester\b/i },
  { tag: "vianor",         re: /\bvianor\b/i },
  { tag: "carglass",       re: /\bcarglass\b/i },
  { tag: "snap-drive",     re: /\bsnap[- ]?drive\b/i },
  { tag: "naf-senter",     re: /\bnaf\b/i },
  { tag: "bosch-cs",       re: /\bbosch[- ]car[- ]?service\b/i },
  { tag: "fixus",          re: /\bfixus\b/i },
  { tag: "euromaster",     re: /\beuromaster\b/i },
  { tag: "team-verksted",  re: /\bteam[- ]?verksted\b/i },
  { tag: "werksta",        re: /\bwerksta\b/i },
  { tag: "tesla",          re: /\btesla\b/i },
  { tag: "bilia",          re: /\bbilia\b/i },
  { tag: "nordvik",        re: /\bnordvik\b/i },
  { tag: "hedin",          re: /\bhedin\b/i },
  // Truck/heavy — out of ICP, tag to exclude at promote time
  { tag: "out-truck-scania",        re: /\bscania\b/i },
  { tag: "out-truck-bertel-steen",  re: /bertel\s+o\.?\s+steen.*(lastebil|buss|lb)/i },
  { tag: "out-truck-trucknor",      re: /\btrucknor\b/i },
];
const chainTag = (name) => {
  for (const p of CHAIN_PATTERNS) if (p.re.test(name || "")) return p.tag;
  return null;
};

const extractDomain = (website) => {
  if (!website) return null;
  try {
    const u = new URL(website.startsWith("http") ? website : "https://" + website);
    return u.hostname.replace(/^www\./, "") || null;
  } catch { return null; }
};

const googleMapsUrl = (item) =>
  item.url || (item.placeId ? `https://www.google.com/maps/place/?q=place_id:${item.placeId}` : null);

const processItem = (item, runMeta) => {
  const emails = item.emails || [];
  const phones = item.phoneNumbers || (item.phone ? [item.phone] : []);
  const cats = item.categories || (item.categoryName ? [item.categoryName] : []);
  const website = item.website || null;
  const tag = chainTag(item.title);
  return {
    name: item.title,
    google_place_id: item.placeId,
    google_maps_url: googleMapsUrl(item),
    address: item.address || null,
    street: item.street || null,
    city: item.city || null,
    postal_code: item.postalCode || null,
    state: item.state || null,
    country: "Norway",
    country_code: "NO",
    latitude: item.location?.lat ?? null,
    longitude: item.location?.lng ?? null,
    plus_code: item.plusCode || null,
    phone: item.phone || null,
    website,
    domain: extractDomain(website),
    primary_email: emails[0] || null,
    all_emails: emails,
    all_phones: phones,
    instagram_url: (item.instagrams || [])[0] || null,
    facebook_url: (item.facebooks || [])[0] || null,
    linkedin_url: (item.linkedIns || item.linkedins || [])[0] || null,
    twitter_url: (item.twitters || item.xs || [])[0] || null,
    youtube_url: (item.youtubes || [])[0] || null,
    category: cats[0] || null,
    all_categories: cats,
    rating: item.totalScore ?? null,
    review_count: item.reviewsCount ?? null,
    price_level: parseInt(item.price || "", 10) || null,
    opening_hours: item.openingHours || null,
    description: item.description || null,
    additional_info: item.additionalInfo || null,
    permanently_closed: item.permanentlyClosed === true,
    temporarily_closed: item.temporarilyClosed === true,
    popular_times: item.popularTimesHistogram || null,
    source: "google_maps",
    status: "new",
    scraped_at: new Date().toISOString(),
    raw_data: { cell: runMeta.cell, term: runMeta.term, run_id: runMeta.runId, chain_tag: tag },
  };
};

const seen = new Set();
const out = [];
let noPlaceId = 0;

for (const r of succeeded) {
  console.log(`\nFetching ${r.label}  (dataset ${r.datasetId})…`);
  let offset = 0;
  let totalThis = 0;
  while (true) {
    const url = `https://api.apify.com/v2/datasets/${r.datasetId}/items?format=json&limit=${FETCH_BATCH}&offset=${offset}&token=${apifyToken}`;
    const resp = await fetch(url);
    if (!resp.ok) { console.error(`  Apify ${resp.status}: ${(await resp.text()).slice(0,200)}`); break; }
    const items = await resp.json();
    if (!items || items.length === 0) break;
    totalThis += items.length;
    for (const item of items) {
      if (!item.placeId) { noPlaceId++; continue; }
      if (seen.has(item.placeId)) continue;
      seen.add(item.placeId);
      out.push(processItem(item, r));
    }
    if (items.length < FETCH_BATCH) break;
    offset += FETCH_BATCH;
  }
  process.stdout.write(`  fetched ${totalThis}, unique-so-far ${out.length}\n`);
}

console.log(`\nFetched ${out.length} unique workshops`);
console.log(`  No placeId: ${noPlaceId}`);
const withEmail = out.filter((r) => r.primary_email).length;
const withPhone = out.filter((r) => r.phone).length;
const withWeb = out.filter((r) => r.website).length;
const cities = new Set(out.map((r) => r.city).filter(Boolean));
const closed = out.filter((r) => r.permanently_closed).length;
const tagged = out.filter((r) => r.raw_data.chain_tag).length;
console.log(`  With email:   ${withEmail} (${Math.round(withEmail*100/out.length)}%)`);
console.log(`  With phone:   ${withPhone} (${Math.round(withPhone*100/out.length)}%)`);
console.log(`  With website: ${withWeb} (${Math.round(withWeb*100/out.length)}%)`);
console.log(`  Permanently closed: ${closed}`);
console.log(`  Chain-tagged: ${tagged}`);
console.log(`  Unique cities: ${cities.size}`);
const tagCounts = {};
for (const r of out) {
  const t = r.raw_data.chain_tag;
  if (t) tagCounts[t] = (tagCounts[t]||0) + 1;
}
console.log(`  Chain breakdown:`, tagCounts);

if (process.argv.includes("--dry-run")) {
  console.log("\nDRY-RUN — not upserting.");
  process.exit(0);
}

console.log(`\nUpserting to discovered_shops…`);
let inserted = 0, errors = 0;
for (let i = 0; i < out.length; i += UPSERT_BATCH) {
  const batch = out.slice(i, i + UPSERT_BATCH);
  const { error } = await supabase
    .from("discovered_shops")
    .upsert(batch, { onConflict: "google_place_id", ignoreDuplicates: true });
  if (error) {
    console.error(`\n  batch ${i}: ${error.message}`);
    errors += batch.length;
  } else {
    inserted += batch.length;
    process.stdout.write(`\r  ${inserted}/${out.length}`);
  }
}
console.log();

const { count } = await supabase
  .from("discovered_shops")
  .select("*", { count: "exact", head: true })
  .eq("country_code", "NO");
console.log(`\n=== Done ===`);
console.log(`Inserted: ${inserted}, errors: ${errors}`);
console.log(`Total NO in discovered_shops: ${count}`);

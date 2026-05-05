// Import Sweden auto-repair-workshop scrape (Stockholm metro pilot) into
// discovered_shops. Reads scripts/se-runs.json (populated by start-sweden-runs.mjs
// + retry-pending-sweden-runs.mjs), fetches each SUCCEEDED dataset from Apify,
// dedupes on placeId, applies Swedish-market filters, and upserts.
//
// Modelled on import-gb-citygrid.mjs but with Phase 25-era + new (2026-05-05)
// schema fields: google_maps_url, description, additional_info, closed flags,
// price_level, plus_code, popular_times, twitter/youtube/linkedin URLs.
//
// Filters:
//   - Drop vehicle-inspection stations (Bilprovningen, Carspect, Opus, DEKRA,
//     Applus) — they're not workshops, just inspection.
//   - Drop names containing 'besiktning' UNLESS also 'verkstad' (catches
//     misc inspection-only shops).
//   - Tag chains via raw_data.chain_tag — Mekonomen, Autoexperten, MECA,
//     Bosch Car Service, Bilia, AD Bildelar, Däckia, Vianor, Speedy, Euromaster.
//
// Run with: node scripts/import-sweden-shops.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const apifyToken = process.env.APIFY_TOKEN
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!apifyToken) { console.error('Missing APIFY_TOKEN'); process.exit(1) }

const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })

const RUNS_PATH = join(__dirname, 'se-runs.json')
const records = JSON.parse(readFileSync(RUNS_PATH, 'utf8'))
const succeeded = records.filter(r => r.status === 'SUCCEEDED' && r.datasetId)
const skipped   = records.filter(r => r.status !== 'SUCCEEDED')
console.log(`Datasets to import: ${succeeded.length}  (skipped non-SUCCEEDED: ${skipped.length})`)
if (skipped.length) {
  for (const r of skipped) console.log(`  skip: ${r.label}  status=${r.status||'unset'}`)
}

const FETCH_BATCH = 500
const UPSERT_BATCH = 50

// ---- Filters / tags ----

// Vehicle inspection (besiktning) chains — drop these entirely
const INSPECTION_RE = /\b(bilprovningen|carspect|opus\s+bilprovning|dekra|applus|svensk\s+bilprovning|a-katsastus)\b/i
// Generic 'besiktning' check — drop if pure inspection (no workshop indication)
const BESIKTNING_ONLY = (name) =>
  /besiktning/i.test(name || '') && !/(verkstad|service|reparation|mekan)/i.test(name || '')

const isInspection = (name) => INSPECTION_RE.test(name || '') || BESIKTNING_ONLY(name)

// Chain workshop tagger — return tag string or null
const CHAIN_PATTERNS = [
  { tag: 'mekonomen',         re: /\bmekonomen\b/i },
  { tag: 'autoexperten',      re: /\bautoexperten\b/i },
  { tag: 'meca',              re: /\bmeca\b/i },
  { tag: 'bosch-car-service', re: /\bbosch\s+car\s+service\b/i },
  { tag: 'bilia',             re: /\bbilia\b/i },
  { tag: 'ad-bildelar',       re: /\bad\s+(bildelar|bilverkstad)\b/i },
  { tag: 'däckia',            re: /\bd[äa]ckia\b/i },
  { tag: 'vianor',            re: /\bvianor\b/i },
  { tag: 'speedy',            re: /\bspeedy\b/i },
  { tag: 'euromaster',        re: /\beuromaster\b/i },
  { tag: 'bd-group',          re: /\bbd\s*(group|södertälje|gruppen)\b/i },
  { tag: 'din-bil',           re: /\bdin\s+bil\b/i },
  { tag: 'first-stop',        re: /\bfirst\s+stop\b/i },
  { tag: 'pitstop',           re: /\bpit\s*stop\b/i },
]
function chainTag(name) {
  for (const p of CHAIN_PATTERNS) if (p.re.test(name || '')) return p.tag
  return null
}

function extractDomain(website) {
  if (!website) return null
  try {
    const u = new URL(website.startsWith('http') ? website : 'https://' + website)
    return u.hostname.replace(/^www\./, '') || null
  } catch { return null }
}

function googleMapsUrl(item) {
  if (item.url) return item.url
  if (item.placeId) return `https://www.google.com/maps/place/?q=place_id:${item.placeId}`
  return null
}

// Map an Apify result item → discovered_shops row
function processItem(item, runMeta) {
  const emails    = item.emails || []
  const phones    = item.phoneNumbers || (item.phone ? [item.phone] : [])
  const cats      = item.categories || (item.categoryName ? [item.categoryName] : [])
  const website   = item.website || null
  const tag       = chainTag(item.title)

  return {
    name:                 item.title,
    google_place_id:      item.placeId,
    google_maps_url:      googleMapsUrl(item),
    address:              item.address || null,
    street:               item.street || null,
    city:                 item.city || null,
    postal_code:          item.postalCode || null,
    state:                item.state || null,
    country:              'Sweden',
    country_code:         'SE',
    latitude:             item.location?.lat ?? null,
    longitude:            item.location?.lng ?? null,
    plus_code:            item.plusCode || null,
    phone:                item.phone || null,
    website,
    domain:               extractDomain(website),
    primary_email:        emails[0] || null,
    all_emails:           emails,
    all_phones:           phones,
    instagram_url:        (item.instagrams || [])[0] || null,
    facebook_url:         (item.facebooks || [])[0] || null,
    linkedin_url:         (item.linkedIns || item.linkedins || [])[0] || null,
    twitter_url:          (item.twitters || item.xs || [])[0] || null,
    youtube_url:          (item.youtubes || [])[0] || null,
    category:             cats[0] || null,
    all_categories:       cats,
    rating:               item.totalScore ?? null,
    review_count:         item.reviewsCount ?? null,
    price_level:          parseInt(item.price || '', 10) || null,
    opening_hours:        item.openingHours || null,
    description:          item.description || null,
    additional_info:      item.additionalInfo || null,
    permanently_closed:   item.permanentlyClosed === true,
    temporarily_closed:   item.temporarilyClosed === true,
    popular_times:        item.popularTimesHistogram || null,
    source:               'google_maps',
    status:               'new',
    scraped_at:           new Date().toISOString(),
    raw_data: {
      cell:       runMeta.cell,
      term:       runMeta.term,
      run_id:     runMeta.runId,
      chain_tag:  tag,
    },
  }
}

// ---- Pull all items from all datasets, dedupe on placeId ----

const seen = new Set()
const out  = []
let inspectionFiltered = 0
let noPlaceId = 0

for (const r of succeeded) {
  console.log(`\nFetching ${r.label}  (dataset ${r.datasetId})…`)
  let offset = 0
  let totalThis = 0
  while (true) {
    const url = `https://api.apify.com/v2/datasets/${r.datasetId}/items?format=json&limit=${FETCH_BATCH}&offset=${offset}&token=${apifyToken}`
    const resp = await fetch(url)
    if (!resp.ok) {
      console.error(`  Apify ${resp.status}: ${(await resp.text()).slice(0,200)}`)
      break
    }
    const items = await resp.json()
    if (!items || items.length === 0) break
    totalThis += items.length
    for (const item of items) {
      if (!item.placeId) { noPlaceId++; continue }
      if (isInspection(item.title)) { inspectionFiltered++; continue }
      if (seen.has(item.placeId)) continue
      seen.add(item.placeId)
      out.push(processItem(item, r))
    }
    if (items.length < FETCH_BATCH) break
    offset += FETCH_BATCH
  }
  process.stdout.write(`  fetched ${totalThis}, unique-so-far ${out.length}\n`)
}

console.log(`\nFetched ${out.length} unique workshops`)
console.log(`  Inspection-filtered: ${inspectionFiltered}`)
console.log(`  No placeId:          ${noPlaceId}`)
const withEmail = out.filter(r => r.primary_email).length
const withPhone = out.filter(r => r.phone).length
const withWeb   = out.filter(r => r.website).length
const cities    = new Set(out.map(r => r.city).filter(Boolean))
const closed    = out.filter(r => r.permanently_closed).length
const tagged    = out.filter(r => r.raw_data.chain_tag).length
console.log(`  With email:          ${withEmail} (${Math.round(withEmail*100/out.length)}%)`)
console.log(`  With phone:          ${withPhone} (${Math.round(withPhone*100/out.length)}%)`)
console.log(`  With website:        ${withWeb} (${Math.round(withWeb*100/out.length)}%)`)
console.log(`  Permanently closed:  ${closed}`)
console.log(`  Chain-tagged:        ${tagged}`)
console.log(`  Unique cities:       ${cities.size}`)
const tagCounts = {}
for (const r of out) {
  const t = r.raw_data.chain_tag
  if (t) tagCounts[t] = (tagCounts[t]||0) + 1
}
console.log(`  Chain breakdown:`, tagCounts)

// ---- Upsert ----
console.log(`\nUpserting to discovered_shops…`)
let inserted = 0
let errors = 0
for (let i = 0; i < out.length; i += UPSERT_BATCH) {
  const batch = out.slice(i, i + UPSERT_BATCH)
  const { error } = await supabase
    .from('discovered_shops')
    .upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: true })
  if (error) {
    console.error(`\n  batch ${i}: ${error.message}`)
    errors += batch.length
  } else {
    inserted += batch.length
    process.stdout.write(`\r  ${inserted}/${out.length}`)
  }
}
console.log()

const { count: totalSE } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
  .eq('country_code', 'SE')
console.log(`\n=== Apify Import Done ===`)
console.log(`Inserted (new):   ${inserted}`)
console.log(`Errors:           ${errors}`)
console.log(`Total SE in DB:   ${totalSE}`)

// ---- Phase F — cross-link new Apify rows with existing customers ----
// Same logic as import-wl-users.mjs Phase F: exact-email match + single-customer-domain.
console.log(`\n=== Cross-linking with existing customers ===`)
const WORKSPACE_ID = 'd946ea1f-74b4-492e-ae6a-d50f59ff04f0'
const { data: customerEmails } = await supabase
  .from('contacts').select('email, company_id')
  .eq('workspace_id', WORKSPACE_ID).eq('source', 'wl-app').not('email', 'is', null)

const emailToCompany = new Map()
const domainToCompanies = new Map()
for (const r of customerEmails || []) {
  const e = (r.email || '').toLowerCase()
  emailToCompany.set(e, r.company_id)
  const d = e.split('@')[1]
  if (d) {
    if (!domainToCompanies.has(d)) domainToCompanies.set(d, new Set())
    domainToCompanies.get(d).add(r.company_id)
  }
}
const FREEMAIL = new Set(['gmail.com','googlemail.com','hotmail.com','hotmail.se','outlook.com','live.com','yahoo.com','yahoo.se','icloud.com','me.com','aol.com','protonmail.com'])
const singleDomainToCompany = new Map()
for (const [d, ids] of domainToCompanies) {
  if (ids.size === 1 && !FREEMAIL.has(d)) singleDomainToCompany.set(d, [...ids][0])
}
console.log(`  ${emailToCompany.size} customer emails  ·  ${singleDomainToCompany.size} single-customer domains`)

// Paginate through unlinked SE rows
const unlinked = []
{
  let offset = 0
  while (true) {
    const { data, error } = await supabase.from('discovered_shops')
      .select('id, primary_email, domain')
      .eq('country_code', 'SE')
      .not('primary_email', 'is', null)
      .is('crm_company_id', null)
      .range(offset, offset + 999)
    if (error || !data || data.length === 0) break
    unlinked.push(...data)
    if (data.length < 1000) break
    offset += 1000
  }
}
console.log(`  ${unlinked.length} unlinked SE rows to check`)

let exactMatch = 0, domainMatch = 0
const updates = []
for (const s of unlinked) {
  const e = (s.primary_email || '').toLowerCase()
  let cid = emailToCompany.get(e)
  if (cid) { updates.push({ id: s.id, cid }); exactMatch++; continue }
  const d = (s.domain || e.split('@')[1] || '').toLowerCase()
  cid = d ? singleDomainToCompany.get(d) : null
  if (cid) { updates.push({ id: s.id, cid }); domainMatch++ }
}
console.log(`  Matches → exact-email: ${exactMatch}  ·  single-domain: ${domainMatch}`)

let crossLinked = 0
for (const u of updates) {
  const { error } = await supabase.from('discovered_shops')
    .update({ crm_company_id: u.cid, status: 'imported' }).eq('id', u.id)
  if (!error) crossLinked++
}
console.log(`  Cross-linked: ${crossLinked}/${updates.length}`)

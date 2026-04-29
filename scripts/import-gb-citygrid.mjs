// Import the GB city-grid scrape (batch 2): 32 Apify datasets from
// scripts/gb-runs.json → discovered_shops with country_code='GB'.
//
// Dedup priority: google_place_id (gold; how the upsert key works) →
//                 normalised domain → E.164 phone → name+city
//
// Existing 1,404 GB rows from batch 1 are preserved on conflict
// (ignoreDuplicates:true). New emails are NOT MV-verified here — run
// `node scripts/verify-emails.mjs --country GB --only-null` afterwards.
//
// Run with:
//   node scripts/import-gb-citygrid.mjs

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
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
if (!apifyToken) {
  console.error('Missing APIFY_TOKEN in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })

const runsPath = join(__dirname, 'gb-runs.json')
const runs = JSON.parse(readFileSync(runsPath, 'utf8'))
const DATASETS = runs
  .filter((r) => r.runId && r.datasetId && r.status === 'SUCCEEDED')
  .map((r) => ({ id: r.datasetId, label: r.label }))

if (DATASETS.length !== runs.length) {
  console.warn(`⚠ ${runs.length - DATASETS.length} runs not in SUCCEEDED state — skipping those datasets`)
}
console.log(`Importing from ${DATASETS.length} Apify datasets`)

const FETCH_BATCH_SIZE = 500
const UPSERT_BATCH_SIZE = 50

// UK English includes — match GMB categories (lowercased) with overlap
// semantics: include if ANY category matches; exclude only if ALL match exclude.
const INCLUDE_CATEGORY_REGEX = /(auto repair|car repair|mechanic|tire|tyre|garage|body shop|bodywork|paint|panel beater|accident repair|crash repair|inspection|MOT|oil change|diesel|transmission|clutch|brake|electric.*auto|auto.*electric|vehicle.*service|car servicing|car detail|wheel alignment|exhaust|battery|service centre|service center|aircon|air conditioning)/i

const EXCLUDE_CATEGORY_REGEX = /(car dealer|car rental|petrol station|gas station|car wash|self service car wash|motorcycle (dealer|repair|shop)|truck rental|motor home|rv dealer|boat|bicycle|scooter|used car dealer|new car dealer|auto parts store|auto auction|auto broker|junkyard|salvage yard|electric vehicle charging station|chauffeur|taxi|driving school|insurance|locksmith|restaurant|hotel|cafe|bar|supermarket)/i

function isIncluded(categories) {
  if (!categories || categories.length === 0) return true
  if (categories.some((c) => INCLUDE_CATEGORY_REGEX.test(c))) return true
  if (categories.every((c) => EXCLUDE_CATEGORY_REGEX.test(c))) return false
  return true
}

function extractDomain(website) {
  if (!website) return null
  try {
    const u = new URL(website.startsWith('http') ? website : 'https://' + website)
    return u.hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

// UK phone — keep last 10 digits for dedup (UK numbers are 10 or 11 digits incl trunk 0)
function normalizePhoneForDedup(phone) {
  if (!phone) return null
  const d = phone.replace(/\D/g, '')
  if (d.length < 9) return null
  return d.slice(-10)
}

function normalizeName(name) {
  if (!name) return ''
  return name
    .toLowerCase()
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

function normalizePhoneE164(phone) {
  if (!phone) return null
  let d = phone.replace(/\D/g, '')
  if (!d) return null
  if (d.startsWith('44')) d = d.slice(2)
  if (d.startsWith('0')) d = d.slice(1)
  if (d.length < 9 || d.length > 11) return null
  return '+44' + d
}

function processItem(item) {
  const emails = item.emails || []
  const phones = item.phoneNumbers || (item.phone ? [item.phone] : [])
  const cats = item.categories || []
  const website = item.website || null

  return {
    name: item.title,
    google_place_id: item.placeId,
    address: item.address,
    street: item.street || null,
    city: item.city || null,
    postal_code: item.postalCode || null,
    state: item.state || null,
    country: 'United Kingdom',
    country_code: 'GB',
    latitude: item.location?.lat ?? null,
    longitude: item.location?.lng ?? null,
    phone: normalizePhoneE164(item.phoneUnformatted || item.phone),
    website,
    domain: extractDomain(website),
    primary_email: emails[0] || null,
    all_emails: emails,
    all_phones: phones.map(normalizePhoneE164).filter(Boolean),
    instagram_url: item.instagramUrl || null,
    facebook_url: item.facebookUrl || null,
    category: item.categoryName || cats[0] || null,
    all_categories: cats,
    rating: item.totalScore ?? null,
    review_count: item.reviewsCount ?? null,
    opening_hours: item.openingHours || null,
    source: 'google_maps',
    status: 'new',
    scraped_at: new Date().toISOString(),
    raw_data: { search_term: item.searchString || null, batch: 'citygrid-2026-04-29' },
  }
}

// --- Fetch all datasets ---
const allRawItems = []
let fetchErrors = 0

for (const dataset of DATASETS) {
  console.log(`\nFetching ${dataset.label} (dataset ${dataset.id})...`)
  let offset = 0
  let datasetDone = false

  while (!datasetDone) {
    const url = `https://api.apify.com/v2/datasets/${dataset.id}/items?format=json&clean=1&limit=${FETCH_BATCH_SIZE}&offset=${offset}&token=${apifyToken}`
    process.stdout.write(`  offset ${offset}...`)
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`\n  Apify API error ${res.status}: ${await res.text()}`)
      fetchErrors++
      break
    }
    const items = await res.json()
    if (items.length === 0) datasetDone = true
    else {
      allRawItems.push(...items)
      process.stdout.write(` +${items.length}`)
      offset += FETCH_BATCH_SIZE
      if (items.length < FETCH_BATCH_SIZE) datasetDone = true
    }
  }
  console.log('')
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
console.log(`Raw items fetched: ${allRawItems.length}`)
if (fetchErrors) console.log(`Fetch errors: ${fetchErrors}`)

// --- Dedup within this batch ---
const byPlaceId = new Map()
const bySecondary = new Map()
let categoryFiltered = 0
let dupPlaceId = 0
let dupSecondary = 0

for (const item of allRawItems) {
  if (!item.placeId) continue
  if (byPlaceId.has(item.placeId)) {
    dupPlaceId++
    continue
  }
  if (!isIncluded(item.categories)) {
    categoryFiltered++
    continue
  }
  const processed = processItem(item)
  const phoneDedup = normalizePhoneForDedup(processed.phone)
  const nameCity = `${normalizeName(processed.name)}|${normalizeName(processed.city)}`
  const secondaryKey = processed.domain || phoneDedup || (nameCity.length > 3 ? nameCity : null)
  if (secondaryKey && bySecondary.has(secondaryKey)) {
    dupSecondary++
    continue
  }
  byPlaceId.set(item.placeId, processed)
  if (secondaryKey) bySecondary.set(secondaryKey, item.placeId)
}

const allItems = [...byPlaceId.values()]
console.log(`Dedup within batch:`)
console.log(`  Unique by placeId: ${allItems.length}`)
console.log(`  Dup placeId skipped: ${dupPlaceId}`)
console.log(`  Dup domain/phone/name+city skipped: ${dupSecondary}`)
console.log(`  Category-filtered: ${categoryFiltered}`)

// --- Cross-dedup against existing GB rows in discovered_shops by google_place_id ---
const placeIds = allItems.map((r) => r.google_place_id).filter(Boolean)
const existingPlaceIds = new Set()
const CHUNK = 1000
for (let i = 0; i < placeIds.length; i += CHUNK) {
  const chunk = placeIds.slice(i, i + CHUNK)
  const { data } = await supabase
    .from('discovered_shops')
    .select('google_place_id')
    .in('google_place_id', chunk)
  for (const r of data || []) existingPlaceIds.add(r.google_place_id)
}
const newOnly = allItems.filter((r) => !existingPlaceIds.has(r.google_place_id))
console.log(`\nCross-dedup vs existing discovered_shops:`)
console.log(`  Already in DB (will skip): ${allItems.length - newOnly.length}`)
console.log(`  Net new to insert: ${newOnly.length}`)

// --- Stats on net-new ---
const withEmail = newOnly.filter((r) => r.primary_email).length
const withPhone = newOnly.filter((r) => r.phone).length
const withWebsite = newOnly.filter((r) => r.website).length
const cities = new Set(newOnly.map((r) => r.city).filter(Boolean))
console.log(`\nNet-new stats:`)
console.log(`  With email:    ${withEmail} (${Math.round((withEmail / Math.max(newOnly.length, 1)) * 100)}%)`)
console.log(`  With phone:    ${withPhone} (${Math.round((withPhone / Math.max(newOnly.length, 1)) * 100)}%)`)
console.log(`  With website:  ${withWebsite} (${Math.round((withWebsite / Math.max(newOnly.length, 1)) * 100)}%)`)
console.log(`  Unique cities: ${cities.size}`)

// --- Upsert ---
console.log(`\nImporting to discovered_shops...`)
let inserted = 0
let errors = 0

for (let i = 0; i < newOnly.length; i += UPSERT_BATCH_SIZE) {
  const batch = newOnly.slice(i, i + UPSERT_BATCH_SIZE)
  const { error } = await supabase
    .from('discovered_shops')
    .upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: true })

  if (error) {
    console.error(`\nBatch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1} error:`, error.message)
    errors += batch.length
  } else {
    inserted += batch.length
    process.stdout.write(`\r  Progress: ${Math.min(i + UPSERT_BATCH_SIZE, newOnly.length)}/${newOnly.length}`)
  }
}

console.log(`\n`)
console.log(`✅ Done`)
console.log(`   Net-new processed: ${inserted}`)
if (errors) console.log(`   Errors: ${errors}`)

const { count: gbCount } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
  .eq('country_code', 'GB')
console.log(`   GB rows in discovered_shops: ${gbCount}`)

const { count: total } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
console.log(`   Total in discovered_shops: ${total}`)

console.log(`\nNext: node scripts/verify-emails.mjs --country GB --only-null --concurrency 20`)

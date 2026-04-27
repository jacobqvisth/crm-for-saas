// Import Serbia auto repair shops into discovered_shops table.
// Reads dataset IDs from scripts/serbia-runs.json (produced by scrape-serbia-launch.mjs)
// and fetches directly from Apify datasets — no local JSON file.
//
// 21 datasets total:
//   1 country-wide (5 terms: autoservis, auto servis, automehaničar, autolimar, autolakirer)
//   3 Belgrade splits (autoservis, auto servis, autolimar)
//   6 Novi Sad / Niš / Kragujevac splits (2 terms × 3 cities)
//   11 medium city grids (autoservis + autolimar)
//
// Dedup key priority: google_place_id → normalized domain → E.164 phone (last 9) → name+city
// Category filter: include if ANY category matches include list, exclude if ALL categories
//                  in exclude list (array-overlap rule)
// Kosovo filter: drop rows with countryCode === 'XK' or address matching Kosovo city regex
//
// Prerequisites:
//   APIFY_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
//   scripts/serbia-runs.json must list SUCCEEDED runs with datasetId set
//
// Run with:
//   node scripts/import-serbia-shops.mjs
//
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFile } from 'fs/promises'
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

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
})

const runsFile = join(__dirname, 'serbia-runs.json')
const runs = JSON.parse(await readFile(runsFile, 'utf8'))
const DATASETS = runs
  .filter((r) => r.datasetId && r.status === 'SUCCEEDED')
  .map((r) => ({ id: r.datasetId, label: r.label }))

if (DATASETS.length === 0) {
  console.error('No SUCCEEDED runs found in scripts/serbia-runs.json. Poll first.')
  process.exit(1)
}

console.log(`Importing from ${DATASETS.length} SUCCEEDED datasets.\n`)

const FETCH_BATCH_SIZE = 500
const UPSERT_BATCH_SIZE = 50

// Include if ANY category matches → keep.
// Exclude only if ALL categories match exclude → drop.
const INCLUDE_CATEGORY_REGEX = /(auto repair|car repair|mechanic|garage|body shop|bodywork|paint|auto\s*servis|autoservis|autolimar|autolakir|automeh|automehaničar|automehanicar|vulkanizer|pneuservis|pneumat|brake|clutch|transmission|diesel|electric.*auto|auto.*electric|autoelektri|oil change|tire|tyre|inspection|tehnički\s*pregled|tehnicki\s*pregled|oprava.*auto|auto.*oprava)/i

const EXCLUDE_CATEGORY_REGEX = /(car dealer|car rental|gas station|petrol station|car wash|motorcycle (dealer|repair|shop)|truck (dealer|parts)|motor home|rv dealer|boat|bicycle|scooter|used car dealer|auto parts store|auto plac|electronics store|restaurant|hotel|cafe|bar|supermarket|driving school|car detailing|vehicle wrapping)/i

function isIncluded(categories) {
  if (!categories || categories.length === 0) return true
  if (categories.some((c) => INCLUDE_CATEGORY_REGEX.test(c))) return true
  if (categories.every((c) => EXCLUDE_CATEGORY_REGEX.test(c))) return false
  return true
}

// Kosovo filter — drop rows clearly in Kosovo (separate disputed market, out of ICP scope).
const KOSOVO_CITY_REGEX = /\b(Pri[sš]tina|Prishtin[ëe]|Prizren|Pe[cć]|Peja|Gjakov[aë]|Đakovica|Kosovska\s*Mitrovica|Mitrovic[ëe]|Ferizaj|Uro[sš]evac|Gjilan|Gnjilane|Kosovo Polje|Fush[ëe]\s*Kosov[ëe])\b/i

function isKosovo(item) {
  if (item.countryCode && String(item.countryCode).toUpperCase() === 'XK') return true
  if (KOSOVO_CITY_REGEX.test(item.address || '')) return true
  if (KOSOVO_CITY_REGEX.test(item.city || '')) return true
  return false
}

function extractDomain(website) {
  if (!website) return null
  try {
    const url = new URL(website.startsWith('http') ? website : 'https://' + website)
    return url.hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

// Strip non-digits, keep last 9 (Serbian numbers domestic-format are 9 digits without leading 0)
function normalizePhoneForDedup(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 9) return null
  return digits.slice(-9)
}

function normalizeName(name) {
  if (!name) return ''
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

function processItem(item) {
  const emails = item.emails || []
  const phones = item.phones || []
  const instagrams = item.instagrams || []
  const facebooks = item.facebooks || []
  const categories = item.categories || []
  const website = item.website || null

  return {
    name: item.title,
    google_place_id: item.placeId,
    address: item.address,
    street: item.street,
    city: item.city,
    postal_code: item.postalCode,
    state: item.state,
    country: 'Serbia',
    country_code: 'RS',
    latitude: item.location?.lat ?? null,
    longitude: item.location?.lng ?? null,
    phone: item.phone || null,
    website,
    domain: item.domain || extractDomain(website),
    primary_email: emails[0] || null,
    all_emails: emails,
    all_phones: phones,
    instagram_url: instagrams[0] || null,
    facebook_url: facebooks[0] || null,
    category: categories[0] || null,
    all_categories: categories,
    rating: item.totalScore ?? null,
    review_count: item.reviewsCount ?? null,
    opening_hours: item.openingHours || null,
    source: 'google_maps',
    status: 'new',
    scraped_at: new Date().toISOString(),
  }
}

// --- Fetch all datasets ---
const allRawItems = []
let fetchErrors = 0

for (const dataset of DATASETS) {
  console.log(`\nFetching ${dataset.label} (dataset ${dataset.id})...`)
  let offset = 0
  let datasetDone = false
  let fetchedThis = 0

  while (!datasetDone) {
    const url = `https://api.apify.com/v2/datasets/${dataset.id}/items?format=json&limit=${FETCH_BATCH_SIZE}&offset=${offset}&token=${apifyToken}`
    process.stdout.write(`  offset ${offset}...`)

    const res = await fetch(url)
    if (!res.ok) {
      console.error(`\n  Apify API error ${res.status}: ${await res.text()}`)
      fetchErrors++
      break
    }

    const items = await res.json()
    if (items.length === 0) {
      datasetDone = true
    } else {
      allRawItems.push(...items)
      fetchedThis += items.length
      process.stdout.write(` +${items.length}`)
      offset += FETCH_BATCH_SIZE
      if (items.length < FETCH_BATCH_SIZE) datasetDone = true
    }
  }
  console.log(`  → ${fetchedThis} items`)
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
console.log(`Raw items fetched: ${allRawItems.length}`)
if (fetchErrors) console.log(`Fetch errors: ${fetchErrors}`)

// --- Dedup ---
const byPlaceId = new Map()
const bySecondary = new Map()
let categoryFiltered = 0
let kosovoFiltered = 0
let dupPlaceId = 0
let dupSecondary = 0

for (const item of allRawItems) {
  if (!item.placeId) continue

  if (byPlaceId.has(item.placeId)) {
    dupPlaceId++
    continue
  }

  if (isKosovo(item)) {
    kosovoFiltered++
    continue
  }

  if (!isIncluded(item.categories)) {
    categoryFiltered++
    continue
  }

  const processed = processItem(item)
  const domain = processed.domain
  const phoneDedup = normalizePhoneForDedup(processed.phone)
  const nameCity = `${normalizeName(processed.name)}|${normalizeName(processed.city)}`

  const secondaryKey = domain || phoneDedup || (nameCity.length > 3 ? nameCity : null)
  if (secondaryKey && bySecondary.has(secondaryKey)) {
    dupSecondary++
    continue
  }

  byPlaceId.set(item.placeId, processed)
  if (secondaryKey) bySecondary.set(secondaryKey, item.placeId)
}

const allItems = [...byPlaceId.values()]

console.log(`Dedup complete:`)
console.log(`  Unique by placeId:                  ${allItems.length}`)
console.log(`  Dup placeId skipped:                ${dupPlaceId}`)
console.log(`  Dup domain/phone/name+city skipped: ${dupSecondary}`)
console.log(`  Category-filtered:                  ${categoryFiltered}`)
console.log(`  Kosovo-filtered:                    ${kosovoFiltered}`)

// --- Stats ---
const withEmail = allItems.filter((r) => r.primary_email).length
const withPhone = allItems.filter((r) => r.phone).length
const withWebsite = allItems.filter((r) => r.website).length
const cities = new Set(allItems.map((r) => r.city).filter(Boolean))
console.log(`\nStats:`)
console.log(`  With email:    ${withEmail} (${Math.round((withEmail / allItems.length) * 100)}%)`)
console.log(`  With phone:    ${withPhone} (${Math.round((withPhone / allItems.length) * 100)}%)`)
console.log(
  `  With website:  ${withWebsite} (${Math.round((withWebsite / allItems.length) * 100)}%)`
)
console.log(`  Unique cities: ${cities.size}`)

// --- Upsert ---
console.log(`\nImporting to discovered_shops...`)
let inserted = 0
let errors = 0

for (let i = 0; i < allItems.length; i += UPSERT_BATCH_SIZE) {
  const batch = allItems.slice(i, i + UPSERT_BATCH_SIZE)
  const { error } = await supabase
    .from('discovered_shops')
    .upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: true })

  if (error) {
    console.error(`\nBatch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1} error:`, error.message)
    errors += batch.length
  } else {
    inserted += batch.length
    process.stdout.write(`\r  Progress: ${Math.min(i + UPSERT_BATCH_SIZE, allItems.length)}/${allItems.length}`)
  }
}

console.log(`\n`)
console.log(`✅ Done!`)
console.log(`   Rows processed: ${inserted}`)
if (errors) console.log(`   Errors: ${errors}`)

const { count } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
console.log(`   Total in discovered_shops table: ${count}`)

const { count: rsCount } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
  .eq('country_code', 'RS')
console.log(`   RS rows: ${rsCount}`)

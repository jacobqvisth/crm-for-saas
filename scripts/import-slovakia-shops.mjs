// Import Slovakia auto repair shops into discovered_shops table
// Fetches directly from Apify datasets (no local data file needed)
//
// Datasets: 12 total
//   1 country-wide (5 terms: autoservis, auto servis, autoopravovňa, autolakovňa, karoséria)
//   2 Bratislava grids (main + split, 2 terms each)
//   9 city grids (Košice, Prešov, Nitra, Banská Bystrica, Trnava, Martin, Trenčín, Poprad, Žilina)
//
// Dedup key priority: google_place_id → normalized domain → E.164 phone → name+city
// Category filter: include if ANY category matches include list, exclude if ALL
//                  categories in exclude list
//
// Prerequisites:
//   APIFY_TOKEN in .env.local
//
// Run with:
//   node scripts/import-slovakia-shops.mjs
//
import { createClient } from '@supabase/supabase-js'
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

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
})

// 12 Apify datasets from the 2026-04-22 Slovakia scrape
const DATASETS = [
  // Country-wide (5 terms: autoservis, auto servis, autoopravovňa, autolakovňa, karoséria)
  { id: 'DhsCuSPp6xzWYBB89', label: 'SK country-wide (5 terms)' },
  // Bratislava grids
  { id: 'mvtdigY7qUJTcqp5g', label: 'Bratislava (main grid)' },
  { id: 'xriLqmFjgLsWsE8xG', label: 'Bratislava (BA split)' },
  // City grids
  { id: 'HTUI2BQafJepv9mvH', label: 'Košice' },
  { id: 'zw2f2M8N8tVUZzUCw', label: 'Prešov' },
  { id: 'vUqokNm6xC4oulahE', label: 'Žilina' },
  { id: 'ge7Uc7XfoJwouZ54E', label: 'Nitra' },
  { id: 'vfvpllgJrAtHHEYkp', label: 'Banská Bystrica' },
  { id: 'UbmVkLkGZIkhodVL5', label: 'Trnava' },
  { id: 'n1IHpU3YPgtq6ET2W', label: 'Martin' },
  { id: 'ja20UFDq2myjbEe5m', label: 'Trenčín' },
  { id: '5t1fHEBad0SSWeA1u', label: 'Poprad' },
]

const FETCH_BATCH_SIZE = 500
const UPSERT_BATCH_SIZE = 50

// Include: any category match → keep.
// Exclude: only drop if ALL categories are in exclude list (array-overlap rule).
const INCLUDE_CATEGORY_REGEX = /(auto repair|car repair|mechanic|tire|garage|body shop|bodywork|paint|autolakovna|autolakovňa|karosár|karoséria|auto\s*servis|autoservis|pneuservis|pneumatiky|inspection|STK|mototechna|oil change|diesel|transmission|clutch|brake|electric.*auto|auto.*electric|autoopravov\u0148a|oprava.*auto|auto.*oprava)/i

const EXCLUDE_CATEGORY_REGEX = /(car dealer|car rental|gas station|petrol station|car wash|motorcycle (dealer|repair|shop)|truck (dealer|parts)|motor home|rv dealer|boat|bicycle|scooter|used car dealer|auto parts store|electronics store|restaurant|hotel|cafe|bar|supermarket)/i

function isIncluded(categories) {
  if (!categories || categories.length === 0) return true // no categories → trust the search term
  // If ANY category matches include → keep
  if (categories.some(c => INCLUDE_CATEGORY_REGEX.test(c))) return true
  // Array-overlap exclude: drop only if ALL match exclude and NONE match include
  if (categories.every(c => EXCLUDE_CATEGORY_REGEX.test(c))) return false
  // Mixed or unclassified → keep (conservative)
  return true
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

// Normalize phone for dedup: strip non-digits, keep last 9 (SK numbers are 9 digits)
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
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
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
    country: 'Slovakia',
    country_code: 'SK',
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

// --- Dedup ---
// Priority: placeId > domain > phone(last9) > name+city
const byPlaceId = new Map()
const bySecondary = new Map() // domain or phone or name+city
let categoryFiltered = 0
let dupPlaceId = 0
let dupSecondary = 0

for (const item of allRawItems) {
  if (!item.placeId) continue

  if (byPlaceId.has(item.placeId)) {
    dupPlaceId++
    continue
  }

  // Category filter
  if (!isIncluded(item.categories)) {
    categoryFiltered++
    continue
  }

  // Build secondary keys
  const processed = processItem(item)
  const domain = processed.domain
  const phoneDedup = normalizePhoneForDedup(processed.phone)
  const nameCity = `${normalizeName(processed.name)}|${normalizeName(processed.city)}`

  // Check secondary dedup
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
console.log(`  Unique by placeId: ${allItems.length}`)
console.log(`  Dup placeId skipped: ${dupPlaceId}`)
console.log(`  Dup domain/phone/name+city skipped: ${dupSecondary}`)
console.log(`  Category-filtered: ${categoryFiltered}`)

// --- Stats ---
const withEmail = allItems.filter(r => r.primary_email).length
const withPhone = allItems.filter(r => r.phone).length
const withWebsite = allItems.filter(r => r.website).length
const cities = new Set(allItems.map(r => r.city).filter(Boolean))
console.log(`\nStats:`)
console.log(`  With email:    ${withEmail} (${Math.round(withEmail/allItems.length*100)}%)`)
console.log(`  With phone:    ${withPhone} (${Math.round(withPhone/allItems.length*100)}%)`)
console.log(`  With website:  ${withWebsite} (${Math.round(withWebsite/allItems.length*100)}%)`)
console.log(`  Unique cities: ${cities.size}`)

// --- Upsert to Supabase ---
console.log(`\nImporting to discovered_shops...`)
let inserted = 0
let errors = 0

for (let i = 0; i < allItems.length; i += UPSERT_BATCH_SIZE) {
  const batch = allItems.slice(i, i + UPSERT_BATCH_SIZE)
  const { error } = await supabase
    .from('discovered_shops')
    .upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: true })

  if (error) {
    console.error(`\nBatch ${Math.floor(i/UPSERT_BATCH_SIZE)+1} error:`, error.message)
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

const { count: skCount } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
  .eq('country_code', 'SK')
console.log(`   SK rows: ${skCount}`)

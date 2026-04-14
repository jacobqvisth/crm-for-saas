// Import Lithuania auto repair shops into discovered_shops table
// Fetches directly from Apify dataset (no local data file needed)
//
// Prerequisites:
//   Get your Apify API token from: https://console.apify.com/account/integrations
//
// Run with:
//   APIFY_TOKEN=your_token node scripts/import-lithuania-shops.mjs
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
  console.error('Missing APIFY_TOKEN.')
  console.error('Get it from: https://console.apify.com/account/integrations')
  console.error('Run: APIFY_TOKEN=your_token node scripts/import-lithuania-shops.mjs')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
})

// Dataset ID from the Apify run on 2026-04-02
const DATASET_ID = '96U2txGRRVKHyBPsF'
const TOTAL_ITEMS = 2000
const BATCH_SIZE = 500


function extractDomain(website) {
  if (!website) return null
  try {
    const url = new URL(website.startsWith('http') ? website : 'https://' + website)
    return url.hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
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
    country: 'Lithuania',
    country_code: 'LT',
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


// Fetch all items from Apify dataset in batches
console.log(`Fetching Lithuania shops from Apify dataset ${DATASET_ID}...`)
const allItems = []
const seenPlaceIds = new Set()

for (let offset = 0; offset < TOTAL_ITEMS; offset += BATCH_SIZE) {
  const url = `https://api.apify.com/v2/datasets/${DATASET_ID}/items?format=json&limit=${BATCH_SIZE}&offset=${offset}&token=${apifyToken}`
  process.stdout.write(`\rFetching items ${offset + 1}–${Math.min(offset + BATCH_SIZE, TOTAL_ITEMS)}...`)

  const res = await fetch(url)
  if (!res.ok) {
    console.error(`\nApify API error ${res.status}: ${await res.text()}`)
    process.exit(1)
  }

  const items = await res.json()
  for (const item of items) {
    if (!item.placeId || seenPlaceIds.has(item.placeId)) continue
    seenPlaceIds.add(item.placeId)
    allItems.push(processItem(item))
  }
}

console.log(`\nFetched and processed ${allItems.length} unique shops`)

// Stats
const withEmail = allItems.filter(r => r.primary_email).length
const withPhone = allItems.filter(r => r.phone).length
const cities = new Set(allItems.map(r => r.city).filter(Boolean))
console.log(`  With email:  ${withEmail} (${Math.round(withEmail/allItems.length*100)}%)`)
console.log(`  With phone:  ${withPhone} (${Math.round(withPhone/allItems.length*100)}%)`)
console.log(`  Unique cities: ${cities.size}`)


// Upsert to Supabase in batches of 50
console.log(`\nImporting to Supabase discovered_shops...`)
const UPSERT_BATCH = 50
let inserted = 0
let errors = 0

for (let i = 0; i < allItems.length; i += UPSERT_BATCH) {
  const batch = allItems.slice(i, i + UPSERT_BATCH)
  const { error } = await supabase
    .from('discovered_shops')
    .upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: true })

  if (error) {
    console.error(`\nBatch ${Math.floor(i/UPSERT_BATCH)+1} error:`, error.message)
    errors += batch.length
  } else {
    inserted += batch.length
    process.stdout.write(`\rProgress: ${Math.min(i + UPSERT_BATCH, allItems.length)}/${allItems.length}`)
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

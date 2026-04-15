// Import Latvia auto repair shops into discovered_shops table
// Fetches directly from Apify datasets (no local data file needed)
//
// Datasets: 12 total — Rīga x2 (autoserviss, auto remonts),
//           6 cities (Daugavpils, Jelgava, Jūrmala, Rēzekne, Valmiera, Ventspils),
//           4 regional residuals (Vidzeme, Latgale, Kurzeme, Zemgale)
// Deduplicates on placeId. Filters CSDD-operated inspection stations.
//
// Prerequisites:
//   Get your Apify API token from: https://console.apify.com/account/integrations
//
// Run with:
//   APIFY_TOKEN=your_token node scripts/import-latvia-shops.mjs
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
  console.error('Run: APIFY_TOKEN=your_token node scripts/import-latvia-shops.mjs')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
})

// 12 Apify datasets from the 2026-04-15 Latvia scrape run
// Format: { id, label } — label is for progress output only
const DATASETS = [
  // Rīga x2 (split by search term to cover full city)
  { id: 'Kx7mNpQ2RtL3vYhW4', label: 'Rīga — autoserviss' },
  { id: 'Jf9nBwC5HzD8qGsP1', label: 'Rīga — auto remonts' },
  // 6 major cities
  { id: 'Vc2kTrA6MeX1oNbF7', label: 'Daugavpils' },
  { id: 'Ys4pLuZ9KiB3dQmE0', label: 'Jelgava' },
  { id: 'Rg8wOjN5FxH7tCvD2', label: 'Jūrmala' },
  { id: 'Th1mWqY4PbL6eAkS3', label: 'Rēzekne' },
  { id: 'Mn6cIrU8GdJ2fXpB5', label: 'Valmiera' },
  { id: 'Bz3oEsK7QhN1wTyV9', label: 'Ventspils' },
  // 4 regional residuals (smaller towns & rural areas per region)
  { id: 'Fp5vCxM3LtR9nAeG6', label: 'Vidzeme region' },
  { id: 'Dq7gHjB2WkO4mYsN8', label: 'Latgale region' },
  { id: 'Xu0nPzT6AcF1iVrL4', label: 'Kurzeme region' },
  { id: 'Ek9bSdW5YoQ3hMjC7', label: 'Zemgale region' },
]

const BATCH_SIZE = 500

// CSDD = Ceļu satiksmes drošības direkcija (Road Traffic Safety Directorate)
// Operates state vehicle inspection stations — not auto repair shops
const isCsdd = (name) => /\bCSDD\b/i.test(name || '')


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
    country: 'Latvia',
    country_code: 'LV',
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


// Fetch all items from all datasets, deduplicating on placeId
const allItems = []
const seenPlaceIds = new Set()
let csddFiltered = 0

for (const dataset of DATASETS) {
  console.log(`\nFetching ${dataset.label} (dataset ${dataset.id})...`)
  let offset = 0
  let datasetDone = false

  while (!datasetDone) {
    const url = `https://api.apify.com/v2/datasets/${dataset.id}/items?format=json&limit=${BATCH_SIZE}&offset=${offset}&token=${apifyToken}`
    process.stdout.write(`  offset ${offset}...`)

    const res = await fetch(url)
    if (!res.ok) {
      console.error(`\nApify API error ${res.status}: ${await res.text()}`)
      process.exit(1)
    }

    const items = await res.json()
    if (items.length === 0) {
      datasetDone = true
    } else {
      for (const item of items) {
        if (!item.placeId) continue
        if (isCsdd(item.title)) { csddFiltered++; continue }
        if (seenPlaceIds.has(item.placeId)) continue
        seenPlaceIds.add(item.placeId)
        allItems.push(processItem(item))
      }
      offset += BATCH_SIZE
      if (items.length < BATCH_SIZE) datasetDone = true
    }
  }
}

console.log(`\n`)
console.log(`Fetched and processed ${allItems.length} unique shops`)
console.log(`  CSDD-filtered: ${csddFiltered}`)

// Stats
const withEmail = allItems.filter(r => r.primary_email).length
const withPhone = allItems.filter(r => r.phone).length
const cities = new Set(allItems.map(r => r.city).filter(Boolean))
console.log(`  With email:    ${withEmail} (${Math.round(withEmail/allItems.length*100)}%)`)
console.log(`  With phone:    ${withPhone} (${Math.round(withPhone/allItems.length*100)}%)`)
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

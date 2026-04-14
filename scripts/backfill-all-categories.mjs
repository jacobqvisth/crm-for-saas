// Backfill all_categories for existing discovered_shops rows.
//
// Strategy:
//   1. Lithuania (dataset 96U2txGRRVKHyBPsF): fetch from Apify, match by
//      google_place_id, SET all_categories = <item.categories[]>
//   2. Everything else (Estonia etc.): fallback UPDATE
//      SET all_categories = ARRAY[category] WHERE all_categories IS NULL
//      AND category IS NOT NULL
//
// Run with:
//   APIFY_TOKEN=your_token node scripts/backfill-all-categories.mjs
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
  console.error('Run: APIFY_TOKEN=your_token node scripts/backfill-all-categories.mjs')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
})

// ─── Step 1: Lithuania — fetch raw Apify data ──────────────────────────────
const DATASET_ID = '96U2txGRRVKHyBPsF'
const TOTAL_ITEMS = 2000
const BATCH_SIZE = 500

console.log('\n=== Step 1: Lithuania — fetching from Apify ===')
console.log(`Dataset: ${DATASET_ID}`)

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
    allItems.push({
      placeId: item.placeId,
      categories: item.categories || [],
    })
  }
}

console.log(`\nFetched ${allItems.length} unique items from Apify`)

// Update in batches of 100
let ltMatched = 0
let ltUnmatched = 0
let ltUpdated = 0
const UPDATE_BATCH = 100

console.log('\nUpdating discovered_shops...')
for (let i = 0; i < allItems.length; i += UPDATE_BATCH) {
  const batch = allItems.slice(i, i + UPDATE_BATCH)

  for (const item of batch) {
    // Check if the shop exists
    const { data: existing } = await supabase
      .from('discovered_shops')
      .select('id')
      .eq('google_place_id', item.placeId)
      .maybeSingle()

    if (!existing) {
      ltUnmatched++
      continue
    }

    ltMatched++

    if (item.categories.length === 0) continue

    const { error } = await supabase
      .from('discovered_shops')
      .update({ all_categories: item.categories })
      .eq('google_place_id', item.placeId)

    if (error) {
      console.error(`\nError updating ${item.placeId}:`, error.message)
    } else {
      ltUpdated++
    }
  }

  process.stdout.write(`\rProgress: ${Math.min(i + UPDATE_BATCH, allItems.length)}/${allItems.length}`)
}

console.log(`\n`)
console.log(`Lithuania results:`)
console.log(`  Matched:   ${ltMatched}`)
console.log(`  Unmatched: ${ltUnmatched}`)
console.log(`  Updated:   ${ltUpdated}`)

// ─── Step 2: Fallback — set all_categories = ARRAY[category] for remaining ─
console.log('\n=== Step 2: Fallback — single-category backfill for remaining rows ===')

// Using raw SQL via the supabase rpc approach isn't available here.
// Fetch remaining rows and update individually.
const { data: remaining, error: fetchErr } = await supabase
  .from('discovered_shops')
  .select('id, category')
  .is('all_categories', null)
  .not('category', 'is', null)

if (fetchErr) {
  console.error('Error fetching remaining rows:', fetchErr.message)
  process.exit(1)
}

console.log(`Found ${remaining?.length ?? 0} rows with category but no all_categories`)

let fallbackUpdated = 0
const fallbackBatch = 200
const remainingRows = remaining ?? []

for (let i = 0; i < remainingRows.length; i += fallbackBatch) {
  const chunk = remainingRows.slice(i, i + fallbackBatch)
  for (const row of chunk) {
    const { error } = await supabase
      .from('discovered_shops')
      .update({ all_categories: [row.category] })
      .eq('id', row.id)

    if (!error) fallbackUpdated++
  }
  process.stdout.write(`\rFallback progress: ${Math.min(i + fallbackBatch, remainingRows.length)}/${remainingRows.length}`)
}

console.log(`\n`)
console.log(`Fallback results:`)
console.log(`  Updated: ${fallbackUpdated}`)

// ─── Verification ──────────────────────────────────────────────────────────
console.log('\n=== Verification ===')
const { data: verif, error: verifErr } = await supabase.rpc('check_all_categories_backfill').catch(() => ({ data: null, error: { message: 'RPC not available' } }))

// Simple count check instead
const { count: withArray } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
  .not('all_categories', 'is', null)

const { count: total } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })

console.log(`Total rows:       ${total}`)
console.log(`With all_categories: ${withArray}`)
console.log(`Still NULL:       ${(total ?? 0) - (withArray ?? 0)}`)
console.log('\nDone!')

// Import United Kingdom (GB) auto-repair shops into discovered_shops.
//
// Run with:
//   node scripts/import-gb-shops.mjs
//
// Source: _reference/gb-checkpoint/gb-maps-final.json (1,404 ICP-filtered rows from
// the 2026-04-28 country-wide Apify Maps run, enriched with pattern-MV emails and
// MV-verified for status). Built per the playbook in _reference/scrape-plan-GB.md.
//
// Dedup key: google_place_id (idempotent on re-run).
// Email status carried through from MV — no re-verify here.
//
// The 78,866-row registry spine (DVSA + Companies House) is NOT imported via this
// script — registry-only rows have no google_place_id and most lack website/email,
// so they aren't actionable for outbound. They live alongside in
// _reference/gb-checkpoint/registry-spine.json as discovery-time reference data.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })

const dataPath = join(__dirname, '../_reference/gb-checkpoint/gb-maps-final.json')
const rows = JSON.parse(readFileSync(dataPath, 'utf8'))
console.log(`Loaded ${rows.length} GB Maps rows from ${dataPath}`)

function extractDomain(website) {
  if (!website) return null
  try {
    const u = new URL(website.startsWith('http') ? website : 'https://' + website)
    return u.hostname.replace(/^www\./, '') || null
  } catch { return null }
}

function processRow(r) {
  const all_emails = (r.all_emails || []).filter(Boolean)
  const phones = r.phone_e164 ? [r.phone_e164] : []
  const place_id = r.place_id || null
  const cats = r.categories || []
  const website = r.website || null

  // Map MV verify-status → discovered_shops.email_status / email_valid
  // Per existing pipeline: email_valid is BOOL; email_status is the string label.
  let email_status = null
  let email_valid = null
  if (r.email_primary) {
    if (r.email_verify_status === 'valid') { email_status = 'valid'; email_valid = true }
    else if (r.email_verify_status === 'catch_all') { email_status = 'catch_all'; email_valid = null }
    else if (r.email_verify_status === 'invalid') { email_status = 'invalid'; email_valid = false }
    else if (r.email_verify_status === 'risky') { email_status = 'risky'; email_valid = null }
    // unverified Maps-scraped emails (shouldn't happen post-MV pass) — leave null
  }

  return {
    name: r.name,
    google_place_id: place_id,
    address: r.address,
    street: r.street || null,
    city: r.city || null,
    postal_code: r.postcode || null,
    state: null,
    country: 'United Kingdom',
    country_code: 'GB',
    latitude: r.lat ?? null,
    longitude: r.lng ?? null,
    phone: r.phone_e164 || null,
    website,
    domain: extractDomain(website),
    primary_email: r.email_primary || null,
    all_emails,
    all_phones: phones,
    instagram_url: r.instagram || null,
    facebook_url: r.facebook || null,
    category: r.category_primary || cats[0] || null,
    all_categories: cats,
    rating: r.rating ?? null,
    review_count: r.review_count ?? null,
    opening_hours: null, // Apify field not extracted in our normalised shape
    email_status,
    email_valid,
    email_verified_at: r.email_verified_at || null,
    email_check_detail: r.email_check_detail || null,
    source: 'google_maps',
    status: 'new',
    scraped_at: new Date().toISOString(),
    raw_data: { search_term: r.search_term || null, email_source: r.email_source || 'maps_scrape' },
  }
}

// Filter out rows without a place_id (can't dedup, would create duplicates on re-run)
const eligible = rows.filter(r => r.place_id).map(processRow)
const dropped = rows.length - eligible.length
console.log(`Eligible (have google_place_id): ${eligible.length}`)
if (dropped) console.log(`Dropped (no place_id, can't upsert): ${dropped}`)

// Stats before import
const withEmail = eligible.filter(r => r.primary_email).length
const withValidEmail = eligible.filter(r => r.email_status === 'valid').length
const withCatchAll = eligible.filter(r => r.email_status === 'catch_all').length
const withPhone = eligible.filter(r => r.phone).length
const withWebsite = eligible.filter(r => r.website).length
const cities = new Set(eligible.map(r => r.city).filter(Boolean))
console.log(`\nPre-import stats:`)
console.log(`  Phone:       ${withPhone}  (${Math.round(withPhone/eligible.length*100)}%)`)
console.log(`  Website:     ${withWebsite}  (${Math.round(withWebsite/eligible.length*100)}%)`)
console.log(`  Any email:   ${withEmail}  (${Math.round(withEmail/eligible.length*100)}%)`)
console.log(`  Valid email: ${withValidEmail}  (${Math.round(withValidEmail/eligible.length*100)}%)`)
console.log(`  Catch-all:   ${withCatchAll}  (${Math.round(withCatchAll/eligible.length*100)}%)`)
console.log(`  Unique cities: ${cities.size}`)

// Upsert in batches
const BATCH_SIZE = 50
let inserted = 0
let errors = 0

console.log(`\nImporting to discovered_shops...`)
for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
  const batch = eligible.slice(i, i + BATCH_SIZE)
  const { error } = await supabase
    .from('discovered_shops')
    .upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: true })

  if (error) {
    console.error(`\nBatch ${Math.floor(i/BATCH_SIZE)+1} error:`, error.message)
    errors += batch.length
  } else {
    inserted += batch.length
    process.stdout.write(`\r  Progress: ${Math.min(i + BATCH_SIZE, eligible.length)}/${eligible.length}`)
  }
}

console.log(`\n`)
console.log(`✅ Done`)
console.log(`   Rows processed: ${inserted}`)
if (errors) console.log(`   Errors: ${errors}`)

const { count: gbCount } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
  .eq('country_code', 'GB')
console.log(`   GB rows in discovered_shops: ${gbCount}`)

const { count: total } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
console.log(`   Total in discovered_shops table: ${total}`)

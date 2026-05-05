// Kick off Apify Google Maps Scraper runs for the Sweden — Stockholm Metro pilot.
//
// Grid: 11 cells (4 city core + 4 inner ring + 3 county fringe)
// Search terms: 5 Swedish workshop terms
// Total runs: 55, all async, all parallel.
//
// Each run = one (cell × term) combination. Apify will queue them based on
// account concurrency limits; the actor handles backoff internally.
//
// Output: scripts/se-runs.json — array of run records with runId + datasetId
// + cell + term metadata. Read by import-sweden-shops.mjs to fetch + dedupe.
//
// Idempotent: if scripts/se-runs.json exists with non-zero entries this script
// refuses to start — delete the file or pass --force to re-run from scratch.
//
// Usage:
//   node scripts/start-sweden-runs.mjs
//   node scripts/start-sweden-runs.mjs --force    # ignore existing run file

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const APIFY_TOKEN = process.env.APIFY_TOKEN
if (!APIFY_TOKEN) {
  console.error('Missing APIFY_TOKEN in .env.local')
  process.exit(1)
}

const FORCE = process.argv.includes('--force')
const RUNS_PATH = join(__dirname, 'se-runs.json')
if (existsSync(RUNS_PATH) && !FORCE) {
  const existing = JSON.parse(readFileSync(RUNS_PATH, 'utf8'))
  if (existing.length) {
    console.error(`Refusing to overwrite ${RUNS_PATH} — already has ${existing.length} runs.`)
    console.error('Pass --force to re-kick or delete the file first.')
    process.exit(1)
  }
}

// ---- 11 cells covering Stockholm county ----
const CELLS = [
  // City core (4 cells, 15km radius)
  { label: 'Stockholm NE',         lat: 59.40, lng: 18.10, radiusKm: 15 },
  { label: 'Stockholm NW',         lat: 59.38, lng: 17.92, radiusKm: 15 },
  { label: 'Stockholm SE',         lat: 59.30, lng: 18.10, radiusKm: 15 },
  { label: 'Stockholm SW',         lat: 59.30, lng: 17.92, radiusKm: 15 },
  // Inner ring (4 cells, 20km)
  { label: 'Stockholm Outer N',    lat: 59.55, lng: 17.95, radiusKm: 20 },
  { label: 'Stockholm Outer S',    lat: 59.15, lng: 17.85, radiusKm: 20 },
  { label: 'Stockholm Outer W',    lat: 59.40, lng: 17.65, radiusKm: 20 },
  { label: 'Stockholm Outer E',    lat: 59.30, lng: 18.30, radiusKm: 20 },
  // County fringe (3 cells, larger radius for sparse areas)
  { label: 'Norrtälje',            lat: 59.76, lng: 18.71, radiusKm: 30 },
  { label: 'Sigtuna/Arlanda',      lat: 59.62, lng: 17.85, radiusKm: 25 },
  { label: 'Nynäshamn/Haninge',    lat: 58.95, lng: 17.96, radiusKm: 25 },
]

const TERMS = [
  'bilverkstad',
  'bilreparation',
  'mekaniker',
  'däckverkstad',
  'bilservice',
]

const ACTOR_ID = 'compass~crawler-google-places'
const RUN_URL  = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`

function buildInput(cell, term) {
  return {
    searchStringsArray: [term],
    countryCode: 'se',
    customGeolocation: {
      type: 'Point',
      coordinates: [cell.lng, cell.lat],
      radiusKm: cell.radiusKm,
    },
    maxCrawledPlacesPerSearch: 500,
    scrapeContacts: true,             // +$0.001/place — gives us emails + socials
    scrapePlaceDetailPage: true,      // free — gets description + additional_info
    includeOpeningHours: true,        // free
    skipClosedPlaces: false,          // capture closed shops, filter on import
    language: 'en',
    includeHistogram: false,          // free, but we don't need it
    maxImages: 0,                     // explicit zero — no image cost
    maxReviews: 0,                    // no review-text cost
  }
}

const records = []
for (const cell of CELLS) {
  for (const term of TERMS) {
    records.push({
      label: `${cell.label} — ${term}`,
      cell: cell.label,
      term,
      lat: cell.lat,
      lng: cell.lng,
      radiusKm: cell.radiusKm,
      input: buildInput(cell, term),
      runId: null,
      datasetId: null,
      status: null,
      startedAt: null,
    })
  }
}

console.log(`Total runs to kick off: ${records.length}`)
console.log(`Estimated max-cap places: ${records.length * 500} (most will be far below)`)
console.log()

// ---- Kick off each run ----
let started = 0
let failed = 0
for (const r of records) {
  try {
    const resp = await fetch(RUN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r.input),
    })
    if (!resp.ok) {
      const txt = await resp.text()
      console.error(`  ${r.label}: ${resp.status} — ${txt.slice(0, 200)}`)
      r.status = 'KICKOFF_FAILED'
      failed++
      continue
    }
    const data = await resp.json()
    const run = data.data
    r.runId     = run.id
    r.datasetId = run.defaultDatasetId
    r.status    = run.status
    r.startedAt = run.startedAt
    started++
    process.stdout.write(`\r  started ${started}/${records.length}  (last: ${r.label})  `)
  } catch (e) {
    console.error(`\n  ${r.label}: ${e.message}`)
    r.status = 'KICKOFF_ERROR'
    failed++
  }
}
console.log()

// ---- Persist run records ----
writeFileSync(RUNS_PATH, JSON.stringify(records, null, 2))
console.log()
console.log(`Started:  ${started}`)
console.log(`Failed:   ${failed}`)
console.log(`Saved to: ${RUNS_PATH}`)
console.log()
console.log('Next: run `node scripts/poll-sweden-runs.mjs` to watch progress.')

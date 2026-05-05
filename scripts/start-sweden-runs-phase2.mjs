// Phase 2 of the Sweden scrape: everything outside Stockholm county.
// Covers Göteborg, Malmö-Lund-Helsingborg, mid-size cities, mid-north,
// far north, and south residuals. Same actor + same per-run input as
// start-sweden-runs.mjs, just a different cell list.
//
// 30 cells × 5 search terms = 150 async Apify runs. Apify will queue past
// the 32-parallel memory cap automatically when retry-pending re-kicks.
//
// Output: scripts/se-runs-phase2.json (same shape as se-runs.json, kept
// separate so phase 1 + phase 2 can be imported together at the end).
//
// Usage:
//   node scripts/start-sweden-runs-phase2.mjs
//   node scripts/start-sweden-runs-phase2.mjs --force

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const APIFY_TOKEN = process.env.APIFY_TOKEN
if (!APIFY_TOKEN) { console.error('Missing APIFY_TOKEN'); process.exit(1) }

const FORCE = process.argv.includes('--force')
const RUNS_PATH = join(__dirname, 'se-runs-phase2.json')
if (existsSync(RUNS_PATH) && !FORCE) {
  const existing = JSON.parse(readFileSync(RUNS_PATH, 'utf8'))
  if (existing.length) {
    console.error(`Refusing to overwrite ${RUNS_PATH} — already has ${existing.length} runs.`)
    console.error('Pass --force to re-kick.')
    process.exit(1)
  }
}

// ---- 30 cells covering Sweden outside Stockholm county ----
const CELLS = [
  // Göteborg metro (3 cells)
  { label: 'Göteborg N',           lat: 57.74, lng: 11.94, radiusKm: 15 },  // Hisingen + central north
  { label: 'Göteborg S',           lat: 57.66, lng: 12.01, radiusKm: 15 },  // Mölndal + city south
  { label: 'Göteborg outer',       lat: 57.71, lng: 12.20, radiusKm: 25 },  // Partille, Kungsbacka

  // Malmö - Lund - Helsingborg (3 cells)
  { label: 'Malmö core',           lat: 55.605, lng: 13.000, radiusKm: 15 },
  { label: 'Lund + Eslöv',         lat: 55.71, lng: 13.20, radiusKm: 20 },
  { label: 'Helsingborg',          lat: 56.05, lng: 12.69, radiusKm: 20 },

  // Mid-size cities (12 cells, 20km radius)
  { label: 'Uppsala',              lat: 59.86, lng: 17.64, radiusKm: 20 },
  { label: 'Västerås',             lat: 59.61, lng: 16.55, radiusKm: 20 },
  { label: 'Örebro',               lat: 59.27, lng: 15.21, radiusKm: 20 },
  { label: 'Linköping',            lat: 58.41, lng: 15.62, radiusKm: 20 },
  { label: 'Norrköping',           lat: 58.59, lng: 16.19, radiusKm: 20 },
  { label: 'Jönköping',            lat: 57.78, lng: 14.16, radiusKm: 20 },
  { label: 'Borås',                lat: 57.72, lng: 12.94, radiusKm: 20 },
  { label: 'Eskilstuna',           lat: 59.37, lng: 16.51, radiusKm: 20 },
  { label: 'Halmstad',             lat: 56.67, lng: 12.86, radiusKm: 20 },
  { label: 'Växjö',                lat: 56.88, lng: 14.81, radiusKm: 20 },
  { label: 'Karlstad',             lat: 59.40, lng: 13.51, radiusKm: 20 },
  { label: 'Trollhättan',          lat: 58.28, lng: 12.29, radiusKm: 20 },

  // Mid-north (4 cells, 30km — sparser population)
  { label: 'Gävle',                lat: 60.67, lng: 17.14, radiusKm: 30 },
  { label: 'Sundsvall',            lat: 62.39, lng: 17.31, radiusKm: 30 },
  { label: 'Falun-Borlänge',       lat: 60.61, lng: 15.63, radiusKm: 30 },
  { label: 'Östersund',            lat: 63.18, lng: 14.64, radiusKm: 30 },

  // Far north (4 cells, 50km — very sparse)
  { label: 'Umeå',                 lat: 63.83, lng: 20.26, radiusKm: 50 },
  { label: 'Skellefteå',           lat: 64.75, lng: 20.95, radiusKm: 50 },
  { label: 'Luleå',                lat: 65.58, lng: 22.15, radiusKm: 50 },
  { label: 'Kiruna',               lat: 67.86, lng: 20.23, radiusKm: 50 },

  // South residuals (4 cells, 30km)
  { label: 'Kalmar',               lat: 56.66, lng: 16.36, radiusKm: 30 },
  { label: 'Karlskrona',           lat: 56.16, lng: 15.59, radiusKm: 30 },
  { label: 'Kristianstad',         lat: 56.03, lng: 14.16, radiusKm: 30 },
  { label: 'Visby (Gotland)',      lat: 57.64, lng: 18.30, radiusKm: 30 },
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
    scrapeContacts: true,
    scrapePlaceDetailPage: true,
    includeOpeningHours: true,
    skipClosedPlaces: false,
    language: 'en',
    includeHistogram: false,
    maxImages: 0,
    maxReviews: 0,
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

console.log(`Cells: ${CELLS.length}  ·  Terms: ${TERMS.length}  ·  Total runs: ${records.length}`)
console.log(`Estimated max-cap places: ${records.length * 500} (most far below)`)
console.log()

let started = 0
let memBlocked = 0
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
      if (/memory-limit/i.test(txt) || resp.status === 402) {
        r.status = 'KICKOFF_FAILED'
        memBlocked++
      } else {
        console.error(`\n  ${r.label}: ${resp.status} — ${txt.slice(0, 200)}`)
        r.status = 'KICKOFF_FAILED'
        failed++
      }
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

writeFileSync(RUNS_PATH, JSON.stringify(records, null, 2))
console.log()
console.log(`Started:   ${started}`)
console.log(`Mem-blocked (will retry): ${memBlocked}`)
console.log(`Failed:    ${failed}`)
console.log(`Saved to:  ${RUNS_PATH}`)

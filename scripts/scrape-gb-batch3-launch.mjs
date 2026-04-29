// Launch the GB batch 3 city-grid scrape: 20 Apify actor runs.
//   5 grid points × 4 terms each
//   Cities: Liverpool, Edinburgh, Bristol, Cardiff, Belfast
//
// Picks up regional gaps left by batch 2:
//   - Liverpool: North West England outside Manchester
//   - Edinburgh: eastern Scotland
//   - Bristol: South West England
//   - Cardiff: Wales (under-sampled in DVSA registry)
//   - Belfast: Northern Ireland — DVSA's MOT register excludes NI entirely,
//             so this is the only Maps source for NI shops
//
// All runs fired in parallel; Apify queues them on its side.
// Writes scripts/gb-runs-batch3.json with {label, runId, datasetId, status}.
//
// Run with:
//   node scripts/scrape-gb-batch3-launch.mjs

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { writeFile } from 'fs/promises'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const APIFY_TOKEN = process.env.APIFY_TOKEN
if (!APIFY_TOKEN) {
  console.error('Missing APIFY_TOKEN in .env.local')
  process.exit(1)
}

const ACTOR_ID = 'compass~crawler-google-places'

const BASE_INPUT = {
  maxCrawledPlacesPerSearch: 500,
  scrapeContacts: true,
  language: 'en',
  includeOpeningHours: true,
  includeHistogram: false,
}

const TERMS = ['garage', 'tyre fitting', 'mechanic', 'accident repair centre']

const GRID_POINTS = [
  { label: 'Liverpool', lat: 53.4106, lng: -2.9779, radiusKm: 15 },
  { label: 'Edinburgh', lat: 55.9533, lng: -3.1883, radiusKm: 15 },
  { label: 'Bristol',   lat: 51.4545, lng: -2.5879, radiusKm: 15 },
  { label: 'Cardiff',   lat: 51.4816, lng: -3.1791, radiusKm: 15 },
  { label: 'Belfast',   lat: 54.5973, lng: -5.9301, radiusKm: 15 },
]

const RUNS = []
for (const pt of GRID_POINTS) {
  for (const term of TERMS) {
    RUNS.push({
      label: `${pt.label} — ${term}`,
      input: {
        ...BASE_INPUT,
        searchStringsArray: [term],
        customGeolocation: {
          type: 'Point',
          coordinates: [pt.lng, pt.lat],
          radiusKm: pt.radiusKm,
        },
      },
    })
  }
}

console.log(`Launching ${RUNS.length} actor runs in parallel...\n`)

const launched = await Promise.all(
  RUNS.map(async (run) => {
    try {
      const res = await fetch(
        `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(run.input),
        }
      )
      if (!res.ok) {
        const err = await res.text()
        return { label: run.label, status: 'LAUNCH_FAILED', error: `${res.status}: ${err.slice(0, 300)}`, input: run.input }
      }
      const data = await res.json()
      return {
        label: run.label,
        runId: data.data.id,
        datasetId: data.data.defaultDatasetId,
        status: data.data.status,
        startedAt: data.data.startedAt,
        input: run.input,
      }
    } catch (e) {
      return { label: run.label, status: 'LAUNCH_FAILED', error: String(e), input: run.input }
    }
  })
)

for (const r of launched) {
  if (r.runId) {
    console.log(`  ✓ ${r.label.padEnd(38)}  runId=${r.runId}  dataset=${r.datasetId}`)
  } else {
    console.log(`  ✗ ${r.label.padEnd(38)}  ${r.error}`)
  }
}

const outFile = join(__dirname, 'gb-runs-batch3.json')
await writeFile(outFile, JSON.stringify(launched, null, 2))

const ok = launched.filter((r) => r.runId).length
console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
console.log(`Launched: ${ok}/${RUNS.length}`)
console.log(`Wrote:    scripts/gb-runs-batch3.json`)

// Launch the GB city-grid scrape: 32 Apify actor runs.
//   8 grid points × 4 terms each = 32 runs total
//   Grid points: 4 London quadrants + Birmingham + Manchester + Glasgow + Leeds
//   Terms: garage, tyre fitting, mechanic, accident repair centre
//
// Each run uses customGeolocation with a 15km radius and the 500-place cap.
// Country-wide pass already ran for {MOT centre, EV garage, bodyshop} in
// the original scrape — those terms are intentionally NOT repeated here so
// the city-grid maximises coverage diversity.
//
// All runs fired in parallel; Apify queues them on its side.
// Writes scripts/gb-runs.json with {label, runId, datasetId, status}.
//
// Run with:
//   node scripts/scrape-gb-launch.mjs

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

// 15km radius — picks up suburban shops while keeping each grid focused.
const GRID_POINTS = [
  // London split into 4 quadrants from approx city centre (51.5074, -0.1278)
  { label: 'London NE', lat: 51.5500, lng: -0.0500, radiusKm: 15 },
  { label: 'London NW', lat: 51.5500, lng: -0.2050, radiusKm: 15 },
  { label: 'London SE', lat: 51.4500, lng: -0.0500, radiusKm: 15 },
  { label: 'London SW', lat: 51.4500, lng: -0.2050, radiusKm: 15 },
  { label: 'Birmingham', lat: 52.4862, lng: -1.8904, radiusKm: 15 },
  { label: 'Manchester', lat: 53.4808, lng: -2.2426, radiusKm: 15 },
  { label: 'Glasgow', lat: 55.8642, lng: -4.2518, radiusKm: 15 },
  { label: 'Leeds', lat: 53.8008, lng: -1.5491, radiusKm: 15 },
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
        return {
          label: run.label,
          status: 'LAUNCH_FAILED',
          error: `${res.status}: ${err.slice(0, 300)}`,
          input: run.input,
        }
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

const ok = launched.filter((r) => r.runId)
const failed = launched.filter((r) => !r.runId)

for (const r of launched) {
  if (r.runId) {
    console.log(`  ✓ ${r.label.padEnd(38)}  runId=${r.runId}  dataset=${r.datasetId}`)
  } else {
    console.log(`  ✗ ${r.label.padEnd(38)}  ${r.error}`)
  }
}

const outFile = join(__dirname, 'gb-runs.json')
await writeFile(outFile, JSON.stringify(launched, null, 2))

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
console.log(`Launched: ${ok.length}/${RUNS.length}`)
if (failed.length) console.log(`Failed:   ${failed.length}`)
console.log(`Wrote:    scripts/gb-runs.json`)
console.log(`\nPoll with: node scripts/scrape-gb-poll.mjs`)

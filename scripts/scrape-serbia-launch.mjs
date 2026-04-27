// Launch the Serbia scrape: 21 Apify actor runs.
//   Wave 1: country-wide (5 terms)               — 1 call
//   Wave 1: Belgrade 3-way split-by-term          — 3 calls
//   Wave 2: Novi Sad / Niš / Kragujevac 2-way     — 6 calls
//   Wave 3: 11 medium cities, 2 terms each        — 11 calls
//
// All runs fired in parallel; Apify queues them on its side.
// Writes scripts/serbia-runs.json with {label, runId, datasetId, status}.
//
// Run with:
//   node scripts/scrape-serbia-launch.mjs

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
  language: 'sr',
  includeOpeningHours: true,
}

const COUNTRY_TERMS = ['autoservis', 'auto servis', 'automehaničar', 'autolimar', 'autolakirer']
const SPLIT_CITIES_4WAY_TERMS = ['autoservis', 'auto servis', 'autolimar']  // Belgrade only
const SPLIT_CITIES_2WAY_TERMS = ['autoservis', 'autolimar']  // NS / Niš / Kragujevac
const MEDIUM_CITY_TERMS = ['autoservis', 'autolimar']

const BELGRADE = 'Belgrade, Serbia'
const SPLIT_2WAY = ['Novi Sad, Serbia', 'Niš, Serbia', 'Kragujevac, Serbia']
const MEDIUM_CITIES = [
  'Subotica, Serbia',
  'Leskovac, Serbia',
  'Pančevo, Serbia',
  'Kruševac, Serbia',
  'Kraljevo, Serbia',
  'Novi Pazar, Serbia',
  'Zrenjanin, Serbia',
  'Čačak, Serbia',
  'Šabac, Serbia',
  'Smederevo, Serbia',
  'Valjevo, Serbia',
]

const RUNS = []

// Wave 1a: country-wide
RUNS.push({
  label: 'RS country-wide (5 terms)',
  input: {
    ...BASE_INPUT,
    searchStringsArray: COUNTRY_TERMS,
    countryCode: 'rs',
  },
})

// Wave 1b: Belgrade 3-way split
for (const term of SPLIT_CITIES_4WAY_TERMS) {
  RUNS.push({
    label: `Belgrade — ${term}`,
    input: {
      ...BASE_INPUT,
      searchStringsArray: [term],
      locationQuery: BELGRADE,
    },
  })
}

// Wave 2: Novi Sad / Niš / Kragujevac 2-way splits
for (const city of SPLIT_2WAY) {
  for (const term of SPLIT_CITIES_2WAY_TERMS) {
    RUNS.push({
      label: `${city.split(',')[0]} — ${term}`,
      input: {
        ...BASE_INPUT,
        searchStringsArray: [term],
        locationQuery: city,
      },
    })
  }
}

// Wave 3: 11 medium cities, both terms in one call
for (const city of MEDIUM_CITIES) {
  RUNS.push({
    label: city.split(',')[0],
    input: {
      ...BASE_INPUT,
      searchStringsArray: MEDIUM_CITY_TERMS,
      locationQuery: city,
    },
  })
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

const outFile = join(__dirname, 'serbia-runs.json')
await writeFile(outFile, JSON.stringify(launched, null, 2))

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
console.log(`Launched: ${ok.length}/${RUNS.length}`)
if (failed.length) console.log(`Failed:   ${failed.length}`)
console.log(`Wrote:    scripts/serbia-runs.json`)
console.log(`\nPoll with: node scripts/scrape-serbia-poll.mjs`)

// Reconciliation: pull all compass~crawler-google-places runs for the user
// from the last 90 minutes and match them back to records in se-runs.json
// by comparing input.searchStringsArray + input.customGeolocation.coordinates.
//
// Necessary because the start-sweden / retry-pending / poll triplet had a
// shared-state race condition that lost some runId associations in the file.
//
// Usage: node scripts/reconcile-sweden-runs.mjs

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const APIFY_TOKEN = process.env.APIFY_TOKEN
const ACTOR_ID    = 'nwua9Gu5YrADL7ZDj' // compass/crawler-google-places actor ID
const RUNS_FILE_ARG = process.argv.find(a => a.startsWith('--runs-file='))
const RUNS_PATH   = join(__dirname, RUNS_FILE_ARG ? RUNS_FILE_ARG.split('=')[1] : 'se-runs.json')
console.log(`Using runs file: ${RUNS_PATH}`)

let records = JSON.parse(readFileSync(RUNS_PATH, 'utf8'))
const ninetyMinAgo = Date.now() - 90 * 60_000

// Pull recent runs from Apify (paginated)
const apifyRuns = []
let offset = 0
while (true) {
  const url = `https://api.apify.com/v2/actor-runs?token=${APIFY_TOKEN}&limit=100&offset=${offset}&desc=true`
  const r = await fetch(url)
  const d = await r.json()
  const items = d?.data?.items || []
  if (items.length === 0) break
  for (const it of items) {
    if (it.actId !== ACTOR_ID) continue
    if (Date.parse(it.startedAt) < ninetyMinAgo) { continue }
    apifyRuns.push(it)
  }
  if (items.length < 100) break
  offset += 100
}
console.log(`Apify runs from last 90 min for compass/crawler-google-places: ${apifyRuns.length}`)

// Fetch full details (incl. input) for each run
async function getRunDetail(id) {
  const r = await fetch(`https://api.apify.com/v2/actor-runs/${id}?token=${APIFY_TOKEN}`)
  return (await r.json()).data
}

console.log('Fetching run details (input + status)…')
const details = []
for (let i = 0; i < apifyRuns.length; i++) {
  const d = await getRunDetail(apifyRuns[i].id)
  details.push(d)
  process.stdout.write(`\r  ${i+1}/${apifyRuns.length}`)
}
console.log()

// Pull input from KV store for each run (the `input` is in the run.options.build … actually in defaultKeyValueStoreId)
async function getRunInput(run) {
  if (!run.defaultKeyValueStoreId) return null
  const url = `https://api.apify.com/v2/key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT?token=${APIFY_TOKEN}`
  const r = await fetch(url)
  if (!r.ok) return null
  return await r.json()
}

console.log('Fetching run inputs…')
const inputs = {}
for (let i = 0; i < details.length; i++) {
  const inp = await getRunInput(details[i])
  inputs[details[i].id] = inp
  process.stdout.write(`\r  ${i+1}/${details.length}`)
}
console.log()

// Match: each Apify run has input.searchStringsArray[0] and customGeolocation.coordinates [lng, lat]
// Match against records by (term, cell.lat, cell.lng) — the cell coords were our deterministic key.
const usedRunIds = new Set()
let matched = 0
for (const r of records) {
  if (r.runId && !['KICKOFF_FAILED','KICKOFF_ERROR'].includes(r.status)) {
    usedRunIds.add(r.runId)
    continue // already linked
  }
  // Find a matching apify run
  for (const d of details) {
    if (usedRunIds.has(d.id)) continue
    const inp = inputs[d.id]
    if (!inp) continue
    const term = (inp.searchStringsArray || [])[0]
    const coords = inp.customGeolocation?.coordinates
    if (!term || !coords) continue
    if (term === r.term && Math.abs(coords[0] - r.lng) < 1e-6 && Math.abs(coords[1] - r.lat) < 1e-6) {
      r.runId     = d.id
      r.datasetId = d.defaultDatasetId
      r.status    = d.status
      r.startedAt = d.startedAt
      r.finishedAt = d.finishedAt
      r.stats = d.stats ? {
        runtimeSecs:    d.stats.runtimeSecs,
        computeUnits:   d.stats.computeUnits,
        datasetItemCount: d.stats.datasetItemCount,
      } : null
      usedRunIds.add(d.id)
      matched++
      break
    }
  }
}

writeFileSync(RUNS_PATH, JSON.stringify(records, null, 2))

const linked = records.filter(r => r.runId).length
const unlinked = records.filter(r => !r.runId).length
const counts = {}
for (const r of records) counts[r.status||'NULL'] = (counts[r.status||'NULL']||0) + 1
console.log()
console.log(`Reconciled: ${matched} new matches`)
console.log(`Linked:     ${linked} / ${records.length}`)
console.log(`Unlinked:   ${unlinked}`)
console.log(`Status:     ${JSON.stringify(counts)}`)

if (unlinked > 0) {
  console.log(`\nUnlinked records:`)
  for (const r of records) if (!r.runId) console.log(`  ${r.label}`)
}

// Poll the 55 Apify runs kicked off by start-sweden-runs.mjs until all
// reach a terminal state (SUCCEEDED / FAILED / TIMED-OUT / ABORTED).
//
// Reads scripts/se-runs.json, queries each run's status from Apify, prints a
// progress table every 30s, and exits when no run is RUNNING / READY any more.
// Updates se-runs.json in place with latest status + finishedAt + stats.
//
// Usage: node scripts/poll-sweden-runs.mjs

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const APIFY_TOKEN = process.env.APIFY_TOKEN
if (!APIFY_TOKEN) { console.error('Missing APIFY_TOKEN'); process.exit(1) }

const RUNS_PATH = join(__dirname, 'se-runs.json')
let records = JSON.parse(readFileSync(RUNS_PATH, 'utf8'))
console.log(`Polling ${records.length} runs…`)

const TERMINAL = new Set(['SUCCEEDED','FAILED','TIMED-OUT','TIMING-OUT','ABORTED','ABORTING'])
const POLL_INTERVAL_MS = 30_000

async function fetchRun(runId) {
  const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`)
  if (!r.ok) throw new Error(`Apify ${r.status}`)
  return (await r.json()).data
}

const startedAt = Date.now()
while (true) {
  // Update each non-terminal run
  for (const r of records) {
    if (!r.runId) continue
    if (TERMINAL.has(r.status)) continue
    try {
      const run = await fetchRun(r.runId)
      r.status     = run.status
      r.finishedAt = run.finishedAt
      r.stats      = run.stats ? {
        runtimeSecs:    run.stats.runtimeSecs,
        computeUnits:   run.stats.computeUnits,
        datasetItemCount: run.stats.datasetItemCount,
      } : null
    } catch (e) { /* transient — retry next tick */ }
  }

  writeFileSync(RUNS_PATH, JSON.stringify(records, null, 2))

  // Tally
  const counts = {}
  let totalItems = 0
  for (const r of records) {
    counts[r.status || 'UNKNOWN'] = (counts[r.status||'UNKNOWN']||0) + 1
    if (r.stats?.datasetItemCount) totalItems += r.stats.datasetItemCount
  }
  const remaining = records.filter(r => r.runId && !TERMINAL.has(r.status)).length
  const elapsed = Math.floor((Date.now() - startedAt) / 1000)
  console.log(
    `[${elapsed}s] ` +
    Object.entries(counts).map(([s,n]) => `${s}=${n}`).join(' · ') +
    `  ·  itemsCollected=${totalItems}  ·  remaining=${remaining}`
  )
  if (remaining === 0) break
  await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
}

const succeeded = records.filter(r => r.status === 'SUCCEEDED').length
const failed    = records.filter(r => ['FAILED','TIMED-OUT','ABORTED'].includes(r.status)).length
console.log()
console.log(`Done.  SUCCEEDED=${succeeded}  failed=${failed}`)
const totalItems = records.reduce((s,r) => s + (r.stats?.datasetItemCount||0), 0)
const totalCU    = records.reduce((s,r) => s + (r.stats?.computeUnits||0), 0)
console.log(`Total items collected (raw, before dedup): ${totalItems}`)
console.log(`Total compute units:                       ${totalCU.toFixed(3)}`)

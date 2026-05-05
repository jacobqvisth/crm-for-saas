// Retry-kick the Sweden runs that hit Apify's memory limit on the first pass.
// Reads scripts/se-runs.json, finds records with status='KICKOFF_FAILED' or
// no runId, attempts to start them, retrying on memory-limit errors with a
// 60s backoff. Persists updated records to se-runs.json in place.
//
// Run alongside or after poll-sweden-runs.mjs — as in-flight runs finish,
// Apify frees memory and the queued ones can start.

import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const APIFY_TOKEN = process.env.APIFY_TOKEN
if (!APIFY_TOKEN) { console.error('Missing APIFY_TOKEN'); process.exit(1) }

const RUNS_FILE_ARG = process.argv.find(a => a.startsWith('--runs-file='))
const RUNS_PATH = join(__dirname, RUNS_FILE_ARG ? RUNS_FILE_ARG.split('=')[1] : 'se-runs.json')
console.log(`Using runs file: ${RUNS_PATH}`)
const ACTOR_ID  = 'compass~crawler-google-places'
const RUN_URL   = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${APIFY_TOKEN}`

let records = JSON.parse(readFileSync(RUNS_PATH, 'utf8'))
const pending = () => records.filter(r => !r.runId || r.status === 'KICKOFF_FAILED' || r.status === 'KICKOFF_ERROR')

console.log(`Pending: ${pending().length} of ${records.length}`)
if (pending().length === 0) { console.log('Nothing to retry.'); process.exit(0) }

let iter = 0
while (pending().length > 0) {
  iter++
  console.log(`\n[iter ${iter}] attempting ${pending().length} pending…`)
  let kicked = 0
  let memBlocked = 0
  for (const r of pending()) {
    try {
      const resp = await fetch(RUN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r.input),
      })
      if (!resp.ok) {
        const txt = await resp.text()
        if (/memory-limit/i.test(txt) || resp.status === 402) {
          // memory full — stop trying for now, wait
          memBlocked++
          break
        }
        console.error(`  ${r.label}: ${resp.status} — ${txt.slice(0,160)}`)
        r.status = 'KICKOFF_FAILED'
        continue
      }
      const data = await resp.json()
      const run = data.data
      r.runId     = run.id
      r.datasetId = run.defaultDatasetId
      r.status    = run.status
      r.startedAt = run.startedAt
      kicked++
      process.stdout.write(`\r  kicked ${kicked} this iter  (last: ${r.label})  `)
    } catch (e) {
      console.error(`\n  ${r.label}: ${e.message}`)
    }
  }
  writeFileSync(RUNS_PATH, JSON.stringify(records, null, 2))
  console.log()
  console.log(`  iter ${iter} result: kicked=${kicked}, memBlocked=${memBlocked}, still pending=${pending().length}`)
  if (pending().length > 0) {
    console.log(`  sleeping 60s for memory to free…`)
    await new Promise(r => setTimeout(r, 60_000))
  }
}

console.log('\nAll runs kicked. Use poll-sweden-runs.mjs to watch progress.')

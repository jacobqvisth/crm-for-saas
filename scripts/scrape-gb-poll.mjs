// Poll GB Apify runs from scripts/gb-runs.json once.
// Prints per-run status + aggregate. Returns exit code 0 if all SUCCEEDED,
// 1 if any FAILED/ABORTED, 2 if any still running.
//
// Run with:
//   node scripts/scrape-gb-poll.mjs

import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFile, writeFile } from 'fs/promises'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const APIFY_TOKEN = process.env.APIFY_TOKEN
if (!APIFY_TOKEN) {
  console.error('Missing APIFY_TOKEN in .env.local')
  process.exit(1)
}

const runsFile = join(__dirname, 'gb-runs.json')
const runs = JSON.parse(await readFile(runsFile, 'utf8'))

const updated = await Promise.all(
  runs.map(async (r) => {
    if (!r.runId) return r
    try {
      const res = await fetch(
        `https://api.apify.com/v2/actor-runs/${r.runId}?token=${APIFY_TOKEN}`
      )
      if (!res.ok) return { ...r, status: 'POLL_ERROR', error: `${res.status}` }
      const data = await res.json()
      return {
        ...r,
        status: data.data.status,
        finishedAt: data.data.finishedAt,
        stats: {
          itemCount: data.data.stats?.outputBodyLen ?? null,
          datasetItemCount: data.data.stats?.itemCount ?? null,
          runtimeSecs: data.data.stats?.runTimeSecs ?? null,
          computeUnits: data.data.stats?.computeUnits ?? null,
        },
      }
    } catch (e) {
      return { ...r, status: 'POLL_ERROR', error: String(e) }
    }
  })
)

await writeFile(runsFile, JSON.stringify(updated, null, 2))

const counts = {}
for (const r of updated) counts[r.status] = (counts[r.status] || 0) + 1

console.log('Status counts:')
for (const [s, n] of Object.entries(counts).sort()) {
  console.log(`  ${s.padEnd(15)} ${n}`)
}

const stillRunning = updated.filter((r) =>
  ['READY', 'RUNNING'].includes(r.status)
)
const failed = updated.filter((r) =>
  ['FAILED', 'ABORTED', 'TIMING-OUT', 'TIMED-OUT', 'POLL_ERROR', 'LAUNCH_FAILED'].includes(
    r.status
  )
)
const succeeded = updated.filter((r) => r.status === 'SUCCEEDED')

console.log(`\n${succeeded.length}/${updated.length} succeeded`)
if (failed.length) {
  console.log(`\n⚠ Failed/aborted runs:`)
  for (const r of failed) console.log(`   ${r.label}: ${r.status}${r.error ? ' — ' + r.error : ''}`)
}
if (stillRunning.length) {
  console.log(`\nStill running:`)
  for (const r of stillRunning) console.log(`   ${r.label}: ${r.status}`)
}

if (succeeded.length === updated.length) {
  console.log('\n✓ All runs succeeded — ready to import.')
  process.exit(0)
}
if (stillRunning.length === 0) {
  process.exit(1)
}
process.exit(2)

// Bulk MillionVerifier runner for discovered_shops.
// Targets one country at a time. Worker-pool concurrency for MV's ~7s SMTP handshake.
// Throws loudly on provider error (no silent "unknown" mapping — see lib/email-verify.mjs).
//
// Flags:
//   --country <CC>      (required, uppercase 2-letter ISO)
//   --only-null         skip rows with any existing email_status (re-run safety)
//   --limit N           process at most N rows (use to chunk past 45s bash timeout)
//   --concurrency N     default 20; 80 is safe against MillionVerifier
//   --dry-run           count targets, don't call MV
//   --no-snapshot       skip end-of-run distribution query (use during chunked runs)
//
// Examples:
//   node scripts/verify-emails.mjs --country RS --dry-run
//   node scripts/verify-emails.mjs --country RS --concurrency 80
//   node scripts/verify-emails.mjs --country RS --limit 400 --only-null --no-snapshot

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'
import { verifyEmail, shouldSkip } from './lib/email-verify.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

// --- Parse args ---
const args = process.argv.slice(2)
function arg(name) {
  const i = args.indexOf(name)
  if (i === -1) return null
  return args[i + 1] ?? true
}
function flag(name) {
  return args.includes(name)
}

const COUNTRY = arg('--country')
const ONLY_NULL = flag('--only-null')
const LIMIT = arg('--limit') ? parseInt(arg('--limit'), 10) : null
const CONCURRENCY = arg('--concurrency') ? parseInt(arg('--concurrency'), 10) : 20
const DRY_RUN = flag('--dry-run')
const NO_SNAPSHOT = flag('--no-snapshot')

if (!COUNTRY) {
  console.error('Usage: node scripts/verify-emails.mjs --country <CC> [--only-null] [--limit N] [--concurrency N] [--dry-run] [--no-snapshot]')
  process.exit(1)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const mvKey = process.env.MILLIONVERIFIER_API_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
if (!mvKey) {
  console.error('Missing MILLIONVERIFIER_API_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
})

// --- Fetch target rows ---
const cc = COUNTRY.toUpperCase()
console.log(`Country: ${cc}  concurrency: ${CONCURRENCY}  ${ONLY_NULL ? '--only-null ' : ''}${LIMIT ? `--limit ${LIMIT} ` : ''}${DRY_RUN ? '--dry-run ' : ''}`)

let q = supabase
  .from('discovered_shops')
  .select('id, primary_email, email_status, email_verified_at')
  .eq('country_code', cc)
  .not('primary_email', 'is', null)
  .neq('primary_email', '')

if (ONLY_NULL) {
  q = q.is('email_status', null)
}
if (LIMIT) {
  q = q.limit(LIMIT)
}
// Server-side cap defensive — we paginate manually if needed
const MAX_FETCH = LIMIT ?? 50000
const allRows = []
let pageOffset = 0
const PAGE_SIZE = 1000

while (allRows.length < MAX_FETCH) {
  let pageQ = supabase
    .from('discovered_shops')
    .select('id, primary_email, email_status, email_verified_at')
    .eq('country_code', cc)
    .not('primary_email', 'is', null)
    .neq('primary_email', '')
    .order('id')
    .range(pageOffset, pageOffset + PAGE_SIZE - 1)
  if (ONLY_NULL) pageQ = pageQ.is('email_status', null)

  const { data, error } = await pageQ
  if (error) {
    console.error('Fetch error:', error.message)
    process.exit(1)
  }
  if (!data || data.length === 0) break
  allRows.push(...data)
  if (data.length < PAGE_SIZE) break
  pageOffset += PAGE_SIZE
  if (LIMIT && allRows.length >= LIMIT) break
}

const rows = LIMIT ? allRows.slice(0, LIMIT) : allRows

// Filter out rows that should be skipped per freshness cache
const targets = rows.filter((r) => !shouldSkip(r.email_status, r.email_verified_at))
const cachedSkipped = rows.length - targets.length

console.log(`Eligible rows:        ${rows.length}`)
console.log(`Cached (skipped):     ${cachedSkipped}`)
console.log(`To verify:            ${targets.length}`)

if (DRY_RUN) {
  console.log('\n--dry-run: not calling MV.')
  process.exit(0)
}

if (targets.length === 0) {
  console.log('Nothing to verify.')
  if (!NO_SNAPSHOT) await printSnapshot(cc)
  process.exit(0)
}

// --- Worker pool ---
console.log(`\nVerifying with concurrency ${CONCURRENCY}...`)

let verified = 0
let updateErrors = 0
const startTs = Date.now()
const queue = [...targets]

async function worker(id) {
  while (queue.length > 0) {
    const row = queue.shift()
    if (!row) return
    try {
      const { status } = await verifyEmail(row.primary_email, mvKey)
      const { error } = await supabase
        .from('discovered_shops')
        .update({ email_status: status, email_verified_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) {
        console.error(`\n  update error for ${row.id}: ${error.message}`)
        updateErrors++
      } else {
        verified++
      }
      if (verified % 25 === 0) {
        const elapsed = Math.round((Date.now() - startTs) / 1000)
        process.stdout.write(`\r  verified: ${verified}/${targets.length}  (${elapsed}s)`)
      }
    } catch (e) {
      // Throw — provider errors should halt the run, not be swallowed.
      console.error(`\n\nFATAL: worker ${id} hit MV error on ${row.primary_email}:`)
      console.error(`  ${e.message}`)
      console.error(`\nHalting. Verified ${verified} before failure. Re-run with --only-null to resume.`)
      process.exit(1)
    }
  }
}

const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, (_, i) => worker(i))
await Promise.all(workers)

const elapsed = Math.round((Date.now() - startTs) / 1000)
console.log(`\n\nVerified: ${verified}/${targets.length} (${elapsed}s)`)
if (updateErrors) console.log(`Update errors: ${updateErrors}`)

if (!NO_SNAPSHOT) await printSnapshot(cc)

async function printSnapshot(cc) {
  const buckets = ['valid', 'risky', 'catch_all', 'invalid', 'unknown']
  console.log(`\n${cc} email_status distribution:`)
  for (const status of buckets) {
    const { count } = await supabase
      .from('discovered_shops')
      .select('*', { count: 'exact', head: true })
      .eq('country_code', cc)
      .eq('email_status', status)
    console.log(`  ${status.padEnd(10)} ${count}`)
  }
  const { count: nullCount } = await supabase
    .from('discovered_shops')
    .select('*', { count: 'exact', head: true })
    .eq('country_code', cc)
    .is('email_status', null)
    .not('primary_email', 'is', null)
  console.log(`  null       ${nullCount} (with primary_email but no status)`)
}

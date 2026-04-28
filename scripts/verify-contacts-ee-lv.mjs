// One-shot MillionVerifier sweep over EE + LV active-enrollment contacts.
// Run after pausing scheduled queue rows; pairs with _ops_queue_pause_2026_04_28
// for re-enabling only valid contacts.
//
// Verifies every active EE/LV enrollee unconditionally — the legacy MX-only
// "valid" rows from the Apr-2 scrape can't be trusted. shouldSkip is bypassed.

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'
import { verifyEmail } from './lib/email-verify.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const CONCURRENCY = 20
const COUNTRIES = ['EE', 'LV']

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const mvKey = process.env.MILLIONVERIFIER_API_KEY

if (!supabaseUrl || !supabaseServiceKey || !mvKey) {
  console.error('Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / MILLIONVERIFIER_API_KEY)')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
})

const { data: enrolled, error: enrErr } = await supabase
  .from('sequence_enrollments')
  .select('contact_id')
  .eq('status', 'active')

if (enrErr) {
  console.error('Enrollment fetch error:', enrErr.message)
  process.exit(1)
}

const activeContactIds = [...new Set(enrolled.map((e) => e.contact_id))]
console.log(`Active enrollment contact IDs: ${activeContactIds.length}`)

const targets = []
const PAGE = 80
for (let i = 0; i < activeContactIds.length; i += PAGE) {
  const chunk = activeContactIds.slice(i, i + PAGE)
  const { data, error } = await supabase
    .from('contacts')
    .select('id, email, country_code, email_status')
    .in('id', chunk)
    .in('country_code', COUNTRIES)
    .not('email', 'is', null)
    .neq('email', '')

  if (error) {
    console.error('Contacts fetch error:', error.message)
    process.exit(1)
  }
  targets.push(...data)
}

console.log(`EE+LV active contacts to verify: ${targets.length}`)
const beforeStatus = targets.reduce((acc, r) => {
  acc[r.email_status ?? 'null'] = (acc[r.email_status ?? 'null'] ?? 0) + 1
  return acc
}, {})
console.log('Pre-verify status:', beforeStatus)

if (targets.length === 0) {
  console.log('Nothing to verify.')
  process.exit(0)
}

let verified = 0
let updateErrors = 0
const queue = [...targets]
const startTs = Date.now()

async function worker(id) {
  while (queue.length > 0) {
    const row = queue.shift()
    if (!row) return
    try {
      const { status } = await verifyEmail(row.email, mvKey)
      const { error } = await supabase
        .from('contacts')
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
      console.error(`\nFATAL: worker ${id} on ${row.email}: ${e.message}`)
      console.error(`Halting after ${verified} verified.`)
      process.exit(1)
    }
  }
}

const workers = Array.from(
  { length: Math.min(CONCURRENCY, targets.length) },
  (_, i) => worker(i),
)
await Promise.all(workers)

const elapsed = Math.round((Date.now() - startTs) / 1000)
console.log(`\n\nVerified: ${verified}/${targets.length}  (${elapsed}s)`)
if (updateErrors) console.log(`Update errors: ${updateErrors}`)

for (const cc of COUNTRIES) {
  const buckets = ['valid', 'risky', 'catch_all', 'invalid']
  console.log(`\n${cc} contacts email_status:`)
  for (const status of buckets) {
    const { count } = await supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('country_code', cc)
      .eq('email_status', status)
    console.log(`  ${status.padEnd(10)} ${count}`)
  }
}

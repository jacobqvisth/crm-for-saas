// Verify deliverability for the two cohorts the send-time gate would block:
//   1. the English free-user win-back audience
//   2. the enrollments the gate already paused in "Free users 30d+ engaged"
//
// The process-emails cron pauses any enrollment whose contact is
// email_status='unknown' rather than sending blind, so an unverified audience
// looks enrolled but silently never sends. Run this before starting the
// campaign. Writes email_status/email_verified_at only; resuming paused
// enrollments is a separate, deliberate step.

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'
import { verifyEmail } from './lib/email-verify.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)
const mvKey = process.env.MILLIONVERIFIER_API_KEY
const CHECKIN = '34addc80-d062-46fa-8d1c-7eba7a056e89'

// Cohort 1: EN free users who used the product, 30d+ tenure, never paid.
const cutoff = new Date(Date.now() - 30 * 864e5).toISOString()
const { data: audience, error: e1 } = await supabase
  .from('contacts')
  .select('id, email, email_status')
  .not('wl_user_id', 'is', null)
  .eq('user_plan_type', 'free')
  .is('user_subscription_status', null)
  .eq('status', 'active')
  .in('language', ['en'])
  .gte('active_days_count', 1)
  .lt('signed_up_at', cutoff)
  .limit(2000)
if (e1) { console.error('audience fetch:', e1.message); process.exit(1) }

// Cohort 2: paused enrollments on the live check-in.
const { data: paused, error: e2 } = await supabase
  .from('sequence_enrollments')
  .select('contact_id, contacts(id, email, email_status)')
  .eq('sequence_id', CHECKIN)
  .eq('status', 'paused')
if (e2) { console.error('paused fetch:', e2.message); process.exit(1) }

const byId = new Map()
for (const c of audience ?? []) byId.set(c.id, c)
for (const row of paused ?? []) {
  const c = row.contacts
  if (c && !byId.has(c.id)) byId.set(c.id, c)
}

const needsCheck = [...byId.values()].filter(
  (c) => c.email && (c.email_status === null || c.email_status === 'unknown'),
)
console.log(
  `audience=${audience.length} paused=${paused.length} union=${byId.size} needing verification=${needsCheck.length}`,
)
if (needsCheck.length === 0) process.exit(0)

const counts = {}
let done = 0
const queue = [...needsCheck]

async function worker() {
  while (queue.length) {
    const row = queue.shift()
    if (!row) return
    try {
      const { status } = await verifyEmail(row.email, mvKey)
      const { error } = await supabase
        .from('contacts')
        .update({ email_status: status, email_verified_at: new Date().toISOString() })
        .eq('id', row.id)
      if (error) console.error(`update ${row.id}: ${error.message}`)
      counts[status] = (counts[status] ?? 0) + 1
      done++
      if (done % 25 === 0) console.log(`${done}/${needsCheck.length}`, JSON.stringify(counts))
    } catch (err) {
      console.error(`verify ${row.email}: ${err.message}`)
      counts.error = (counts.error ?? 0) + 1
      done++
    }
  }
}

await Promise.all(Array.from({ length: 5 }, worker))
console.log(`DONE ${done}/${needsCheck.length}`, JSON.stringify(counts))

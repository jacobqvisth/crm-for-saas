// Verify all contacts whose email_status is 'unknown' or NULL — sweeps stragglers
// not covered by the active-enrollment sweep.

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

const targets = []
let from = 0
const PAGE = 500
while (true) {
  const { data, error } = await supabase
    .from('contacts')
    .select('id, email, country_code, email_status')
    .or('email_status.is.null,email_status.eq.unknown')
    .not('email', 'is', null)
    .neq('email', '')
    .range(from, from + PAGE - 1)
  if (error) {
    console.error('fetch error:', error.message)
    process.exit(1)
  }
  if (!data || data.length === 0) break
  targets.push(...data)
  if (data.length < PAGE) break
  from += PAGE
}

console.log(`Targets: ${targets.length}`)
if (targets.length === 0) process.exit(0)

let verified = 0
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
      if (error) console.error(`update err ${row.id}: ${error.message}`)
      else verified++
    } catch (e) {
      console.error(`worker ${id} ${row.email}: ${e.message}`)
      process.exit(1)
    }
  }
}
await Promise.all(Array.from({ length: Math.min(20, targets.length) }, (_, i) => worker(i)))
console.log(`Verified ${verified}/${targets.length} in ${Math.round((Date.now() - startTs) / 1000)}s`)

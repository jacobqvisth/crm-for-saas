// Resume the enrollments the send-time verification gate paused, but only the
// ones whose address has since verified as sendable.
//
// The process-emails cron pauses an enrollment when the contact is
// email_status='unknown' rather than sending blind, and cancels its queue row.
// Once the address is verified those enrollments stay paused forever unless
// something puts them back. POST /api/sequences/[id]/resume-all would revive
// every paused enrollment including the risky ones, so this does the same two
// writes as that endpoint against a filtered set:
//   1. sequence_enrollments.status: paused -> active
//   2. the enrollment's LATEST cancelled queue row -> scheduled, due now
// scheduled_for=now() is safe: the cron re-checks the sequence's send window
// and defers anything outside it.
//
// Usage: node scripts/resume-verified-paused.mjs <sequence_id> [--apply]

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const sequenceId = process.argv[2]
const apply = process.argv.includes('--apply')
if (!sequenceId) {
  console.error('usage: node scripts/resume-verified-paused.mjs <sequence_id> [--apply]')
  process.exit(1)
}

// catch_all is accepted alongside valid: the domain accepts everything so the
// address can't be disproven, and we already send to catch_all elsewhere.
// risky (MV "unknown") stays paused to protect the sending domains.
const SENDABLE = ['valid', 'catch_all']

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const { data: paused, error } = await supabase
  .from('sequence_enrollments')
  .select('id, contact_id, contacts(email, email_status)')
  .eq('sequence_id', sequenceId)
  .eq('status', 'paused')
if (error) { console.error('fetch:', error.message); process.exit(1) }

const byStatus = {}
for (const row of paused ?? []) {
  const s = row.contacts?.email_status ?? '(null)'
  byStatus[s] = (byStatus[s] ?? 0) + 1
}
const eligible = (paused ?? []).filter((r) => SENDABLE.includes(r.contacts?.email_status))
console.log(`paused=${paused.length}`, JSON.stringify(byStatus), `eligible=${eligible.length}`)
if (!apply) { console.log('dry run, pass --apply to write'); process.exit(0) }
if (eligible.length === 0) process.exit(0)

const ids = eligible.map((r) => r.id)
const CHUNK = 200
let reactivated = 0
for (let i = 0; i < ids.length; i += CHUNK) {
  const chunk = ids.slice(i, i + CHUNK)
  const { error: e } = await supabase
    .from('sequence_enrollments')
    .update({ status: 'active' })
    .in('id', chunk)
  if (e) { console.error('reactivate:', e.message); process.exit(1) }
  reactivated += chunk.length
}

// Revive the latest cancelled row per enrollment, skipping any that somehow
// already hold a live scheduled row.
const live = new Set()
for (let i = 0; i < ids.length; i += CHUNK) {
  const { data: rows } = await supabase
    .from('email_queue')
    .select('enrollment_id')
    .in('enrollment_id', ids.slice(i, i + CHUNK))
    .eq('status', 'scheduled')
  for (const r of rows ?? []) if (r.enrollment_id) live.add(r.enrollment_id)
}

const reviveIds = []
const stuck = ids.filter((id) => !live.has(id))
for (let i = 0; i < stuck.length; i += CHUNK) {
  const { data: rows } = await supabase
    .from('email_queue')
    .select('id, enrollment_id, created_at')
    .in('enrollment_id', stuck.slice(i, i + CHUNK))
    .eq('status', 'cancelled')
  const latest = new Map()
  for (const r of rows ?? []) {
    if (!r.enrollment_id || !r.created_at) continue
    const prev = latest.get(r.enrollment_id)
    if (!prev || new Date(r.created_at) > new Date(prev.created_at)) latest.set(r.enrollment_id, r)
  }
  for (const hit of latest.values()) reviveIds.push(hit.id)
}

let revived = 0
const now = new Date().toISOString()
for (let i = 0; i < reviveIds.length; i += CHUNK) {
  const chunk = reviveIds.slice(i, i + CHUNK)
  const { error: e } = await supabase
    .from('email_queue')
    .update({ status: 'scheduled', scheduled_for: now })
    .in('id', chunk)
  if (e) { console.error('revive:', e.message); process.exit(1) }
  revived += chunk.length
}

console.log(`reactivated=${reactivated} revived=${revived} left_paused=${paused.length - eligible.length}`)

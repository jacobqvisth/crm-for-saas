// MX-verify all primary_emails for SE-country discovered_shops rows that
// haven't been verified yet (email_status IS NULL). For each, check the
// domain has at least one MX record. Update email_status:
//   'valid'   → MX record exists
//   'invalid' → domain has no MX OR is NXDOMAIN
//
// Cached per-domain: a workshop set with 50 shops at autoexperten.se does
// only ONE DNS lookup, not 50.
//
// Run with: node scripts/verify-emails-se.mjs

import { createClient } from '@supabase/supabase-js'
import { resolveMx } from 'dns/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

const cache = new Map()  // domain → { ok, detail }
async function checkMx(domain) {
  if (cache.has(domain)) return cache.get(domain)
  try {
    const records = await resolveMx(domain)
    const ok = records && records.length > 0
    const result = ok ? { ok: true, detail: 'mx_ok' } : { ok: false, detail: 'no_mx_records' }
    cache.set(domain, result)
    return result
  } catch (e) {
    let detail = 'unverified'
    if (e.code === 'ENOTFOUND' || e.code === 'NXDOMAIN') detail = 'domain_not_found'
    else if (e.code === 'ENODATA') detail = 'no_mx_records'
    else detail = `dns_error:${e.code || e.message?.slice(0,30)}`
    const ok = !['domain_not_found','no_mx_records'].includes(detail)
    const result = { ok, detail }
    cache.set(domain, result)
    return result
  }
}

// ---- Fetch unverified SE rows with email ----
const rows = []
{
  let offset = 0
  while (true) {
    const { data, error } = await supabase.from('discovered_shops')
      .select('id, primary_email, email_status')
      .eq('country_code', 'SE')
      .not('primary_email', 'is', null)
      .is('email_status', null)
      .range(offset, offset + 999)
    if (error) { console.error('fetch:', error.message); break }
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < 1000) break
    offset += 1000
  }
}
console.log(`Unverified SE rows with email: ${rows.length}`)
if (rows.length === 0) { console.log('Nothing to do.'); process.exit(0) }

// ---- Verify in parallel-ish batches (DNS is fast, MX cache deduplicates) ----
let valid = 0, invalid = 0, format = 0
const PARALLEL = 20
async function verifyOne(row) {
  const email = (row.primary_email || '').toLowerCase().trim()
  if (!EMAIL_RE.test(email)) {
    format++
    return { id: row.id, email_status: 'invalid', email_check_detail: 'invalid_format' }
  }
  const domain = email.split('@')[1]
  const r = await checkMx(domain)
  if (r.ok) { valid++; return { id: row.id, email_status: 'valid',   email_check_detail: r.detail } }
  invalid++;  return { id: row.id, email_status: 'invalid', email_check_detail: r.detail }
}

// Process in chunks of PARALLEL parallel
const updates = []
for (let i = 0; i < rows.length; i += PARALLEL) {
  const chunk = rows.slice(i, i + PARALLEL)
  const results = await Promise.all(chunk.map(verifyOne))
  updates.push(...results)
  process.stdout.write(`\r  verified ${updates.length}/${rows.length}  (cache size: ${cache.size})`)
}
console.log()

// ---- Bulk update — group by detail to use UPDATE ... WHERE id IN (...) ----
const verifiedAt = new Date().toISOString()
let updated = 0
const BATCH = 50
for (let i = 0; i < updates.length; i += BATCH) {
  const chunk = updates.slice(i, i + BATCH)
  // Single update per row (Supabase JS doesn't have neat bulk-update with different values per row)
  for (const u of chunk) {
    const { error } = await supabase.from('discovered_shops').update({
      email_status:        u.email_status,
      email_check_detail:  u.email_check_detail,
      email_valid:         u.email_status === 'valid',
      email_verified_at:   verifiedAt,
    }).eq('id', u.id)
    if (!error) updated++
  }
  process.stdout.write(`\r  DB updated: ${updated}/${updates.length}`)
}
console.log()

console.log('\n=== Done ===')
console.log(`Verified rows:       ${rows.length}`)
console.log(`  valid (mx_ok):     ${valid}`)
console.log(`  invalid:           ${invalid}`)
console.log(`  invalid format:    ${format}`)
console.log(`Domains MX-cached:   ${cache.size}`)
console.log(`DB rows updated:     ${updated}`)

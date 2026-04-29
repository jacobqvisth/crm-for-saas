// Pattern-guess + MillionVerifier pass for GB rows with website but no email.
//
// Reads discovered_shops where country_code='GB' AND website IS NOT NULL
// AND primary_email IS NULL. For each unique domain, tries:
//   info@, enquiries@, contact@, office@, sales@
// against MillionVerifier and stops at the first 'valid' (catch_all is
// remembered as fallback). Applies the resulting email back to every row
// with that domain in Supabase.
//
// One chain domain (e.g. halfordsautocentres.co.uk) typically maps to many
// physical locations, so a single pattern hit enriches multiple rows.
//
// Run with:
//   node scripts/pattern-mv-gb.mjs

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const MV_KEY = process.env.MILLIONVERIFIER_API_KEY
if (!supabaseUrl || !supabaseServiceKey || !MV_KEY) {
  console.error('Missing required env keys')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })

const PATTERNS = ['info', 'enquiries', 'contact', 'office', 'sales']
const MV_ENDPOINT = 'https://api.millionverifier.com/api/v3/'

async function verifyEmail(email) {
  const url = `${MV_ENDPOINT}?api=${MV_KEY}&email=${encodeURIComponent(email)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`MV HTTP ${res.status}`)
  const data = await res.json()
  if (data.error && String(data.error).trim() !== '') throw new Error(`MV provider error: ${data.error}`)
  const r = data.result, sr = data.subresult
  let status
  if (sr === 'catchall' || r === 'catch_all') status = 'catch_all'
  else if (r === 'ok') status = 'valid'
  else if (r === 'invalid' || r === 'disposable') status = 'invalid'
  else if (r === 'unknown') status = 'risky'
  else if (r === 'error') throw new Error(`MV transient: ${sr}`)
  else throw new Error(`MV unrecognized: r=${r} sr=${sr}`)
  return { status, raw: data }
}

function extractDomain(website) {
  if (!website) return null
  try {
    const u = new URL(website.startsWith('http') ? website : 'https://' + website)
    return u.hostname.replace(/^www\./, '') || null
  } catch { return null }
}

// 1. Pull every GB row that's website-yes / email-no, build domain → ids map
console.log('Fetching candidate rows...')
const PAGE = 1000
let offset = 0
const domainToIds = new Map() // domain -> [row ids]
while (true) {
  const { data, error } = await supabase
    .from('discovered_shops')
    .select('id, website, domain')
    .eq('country_code', 'GB')
    .not('website', 'is', null)
    .is('primary_email', null)
    .range(offset, offset + PAGE - 1)
  if (error) { console.error(error); process.exit(1) }
  if (!data || data.length === 0) break
  for (const r of data) {
    const d = r.domain || extractDomain(r.website)
    if (!d) continue
    const arr = domainToIds.get(d) || []
    arr.push(r.id)
    domainToIds.set(d, arr)
  }
  if (data.length < PAGE) break
  offset += PAGE
}

const domains = [...domainToIds.keys()].sort()
console.log(`Unique domains: ${domains.length}  (covering ${[...domainToIds.values()].reduce((a,b)=>a+b.length,0)} rows)`)

// 2. Pattern-MV per domain, in parallel
let calls = 0
let validFound = 0
let catchAllFound = 0
let bail = null
const results = {} // domain -> { primary_email, status }
const t0 = Date.now()

async function probeDomain(d) {
  if (bail) return
  let primary = null, primaryStatus = null
  for (const p of PATTERNS) {
    if (bail) return
    const email = `${p}@${d}`
    try {
      const { status } = await verifyEmail(email)
      calls++
      if (status === 'valid') { primary = email; primaryStatus = 'valid'; break }
      if (status === 'catch_all' && !primary) { primary = email; primaryStatus = 'catch_all' }
    } catch (e) {
      if (e.message.includes('provider error') || e.message.includes('transient')) {
        bail = e.message; return
      }
    }
  }
  if (primaryStatus === 'valid') validFound++
  else if (primaryStatus === 'catch_all') catchAllFound++
  results[d] = { primary_email: primary, primary_status: primaryStatus }
}

const CONCURRENCY = 8
let cursor = 0
let completed = 0
async function worker() {
  while (cursor < domains.length && !bail) {
    const i = cursor++
    await probeDomain(domains[i])
    completed++
    if (completed % 25 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
      console.log(`  ${completed}/${domains.length}  calls=${calls}  valid=${validFound}  catch_all=${catchAllFound}  elapsed=${elapsed}s`)
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

if (bail) { console.error(`Halted: ${bail}`); process.exit(1) }

console.log(`\n=== Probe done ===`)
console.log(`Domains:   ${domains.length}`)
console.log(`Valid:     ${validFound}`)
console.log(`Catch-all: ${catchAllFound}`)
console.log(`No match:  ${domains.length - validFound - catchAllFound}`)
console.log(`MV calls:  ${calls}  (~$${(calls*0.0007).toFixed(2)})`)

// 3. Apply results to Supabase — update rows by domain
console.log(`\nApplying results to Supabase...`)
const nowIso = new Date().toISOString()
let rowsUpdated = 0
let updateErrors = 0

for (const [domain, res] of Object.entries(results)) {
  if (!res.primary_email) continue
  const ids = domainToIds.get(domain) || []
  if (!ids.length) continue

  const status = res.primary_status   // 'valid' | 'catch_all'
  const email_valid = status === 'valid' ? true : null
  // Update rows in batches of 100 to avoid huge IN clauses
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { error } = await supabase
      .from('discovered_shops')
      .update({
        primary_email: res.primary_email,
        all_emails: [res.primary_email],
        email_status: status,
        email_valid,
        email_verified_at: nowIso,
      })
      .in('id', chunk)
    if (error) {
      console.error(`Update error for ${domain}:`, error.message)
      updateErrors++
    } else {
      rowsUpdated += chunk.length
    }
  }
}

console.log(`\n✅ Done`)
console.log(`   Rows updated: ${rowsUpdated}`)
if (updateErrors) console.log(`   Update errors: ${updateErrors}`)

// 4. Final GB email coverage
const { count: gbTotal } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
  .eq('country_code', 'GB')
const { count: gbWithEmail } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
  .eq('country_code', 'GB')
  .not('primary_email', 'is', null)
const { count: gbValid } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
  .eq('country_code', 'GB')
  .eq('email_status', 'valid')
const { count: gbCatchAll } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
  .eq('country_code', 'GB')
  .eq('email_status', 'catch_all')

console.log(`\nGB final email coverage:`)
console.log(`  Total GB rows:           ${gbTotal}`)
console.log(`  With any email:          ${gbWithEmail}  (${Math.round(gbWithEmail/gbTotal*100)}%)`)
console.log(`  Valid (sendable inbox):  ${gbValid}`)
console.log(`  Catch-all (deliverable): ${gbCatchAll}`)
console.log(`  Sendable inventory:      ${gbValid + gbCatchAll}  (${Math.round((gbValid+gbCatchAll)/gbTotal*100)}%)`)

// Pattern-guess + MillionVerifier pass for SE rows with website but no email.
//
// Adapted from pattern-mv-gb.mjs with Sweden-tuned patterns and a chain-domain
// guard so we don't assign one info@autoexperten.se to 50 different physical
// workshops (chain locations have per-location mailboxes — pattern-MV at the
// chain root is wrong).
//
// Rules:
//   - Filter: country_code='SE' AND website IS NOT NULL AND primary_email IS NULL
//   - Skip domains that appear in >3 SE rows (likely chain — would over-link)
//   - Try patterns in order; stop at first 'valid' (catch_all kept as fallback)
//
// Patterns (Swedish-tuned):
//   info, kontakt, service, verkstad, bokning
//
// Run with:
//   node scripts/pattern-mv-se.mjs

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

const PATTERNS = ['info', 'kontakt', 'service', 'verkstad', 'bokning']
const MV_ENDPOINT = 'https://api.millionverifier.com/api/v3/'
const CHAIN_THRESHOLD = 3 // domain shared by >3 SE rows = treat as chain, skip

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

// 1. Pull every SE row that's website-yes / email-no, build domain → ids map
console.log('Fetching candidate rows…')
const PAGE = 1000
let offset = 0
const domainToIds = new Map()
while (true) {
  const { data, error } = await supabase
    .from('discovered_shops')
    .select('id, website, domain')
    .eq('country_code', 'SE')
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

const allDomains = [...domainToIds.keys()]
console.log(`Candidate rows:  ${[...domainToIds.values()].reduce((a,b)=>a+b.length,0)}`)
console.log(`Unique domains:  ${allDomains.length}`)

// Skip chain-shared domains (>3 rows) — pattern-MV at the chain root would
// wrongly assign one mailbox to many physical locations.
const skippedDomains = allDomains.filter(d => domainToIds.get(d).length > CHAIN_THRESHOLD)
const probeDomains = allDomains.filter(d => domainToIds.get(d).length <= CHAIN_THRESHOLD).sort()
console.log(`Skipped (chain >${CHAIN_THRESHOLD} rows): ${skippedDomains.length}`)
if (skippedDomains.length) {
  const top = skippedDomains.map(d => ({ d, n: domainToIds.get(d).length })).sort((a,b)=>b.n-a.n).slice(0,8)
  console.log(`  top chain skips:`, top.map(x => `${x.d}(${x.n})`).join(', '))
}
console.log(`To probe:        ${probeDomains.length}  (max ${probeDomains.length * PATTERNS.length} MV calls = ~$${(probeDomains.length*PATTERNS.length*0.0007).toFixed(2)})`)
console.log()

// 2. Pattern-MV per domain
let calls = 0, validFound = 0, catchAllFound = 0
let bail = null
const results = {}
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
      // Non-transient errors (HTTP 4xx / unrecognized): skip this pattern, continue to next
    }
  }
  if (primaryStatus === 'valid') validFound++
  else if (primaryStatus === 'catch_all') catchAllFound++
  results[d] = { primary_email: primary, primary_status: primaryStatus }
}

const CONCURRENCY = 8
let cursor = 0, completed = 0
async function worker() {
  while (cursor < probeDomains.length && !bail) {
    const i = cursor++
    await probeDomain(probeDomains[i])
    completed++
    if (completed % 50 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
      console.log(`  ${completed}/${probeDomains.length}  calls=${calls}  valid=${validFound}  catch_all=${catchAllFound}  elapsed=${elapsed}s`)
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
if (bail) { console.error(`Halted: ${bail}`); process.exit(1) }

console.log()
console.log(`=== Probe done ===`)
console.log(`Domains probed:  ${probeDomains.length}`)
console.log(`Valid:           ${validFound}`)
console.log(`Catch-all:       ${catchAllFound}`)
console.log(`No pattern hit:  ${probeDomains.length - validFound - catchAllFound}`)
console.log(`MV calls:        ${calls}  (~$${(calls * 0.0007).toFixed(2)})`)

// 3. Apply results — write back to discovered_shops
console.log()
console.log(`Applying results to Supabase…`)
const nowIso = new Date().toISOString()
let rowsUpdated = 0, updateErrors = 0
for (const [domain, res] of Object.entries(results)) {
  if (!res.primary_email) continue
  const ids = domainToIds.get(domain) || []
  if (!ids.length) continue
  const status = res.primary_status
  const email_valid = status === 'valid' ? true : null
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const { error } = await supabase
      .from('discovered_shops')
      .update({
        primary_email:      res.primary_email,
        all_emails:         [res.primary_email],
        email_status:       status,
        email_valid,
        email_verified_at:  nowIso,
        email_check_detail: 'pattern_mv',
      })
      .in('id', chunk)
    if (error) {
      console.error(`Update error for ${domain}: ${error.message}`)
      updateErrors++
    } else {
      rowsUpdated += chunk.length
    }
  }
}
console.log(`Rows updated:    ${rowsUpdated}`)
if (updateErrors) console.log(`Update errors:   ${updateErrors}`)

// 4. Final SE coverage
const { count: total } = await supabase.from('discovered_shops').select('*', {count:'exact', head: true}).eq('country_code', 'SE')
const { count: anyEmail } = await supabase.from('discovered_shops').select('*', {count:'exact', head: true}).eq('country_code', 'SE').not('primary_email','is',null)
const { count: valid } = await supabase.from('discovered_shops').select('*', {count:'exact', head: true}).eq('country_code', 'SE').eq('email_status','valid')
const { count: catchAll } = await supabase.from('discovered_shops').select('*', {count:'exact', head: true}).eq('country_code', 'SE').eq('email_status','catch_all')

console.log()
console.log(`=== SE final coverage ===`)
console.log(`Total SE rows:           ${total}`)
console.log(`With any email:          ${anyEmail}  (${Math.round(anyEmail/total*100)}%)`)
console.log(`Valid (sendable inbox):  ${valid}`)
console.log(`Catch-all (deliverable): ${catchAll}`)
console.log(`Sendable inventory:      ${valid + catchAll}  (${Math.round((valid+catchAll)/total*100)}%)`)

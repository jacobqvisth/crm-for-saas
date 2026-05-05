// Import Sweden subset of Lemlist cold-outreach campaign history.
//
// Source: /Users/jacobqvisth/Downloads/contacts-04-21-2026.csv (Lemlist export, 2,183 rows)
// Filter: rows where email's TLD is .se → ~1,005 Sweden rows
// Routing:
//   - emailDeliverability='undeliverable' OR leadStatus='Email bounced'
//       → suppressions (reason='bounced')
//   - leadStatus='Unsubscribed from email'
//       → suppressions (reason='unsubscribed')
//   - everything else
//       → discovered_shops (source='lemlist', country_code='SE')
//         with full Lemlist state preserved in raw_data.lemlist for later analytics
//
// Norway (.no, ~562) and Poland (.pl, ~364) rows are out of scope for the SE scrape;
// dumped to scripts/lemlist-no-pl-history.json so we don't lose them when those
// markets are scraped later.
//
// Run with:
//   node scripts/import-lemlist-history-se.mjs
//
// Idempotent: pre-fetches existing primary_email (SE) and active suppressions
// before insert; safe to re-run.

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import dotenv from 'dotenv'
import Papa from 'papaparse'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })

const WORKSPACE_ID = 'd946ea1f-74b4-492e-ae6a-d50f59ff04f0' // wrenchlane.com workspace
const CSV_PATH = '/Users/jacobqvisth/Downloads/contacts-04-21-2026.csv'

// ---------------- 1. Load + parse CSV ----------------
const csv = readFileSync(CSV_PATH, 'utf-8')
const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true })
if (parsed.errors.length) {
  console.warn(`CSV parse warnings: ${parsed.errors.length} (first: ${parsed.errors[0].message})`)
}
const rows = parsed.data
console.log(`Loaded ${rows.length} rows from ${CSV_PATH}`)

// ---------------- 2. Filter to Sweden subset ----------------
function tldOf(email) {
  const e = (email || '').toLowerCase().trim()
  if (!e.includes('@')) return null
  const domain = e.split('@')[1] || ''
  const parts = domain.split('.')
  return parts.length >= 2 ? '.' + parts[parts.length - 1] : null
}

const seRows = rows.filter(r => tldOf(r.email) === '.se')
console.log(`Sweden subset (.se TLD): ${seRows.length} rows`)

// ---------------- 3. Bucket the rows ----------------
const buckets = { bounced: [], unsubscribed: [], shops: [] }
for (const r of seRows) {
  const status = (r.leadStatus || '').trim()
  const deliv = (r.emailDeliverability || '').trim()
  if (status === 'Unsubscribed from email') {
    buckets.unsubscribed.push(r)
  } else if (status === 'Email bounced' || deliv === 'undeliverable') {
    buckets.bounced.push(r)
  } else {
    buckets.shops.push(r)
  }
}
console.log(
  `Buckets: bounced=${buckets.bounced.length}  ` +
  `unsubscribed=${buckets.unsubscribed.length}  ` +
  `shops=${buckets.shops.length}`,
)

// ---------------- 4. Build records ----------------
function extractDomain(email) {
  if (!email || !email.includes('@')) return null
  return email.split('@')[1].toLowerCase().trim() || null
}

function suppressionRecord(row, reason) {
  const email = (row.email || '').toLowerCase().trim() || null
  return {
    workspace_id: WORKSPACE_ID,
    email,
    reason,
    source: `lemlist:${row.campaigns || 'unknown'}`,
    active: true,
  }
}

function shopRecord(row) {
  const email = (row.email || '').toLowerCase().trim() || null
  const deliv = (row.emailDeliverability || '').trim()
  const emailStatus =
    deliv === 'deliverable' ? 'valid' :
    deliv === 'risky'       ? 'risky' :
                              null
  const emailValid =
    deliv === 'deliverable' ? true :
                              null
  // Fallback when companyName is blank: use the domain stem
  // (autoexpertenkinna.se → "autoexpertenkinna").
  const domain = extractDomain(email)
  const companyName = (row.companyName || '').trim()
  const derivedName = domain ? domain.split('.')[0] : null
  const name = companyName || derivedName || 'Unknown'
  return {
    name,
    primary_email: email,
    domain,
    phone: (row.phone || '').trim() || null,
    country: 'Sweden',
    country_code: 'SE',
    email_status: emailStatus,
    email_valid: emailValid,
    email_verified_at: (row.emailVerificationDate || '').trim() || null,
    source: 'lemlist',
    status: 'new',
    scraped_at: new Date().toISOString(),
    raw_data: {
      lemlist: {
        campaigns:                       row.campaigns || null,
        owner:                           row.owner || null,
        leadStatus:                      row.leadStatus || null,
        addedToLemlist:                  row.addedToLemlist || null,
        firstContactedDate:              row.firstContactedDate || null,
        lastContactedDate:               row.lastContactedDate || null,
        firstLeadLaunchedDate:           row.firstLeadLaunchedDate || null,
        lastLeadLaunchedDate:            row.lastLeadLaunchedDate || null,
        lastRepliedDate:                 row.lastRepliedDate || null,
        lastLeadMarkedAsInterestedDate:  row.lastLeadMarkedAsInterestedDate || null,
        isActiveInCampaigns:             row.isActiveInCampaigns || null,
        emailDeliverability:             deliv,
      },
      replied:        !!(row.lastRepliedDate || '').trim(),
      source_file:    'contacts-04-21-2026.csv',
    },
  }
}

const allSuppRecords = [
  ...buckets.bounced.map(r => suppressionRecord(r, 'bounced')),
  ...buckets.unsubscribed.map(r => suppressionRecord(r, 'unsubscribed')),
].filter(r => r.email)

const allShopRecords = buckets.shops
  .map(shopRecord)
  .filter(r => r.primary_email)

// ---------------- 5. Pre-fetch existing rows for idempotent dedup ----------------
console.log('Pre-fetching existing rows for dedup...')

let existingShopEmails = new Set()
{
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('discovered_shops')
      .select('primary_email')
      .eq('country_code', 'SE')
      .not('primary_email', 'is', null)
      .range(offset, offset + 999)
    if (error) { console.error('Fetch existing shops:', error.message); process.exit(1) }
    if (!data || data.length === 0) break
    for (const r of data) existingShopEmails.add(r.primary_email.toLowerCase())
    if (data.length < 1000) break
    offset += 1000
  }
}
console.log(`  Existing SE primary_emails: ${existingShopEmails.size}`)

let existingSuppEmails = new Set()
{
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('suppressions')
      .select('email')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('active', true)
      .not('email', 'is', null)
      .range(offset, offset + 999)
    if (error) { console.error('Fetch existing suppressions:', error.message); process.exit(1) }
    if (!data || data.length === 0) break
    for (const r of data) existingSuppEmails.add(r.email.toLowerCase())
    if (data.length < 1000) break
    offset += 1000
  }
}
console.log(`  Existing active suppressions for workspace: ${existingSuppEmails.size}`)

// ---------------- 6. Filter out already-loaded rows + within-batch dupes ----------------
const seenShopEmails = new Set()
const newShopRecords = []
for (const r of allShopRecords) {
  const e = r.primary_email
  if (existingShopEmails.has(e)) continue
  if (seenShopEmails.has(e)) continue
  seenShopEmails.add(e)
  newShopRecords.push(r)
}

const seenSuppEmails = new Set()
const newSuppRecords = []
for (const s of allSuppRecords) {
  const e = s.email
  if (existingSuppEmails.has(e)) continue
  if (seenSuppEmails.has(e)) continue
  seenSuppEmails.add(e)
  newSuppRecords.push(s)
}

console.log(
  `After dedup: ` +
  `shops new=${newShopRecords.length} (skip ${allShopRecords.length - newShopRecords.length}), ` +
  `suppressions new=${newSuppRecords.length} (skip ${allSuppRecords.length - newSuppRecords.length})`,
)

// ---------------- 7. Insert in batches ----------------
async function insertBatched(table, records, batchSize = 50) {
  let ok = 0, err = 0
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const { error } = await supabase.from(table).insert(batch)
    if (error) {
      console.error(`\n${table} batch starting ${i}: ${error.message}`)
      err += batch.length
    } else {
      ok += batch.length
      process.stdout.write(`\r  ${table}: ${ok}/${records.length}`)
    }
  }
  if (records.length) process.stdout.write('\n')
  return { ok, err }
}

console.log('\nInserting suppressions...')
const suppResult = await insertBatched('suppressions', newSuppRecords)

console.log('Inserting discovered_shops...')
const shopResult = await insertBatched('discovered_shops', newShopRecords)

// ---------------- 8. Save out-of-scope NO + PL rows for later ----------------
const otherRows = rows.filter(r => ['.no', '.pl'].includes(tldOf(r.email)))
const otherPath = join(__dirname, 'lemlist-no-pl-history.json')
writeFileSync(otherPath, JSON.stringify(otherRows, null, 2))

// ---------------- 9. Report ----------------
console.log('\n=== Summary ===')
console.log(`CSV total:                              ${rows.length}`)
console.log(`Sweden subset:                          ${seRows.length}`)
console.log(`  → suppressions inserted:              ${suppResult.ok} (errors=${suppResult.err}, dedup-skipped=${allSuppRecords.length - newSuppRecords.length})`)
console.log(`     bounced:                           ${buckets.bounced.length}`)
console.log(`     unsubscribed:                      ${buckets.unsubscribed.length}`)
console.log(`  → discovered_shops inserted:          ${shopResult.ok} (errors=${shopResult.err}, dedup-skipped=${allShopRecords.length - newShopRecords.length})`)
const repliedCount = newShopRecords.filter(r => r.raw_data?.replied).length
const deliverableCount = newShopRecords.filter(r => r.email_status === 'valid').length
const riskyCount = newShopRecords.filter(r => r.email_status === 'risky').length
const unverifiedCount = newShopRecords.filter(r => r.email_status === null).length
console.log(`     replied (warm leads):              ${repliedCount}`)
console.log(`     email_status=valid (deliverable):  ${deliverableCount}`)
console.log(`     email_status=risky:                ${riskyCount}`)
console.log(`     email_status=null (need MX-check): ${unverifiedCount}`)
console.log(`Saved ${otherRows.length} NO+PL rows for later → ${otherPath}`)

// Sanity: report DB totals
const { count: totalSE } = await supabase
  .from('discovered_shops')
  .select('*', { count: 'exact', head: true })
  .eq('country_code', 'SE')
const { count: totalSupp } = await supabase
  .from('suppressions')
  .select('*', { count: 'exact', head: true })
  .eq('workspace_id', WORKSPACE_ID)
  .eq('active', true)
console.log(`\nDB totals after run:`)
console.log(`  discovered_shops where country_code='SE':  ${totalSE}`)
console.log(`  active suppressions in workspace:          ${totalSupp}`)

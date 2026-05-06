// Import existing Wrenchlane app customers (workshops + their users) into the CRM.
//
// Source: /tmp/wl-users.csv (333 rows = 333 user-accounts across 255 workshops)
//
// What this loads:
//   companies     ← one row per workshop (255 unique workshop_id)
//   contacts      ← one row per user (333 unique wl_user_id, linked to company)
//   subscriptions ← one row per workshop_stripe_subscription_id (~138 unique)
//
// IDs:
//   companies.wl_workshop_id  = csv.workshop_id     (canonical workshop UUID)
//   contacts.wl_user_id       = csv.internal_user_id (AWS Cognito sub)
//
// Lifecycle mapping (workshop_subscription_status → companies.lifecycle_stage):
//   trialing                          → trial
//   active                            → paying
//   paused | inactive | past_due      → churned
//   '' (blank) AND diagnostics_total>0→ trial   (using product without sub state)
//   '' (blank) AND diagnostics_total=0→ lead    (signed up, never used)
//
// Acquisition source:
//   workshop_created_by_agent set → 'sales'
//   else                         → 'unknown'
//
// Cross-link (Phase F): after import, mark any discovered_shops row whose
// primary_email matches a customer contact's email as crm_company_id, so the
// /discovery promote queue hides existing customers.
//
// Idempotent — safe to re-run. Uses upsert on (wl_workshop_id) and (wl_user_id).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
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
const CSV_PATH = '/tmp/wl-users.csv'

// ---------------- 1. Load CSV ----------------
const csv = readFileSync(CSV_PATH, 'utf-8')
const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true })
if (parsed.errors.length) console.warn(`CSV warnings: ${parsed.errors.length}`)
const rows = parsed.data
console.log(`Loaded ${rows.length} rows`)

// ---------------- 2. Helpers ----------------
const NULL = (v) => {
  const s = (v == null ? '' : String(v)).trim()
  return s === '' ? null : s
}
const INT = (v) => {
  const s = NULL(v)
  if (s == null) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}
const ISO = (v) => NULL(v) // already ISO timestamps in CSV; pass through

function splitName(full) {
  const s = NULL(full)
  if (!s) return { first: null, last: null }
  const parts = s.split(/\s+/)
  return parts.length === 1
    ? { first: parts[0], last: null }
    : { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

function billingCycle(plan) {
  if (!plan) return null
  if (plan.endsWith('_yearly'))  return 'yearly'
  if (plan.endsWith('_monthly')) return 'monthly'
  return null
}

function lifecycleStage(row) {
  const sub = NULL(row.workshop_subscription_status)
  const diag = INT(row.diagnostics_total) || 0
  if (sub === 'trialing') return 'trial'
  if (sub === 'active')   return 'paying'
  if (sub === 'paused' || sub === 'inactive' || sub === 'past_due') return 'churned'
  return diag > 0 ? 'trial' : 'lead'
}

function customerStatus(row) {
  const sub = NULL(row.workshop_subscription_status)
  if (sub) return sub  // trialing | active | paused | inactive | past_due
  return null
}

// Map a user's workshop state to the contact's lead_status. Mirrors
// lifecycleStage(): churned workshops produce churned contacts, everything
// else (trial / paying / lead) produces customer.
function leadStatusFromWorkshop(row) {
  const stage = lifecycleStage(row)
  return stage === 'churned' ? 'churned' : 'customer'
}

function acquisitionSource(row) {
  return NULL(row.workshop_created_by_agent) ? 'sales' : 'unknown'
}

// ---------------- 3. Group rows by workshop ----------------
const workshopMap = new Map() // workshop_id → { workshop fields, users: [...] }
for (const r of rows) {
  const wid = NULL(r.workshop_id)
  if (!wid) continue
  if (!workshopMap.has(wid)) workshopMap.set(wid, { meta: r, users: [] })
  workshopMap.get(wid).users.push(r)
}
console.log(`Distinct workshops: ${workshopMap.size}`)
console.log(`Total users (with workshop): ${[...workshopMap.values()].reduce((s, w) => s + w.users.length, 0)}`)

// ---------------- 4. Build company records ----------------
function companyRecord(workshopId, meta, users) {
  // Pick the most-recently-active user as the "main" user for last_active_at
  const mostActive = [...users].sort((a, b) =>
    (NULL(b.last_active) || '').localeCompare(NULL(a.last_active) || ''),
  )[0] || users[0]
  return {
    workspace_id:           WORKSPACE_ID,
    wl_workshop_id:         workshopId,
    name:                   NULL(meta.workshop_name) || `Workshop ${workshopId.slice(0, 8)}`,
    country_code:           NULL(meta.workshop_country),
    source:                 'wl-app',
    lifecycle_stage:        lifecycleStage(meta),
    customer_status:        customerStatus(meta),
    plan:                   NULL(meta.workshop_plan_type),
    plan_billing_cycle:     billingCycle(NULL(meta.workshop_plan_type)),
    trial_ends_at:          ISO(meta.workshop_trial_end),
    activated_at:           ISO(meta.workshop_activated_at),
    stripe_customer_id:     NULL(meta.workshop_stripe_customer_id),
    stripe_subscription_id: NULL(meta.workshop_stripe_subscription_id),
    subscription_status:    NULL(meta.workshop_subscription_status),
    payment_status:         NULL(meta.workshop_payment_status),
    acquisition_source:     acquisitionSource(meta),
    created_by_agent:       NULL(meta.workshop_created_by_agent),
    member_count:           INT(meta.workshop_member_count) ?? users.length,
    last_active_at:         ISO(mostActive?.last_active),
    custom_fields:          { workshop_language: NULL(meta.workshop_language) },
    // currency, mrr_cents, arr_cents intentionally null until price map is wired
  }
}

const companyRecords = []
for (const [wid, w] of workshopMap) companyRecords.push(companyRecord(wid, w.meta, w.users))

// ---------------- 5. Upsert companies ----------------
console.log('\nUpserting companies...')
let companyOk = 0, companyErr = 0
const COMPANY_BATCH = 50
for (let i = 0; i < companyRecords.length; i += COMPANY_BATCH) {
  const batch = companyRecords.slice(i, i + COMPANY_BATCH)
  const { error } = await supabase
    .from('companies')
    .upsert(batch, { onConflict: 'wl_workshop_id', ignoreDuplicates: false })
  if (error) {
    console.error(`\n  companies batch starting ${i}: ${error.message}`)
    companyErr += batch.length
  } else {
    companyOk += batch.length
    process.stdout.write(`\r  companies: ${companyOk}/${companyRecords.length}`)
  }
}
console.log()

// ---------------- 6. Re-fetch companies to get id ↔ wl_workshop_id mapping ----------------
const widToCompanyId = new Map()
{
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('companies')
      .select('id, wl_workshop_id')
      .eq('workspace_id', WORKSPACE_ID)
      .not('wl_workshop_id', 'is', null)
      .range(offset, offset + 999)
    if (error) { console.error('Fetch companies:', error.message); process.exit(1) }
    if (!data || data.length === 0) break
    for (const r of data) widToCompanyId.set(r.wl_workshop_id, r.id)
    if (data.length < 1000) break
    offset += 1000
  }
}
console.log(`Loaded ${widToCompanyId.size} workshop_id → company.id mappings`)

// ---------------- 7. Build contact records ----------------
function contactRecord(row) {
  const wid = NULL(row.workshop_id)
  const companyId = wid ? widToCompanyId.get(wid) : null
  const email = (NULL(row.email) || '').toLowerCase() || null
  const { first, last } = splitName(row.name)
  const role = NULL(row.user_role)
  // The contact's country_code is denormalized from its workshop (company)
  // so /contacts country filter works without joining. The wl-app sync
  // doesn't ship a per-user country, so we copy the workshop's.
  const workshopCountry = NULL(row.workshop_country) ?? null;
  return {
    workspace_id:                WORKSPACE_ID,
    wl_user_id:                  NULL(row.internal_user_id),
    company_id:                  companyId,
    email:                       email,
    first_name:                  first,
    last_name:                   last,
    phone:                       NULL(row.phone),
    country_code:                workshopCountry,
    app_username:                NULL(row.username),
    app_role:                    role,
    is_primary:                  role === 'admin',
    source:                      'wl-app',
    lead_status:                 leadStatusFromWorkshop(row),
    last_login_at:               ISO(row.last_login),
    last_active_at:              ISO(row.last_active),
    login_count:                 INT(row.login_count),
    credits_remaining:           INT(row.credits_remaining),
    user_plan_type:              NULL(row.user_plan_type),
    user_subscription_status:    NULL(row.user_subscription_status),
    user_stripe_customer_id:     NULL(row.user_stripe_customer_id),
    user_stripe_subscription_id: NULL(row.user_stripe_subscription_id),
    diagnostics_total:           INT(row.diagnostics_total),
    diagnostics_first_at:        ISO(row.diagnostics_first_at),
    diagnostics_last_at:         ISO(row.diagnostics_last_at),
    diagnostics_last_30d:        INT(row.diagnostics_last_30d),
  }
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const contactRecords = rows
  .filter(r => NULL(r.internal_user_id) && NULL(r.email) && UUID_RE.test(NULL(r.internal_user_id) || ''))
  .map(contactRecord)
const skippedNonUuid = rows.filter(r => NULL(r.internal_user_id) && !UUID_RE.test(NULL(r.internal_user_id) || ''))
if (skippedNonUuid.length) {
  console.log(`Skipping ${skippedNonUuid.length} rows with non-UUID internal_user_id (likely test accounts):`)
  for (const r of skippedNonUuid) console.log(`  ${r.internal_user_id} (${r.email || '<no email>'})`)
}
console.log(`\nContact records to upsert: ${contactRecords.length}`)

// ---------------- 8. Upsert contacts ----------------
let contactOk = 0, contactErr = 0
const CONTACT_BATCH = 50
for (let i = 0; i < contactRecords.length; i += CONTACT_BATCH) {
  const batch = contactRecords.slice(i, i + CONTACT_BATCH)
  const { error } = await supabase
    .from('contacts')
    .upsert(batch, { onConflict: 'wl_user_id', ignoreDuplicates: false })
  if (error) {
    console.error(`\n  contacts batch starting ${i}: ${error.message}`)
    contactErr += batch.length
  } else {
    contactOk += batch.length
    process.stdout.write(`\r  contacts: ${contactOk}/${contactRecords.length}`)
  }
}
console.log()

// ---------------- 9. Build + upsert subscriptions ----------------
const subRecords = []
const seenSubIds = new Set()
for (const [wid, w] of workshopMap) {
  const subId = NULL(w.meta.workshop_stripe_subscription_id)
  if (!subId || seenSubIds.has(subId)) continue
  seenSubIds.add(subId)
  const companyId = widToCompanyId.get(wid)
  if (!companyId) continue
  subRecords.push({
    workspace_id:           WORKSPACE_ID,
    company_id:             companyId,
    stripe_customer_id:     NULL(w.meta.workshop_stripe_customer_id),
    stripe_subscription_id: subId,
    plan:                   NULL(w.meta.workshop_plan_type),
    status:                 NULL(w.meta.workshop_subscription_status),
    trial_end:              ISO(w.meta.workshop_trial_end),
    metadata:               { source: 'wl-users-csv-2026-04-21' },
    // mrr_cents, current_period_*, etc. left null — backfill from Stripe API later
  })
}
console.log(`\nSubscription records: ${subRecords.length}`)

let subOk = 0, subErr = 0
for (let i = 0; i < subRecords.length; i += 50) {
  const batch = subRecords.slice(i, i + 50)
  const { error } = await supabase
    .from('subscriptions')
    .upsert(batch, { onConflict: 'stripe_subscription_id', ignoreDuplicates: false })
  if (error) {
    console.error(`\n  subscriptions batch starting ${i}: ${error.message}`)
    subErr += batch.length
  } else {
    subOk += batch.length
    process.stdout.write(`\r  subscriptions: ${subOk}/${subRecords.length}`)
  }
}
console.log()

// ---------------- 10. Phase F — cross-link discovered_shops to existing customers ----------------
// Match by email between discovered_shops.primary_email and contacts.email.
// Mark matching discovered_shops rows as crm_company_id + status='imported'
// so the /discovery promote queue hides them.
console.log('\nCross-linking discovered_shops to existing customer contacts...')
const { data: customerEmails } = await supabase
  .from('contacts')
  .select('email, company_id')
  .eq('workspace_id', WORKSPACE_ID)
  .eq('source', 'wl-app')
  .not('email', 'is', null)

const emailToCompany = new Map()
const domainToCompanies = new Map() // domain → Set<company_id>
for (const r of customerEmails || []) {
  const e = (r.email || '').toLowerCase()
  emailToCompany.set(e, r.company_id)
  const d = e.split('@')[1]
  if (!d) continue
  if (!domainToCompanies.has(d)) domainToCompanies.set(d, new Set())
  domainToCompanies.get(d).add(r.company_id)
}
// Domain → company only when exactly one customer uses that domain
// (skips chain domains like autoexperten.se and free-mail providers)
const FREEMAIL = new Set([
  'gmail.com','googlemail.com','hotmail.com','hotmail.se','outlook.com','live.com',
  'yahoo.com','yahoo.se','icloud.com','me.com','aol.com','protonmail.com',
])
const singleDomainToCompany = new Map()
for (const [d, ids] of domainToCompanies) {
  if (ids.size === 1 && !FREEMAIL.has(d)) singleDomainToCompany.set(d, [...ids][0])
}
console.log(`  ${emailToCompany.size} customer emails  ·  ${singleDomainToCompany.size} single-customer domains`)

// Paginate — Supabase caps at 1000 rows per query
const discShops = []
{
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('discovered_shops')
      .select('id, primary_email, domain, country_code')
      .not('primary_email', 'is', null)
      .is('crm_company_id', null)
      .range(offset, offset + 999)
    if (error) { console.error('Fetch discovered_shops:', error.message); break }
    if (!data || data.length === 0) break
    discShops.push(...data)
    if (data.length < 1000) break
    offset += 1000
  }
}

let exactMatch = 0, domainMatch = 0
const updates = []
const seenIds = new Set()
for (const s of (discShops || [])) {
  const e = (s.primary_email || '').toLowerCase()
  // 1. exact email match — gold
  let cid = emailToCompany.get(e)
  if (cid) {
    updates.push({ id: s.id, crm_company_id: cid, status: 'imported' })
    seenIds.add(s.id)
    exactMatch++
    continue
  }
  // 2. single-customer-domain match — silver (skipped for chain domains)
  const d = (s.domain || e.split('@')[1] || '').toLowerCase()
  cid = d ? singleDomainToCompany.get(d) : null
  if (cid && !seenIds.has(s.id)) {
    updates.push({ id: s.id, crm_company_id: cid, status: 'imported' })
    seenIds.add(s.id)
    domainMatch++
  }
}
console.log(`  Matches → exact-email: ${exactMatch}  ·  single-domain: ${domainMatch}`)
let crossLinked = 0
for (let i = 0; i < updates.length; i += 50) {
  const batch = updates.slice(i, i + 50)
  for (const u of batch) {
    const { error } = await supabase
      .from('discovered_shops')
      .update({ crm_company_id: u.crm_company_id, status: u.status })
      .eq('id', u.id)
    if (!error) crossLinked++
  }
  process.stdout.write(`\r  cross-linked: ${crossLinked}/${updates.length}`)
}
console.log()

// ---------------- 11. Final report ----------------
console.log('\n=== Summary ===')
console.log(`CSV rows:                     ${rows.length}`)
console.log(`Distinct workshops:           ${workshopMap.size}`)
console.log()
console.log(`companies upserted:           ${companyOk}  (errors=${companyErr})`)
console.log(`contacts upserted:            ${contactOk}  (errors=${contactErr})`)
console.log(`subscriptions upserted:       ${subOk}  (errors=${subErr})`)
console.log(`discovered_shops cross-linked:${crossLinked}`)
console.log()

// Lifecycle distribution
const lifeCounts = {}
for (const c of companyRecords) lifeCounts[c.lifecycle_stage] = (lifeCounts[c.lifecycle_stage] || 0) + 1
console.log('Companies by lifecycle_stage:', lifeCounts)
const acqCounts = {}
for (const c of companyRecords) acqCounts[c.acquisition_source] = (acqCounts[c.acquisition_source] || 0) + 1
console.log('Companies by acquisition_source:', acqCounts)

// DB sanity totals
const { count: companiesTotal } = await supabase
  .from('companies').select('*', { count: 'exact', head: true })
  .eq('workspace_id', WORKSPACE_ID).eq('source', 'wl-app')
const { count: contactsTotal } = await supabase
  .from('contacts').select('*', { count: 'exact', head: true })
  .eq('workspace_id', WORKSPACE_ID).eq('source', 'wl-app')
const { count: subTotal } = await supabase
  .from('subscriptions').select('*', { count: 'exact', head: true })
  .eq('workspace_id', WORKSPACE_ID)
console.log(`\nDB totals after run:`)
console.log(`  companies (wl-app):  ${companiesTotal}`)
console.log(`  contacts  (wl-app):  ${contactsTotal}`)
console.log(`  subscriptions:       ${subTotal}`)

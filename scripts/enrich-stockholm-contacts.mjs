/**
 * Stockholm metro contact-info enrichment — Phase SE-Stockholm-2 Pass B
 *
 * Runs vdrmota/contact-info-scraper against every discovered_shops row where
 * state = 'Stockholms län' AND website IS NOT NULL.
 *
 * For each successfully-fetched page:
 *   1. Unions newly-found emails/phones/social links with existing data
 *   2. MX-verifies any newly-added primary_email values
 *
 * NOTE: vdrmota/contact-info-scraper does NOT return page text — only extracted
 * contact info. Certification flags (rot_advertised, gvk_certified, etc.) require
 * a separate text-scraping pass and remain NULL from this run.
 *
 * Run:
 *   node scripts/enrich-stockholm-contacts.mjs
 *
 * Requires env (loaded from .env.local):
 *   KUNDBOLAGET_SUPABASE_URL
 *   KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY
 *   APIFY_TOKEN
 */

import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import dotenv from 'dotenv';
import dns from 'dns/promises';
import { normalizedPhone } from './lib/normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Walk up to find .env.local
let envPath = null;
{
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env.local');
    if (existsSync(candidate)) { envPath = candidate; break; }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
if (!envPath) { console.error('Cannot find .env.local'); process.exit(1); }
dotenv.config({ path: envPath });

// ── Config ─────────────────────────────────────────────────────────────────────

const APIFY_TOKEN = process.env.APIFY_TOKEN;
const KB_URL      = process.env.KUNDBOLAGET_SUPABASE_URL;
const KB_KEY      = process.env.KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY;

for (const [k, v] of [['APIFY_TOKEN', APIFY_TOKEN], ['KUNDBOLAGET_SUPABASE_URL', KB_URL], ['KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY', KB_KEY]]) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const supabase = createClient(KB_URL, KB_KEY, { auth: { persistSession: false } });

const ACTOR_ID        = 'vdrmota/contact-info-scraper'; // NOT apify/contact-info-scraper (404s)
const BATCH_SIZE      = 150;  // URLs per Apify run
const WAVE_SIZE       = 5;    // concurrent Apify runs
const UPDATE_BATCH    = 30;   // shops to update per supabase batch

// ── Apify helpers ─────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apifyPost(path, body) {
  const res = await fetch(`https://api.apify.com/v2${path}?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Apify POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apifyGet(path) {
  const res = await fetch(`https://api.apify.com/v2${path}?token=${APIFY_TOKEN}`);
  if (!res.ok) throw new Error(`Apify GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function pollRunUntilDone(runId, label, maxWaitMs = 60 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(20000);
    const data = await apifyGet(`/actor-runs/${runId}`);
    const status = data.data?.status;
    if (status === 'SUCCEEDED') return data.data;
    if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) {
      throw new Error(`Run ${runId} (${label}) ended: ${status}`);
    }
    process.stdout.write('.');
  }
  throw new Error(`Run ${runId} (${label}) timed out`);
}

async function fetchDatasetItems(datasetId) {
  const items = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const res = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&offset=${offset}&limit=${limit}&clean=true`
    );
    if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
    const batch = await res.json();
    if (!batch.length) break;
    items.push(...batch);
    offset += batch.length;
    if (batch.length < limit) break;
  }
  return items;
}

async function runContactInfoBatch(urls, batchLabel) {
  const data = await apifyPost(`/acts/${ACTOR_ID.replace('/', '~')}/runs`, {
    startUrls: urls.map(u => ({ url: u })),
    maxDepth: 1,
    considerChildFrames: true,
  });
  const runId = data.data?.id || data.id;
  process.stdout.write(`\n  ${batchLabel}: run ${runId} polling`);
  const runData = await pollRunUntilDone(runId, batchLabel);
  const items = await fetchDatasetItems(runData.defaultDatasetId);
  process.stdout.write(` → ${items.length} results\n`);

  // Get cost
  let cost = 0;
  try {
    const rd = await apifyGet(`/actor-runs/${runId}`);
    cost = rd.data?.usageTotalUsd ?? 0;
  } catch { /* ignore */ }

  // Build url → result map keyed on originalStartUrl (vdrmota actor field)
  const byUrl = {};
  for (const item of items) {
    const key = (item.originalStartUrl || item.url || item.requestUrl || '').replace(/\/$/, '').toLowerCase();
    if (key) byUrl[key] = item;
  }
  return { byUrl, cost };
}

// ── MX verification ───────────────────────────────────────────────────────────

async function checkMx(email) {
  const domain = email.split('@')[1];
  if (!domain) return { valid: false, detail: 'no_domain' };
  try {
    const records = await dns.resolveMx(domain);
    if (records.length) {
      return { valid: true, detail: records.sort((a, b) => a.priority - b.priority)[0].exchange };
    }
    return { valid: false, detail: 'no_mx' };
  } catch (e) {
    return { valid: false, detail: e.code || 'dns_error' };
  }
}

async function batchMxCheck(emails, concurrency = 20) {
  const results = {};
  for (let i = 0; i < emails.length; i += concurrency) {
    const slice = emails.slice(i, i + concurrency);
    const resolved = await Promise.all(slice.map(e => checkMx(e).then(r => [e, r])));
    for (const [e, r] of resolved) results[e] = r;
  }
  return results;
}

// ── Fetch target rows from DB ─────────────────────────────────────────────────

async function fetchTargetRows() {
  const rows = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('discovered_shops')
      .select('id, google_place_id, website, primary_email, all_emails, all_phones, instagram_url, facebook_url, linkedin_url, sources, email_valid')
      .eq('state', 'Stockholms län')
      .not('website', 'is', null)
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`fetchTargetRows: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

// ── Build enrichment update from scraper result ───────────────────────────────

function BORING_EMAILS(e) {
  return /^(info|kontakt|contact|hej|hello|support|noreply|no-reply|admin|post|webb)@/i.test(e);
}

function buildEnrichmentUpdate(shop, scraperResult, passBRunId) {
  const update = {};
  const changedFields = [];
  const now = nowIso();
  const existingSources = shop.sources || {};
  const mergedSources = { ...existingSources };

  // NOTE: vdrmota/contact-info-scraper returns no page text — cert flags stay NULL.
  // They require a separate text-scraping pass.

  if (scraperResult) {
    // Emails (actor field: emails[])
    const newEmails = (scraperResult.emails || []).filter(e => e && e.includes('@'));
    if (newEmails.length) {
      const existing = shop.all_emails || [];
      const union = [...new Set([...existing, ...newEmails])];
      if (union.length > existing.length) {
        update.all_emails = union;
        changedFields.push('all_emails');
        mergedSources.all_emails = { source: 'contact_info_scraper', at: now };
      }
      // Set primary_email if currently null: prefer non-boring email
      if (!shop.primary_email) {
        const nonBoring = newEmails.find(e => !BORING_EMAILS(e)) || newEmails[0];
        if (nonBoring) {
          update.primary_email = nonBoring;
          changedFields.push('primary_email');
          mergedSources.primary_email = { source: 'contact_info_scraper', at: now };
        }
      }
    }

    // Phones (actor field: phones[] — already normalised strings)
    const newPhones = (scraperResult.phones || []).filter(p => p && p.length >= 6);
    if (newPhones.length) {
      const normalized = newPhones.map(p => normalizedPhone(p, 'SE')).filter(Boolean);
      const existing = shop.all_phones || [];
      const union = [...new Set([...existing, ...normalized])];
      if (union.length > existing.length) {
        update.all_phones = union;
        changedFields.push('all_phones');
        mergedSources.all_phones = { source: 'contact_info_scraper', at: now };
      }
    }

    // Social links — actor returns arrays: instagrams[], facebooks[], linkedIns[]
    const socialFields = [
      ['instagram_url', (scraperResult.instagrams || [])[0]],
      ['facebook_url',  (scraperResult.facebooks  || [])[0]],
      ['linkedin_url',  (scraperResult.linkedIns  || [])[0]],
    ];
    for (const [field, val] of socialFields) {
      if (!shop[field] && val) {
        update[field] = val;
        changedFields.push(field);
        mergedSources[field] = { source: 'contact_info_scraper', at: now };
      }
    }
  }

  if (changedFields.length > 0) {
    update.sources = mergedSources;
    update.last_enriched_at = now;
  }

  return { update, changedFields };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Stockholm metro contact-info enrichment — Phase SE-Stockholm-2 Pass B ===\n');

  // ── Open scrape_runs row ──────────────────────────────────────────────────
  console.log('Opening scrape_runs row...');
  const { data: runRow, error: runErr } = await supabase
    .from('scrape_runs')
    .insert({
      source: 'contact_info_scraper',
      scope:  'stockholm_metro_enrichment',
      status: 'running',
      meta: {
        actor:          ACTOR_ID,
        target_filter:  'state = Stockholms län AND website IS NOT NULL',
        batch_size_urls: BATCH_SIZE,
        batch_concurrency: WAVE_SIZE,
      },
    })
    .select('id')
    .single();

  if (runErr) { console.error('Failed to open scrape_runs:', runErr.message); process.exit(1); }
  const PASS_B_RUN_ID = runRow.id;
  console.log(`Pass B run ID: ${PASS_B_RUN_ID}\n`);

  // ── Fetch target rows ─────────────────────────────────────────────────────
  console.log('Fetching target rows from discovered_shops...');
  const targetRows = await fetchTargetRows();
  console.log(`  Target rows (state=Stockholms län, website IS NOT NULL): ${targetRows.length}\n`);

  // ── Split into URL batches, run in waves ──────────────────────────────────
  const urls = targetRows.map(r => r.website);
  const urlBatches = [];
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    urlBatches.push(urls.slice(i, i + BATCH_SIZE));
  }

  console.log(`URLs: ${urls.length} across ${urlBatches.length} batches of ≤${BATCH_SIZE}, waves of ${WAVE_SIZE}\n`);

  // Global result map: url → scraperResult (or null if failed)
  const resultByUrl = {};
  let totalApifyCost = 0;
  let totalFetched = 0;

  for (let waveStart = 0; waveStart < urlBatches.length; waveStart += WAVE_SIZE) {
    const wave = urlBatches.slice(waveStart, waveStart + WAVE_SIZE);
    const waveNum = Math.floor(waveStart / WAVE_SIZE) + 1;
    const totalWaves = Math.ceil(urlBatches.length / WAVE_SIZE);
    console.log(`--- Wave ${waveNum}/${totalWaves} (batches ${waveStart + 1}–${waveStart + wave.length}) ---`);

    const waveResults = await Promise.all(wave.map(async (batchUrls, idx) => {
      const batchNum = waveStart + idx + 1;
      const label = `batch-${batchNum}/${urlBatches.length}`;
      try {
        return await runContactInfoBatch(batchUrls, label);
      } catch (e) {
        console.warn(`\n  ${label} FAILED: ${e.message}`);
        return { byUrl: {}, cost: 0 };
      }
    }));

    for (const { byUrl, cost } of waveResults) {
      Object.assign(resultByUrl, byUrl);
      totalApifyCost += cost;
    }

    totalFetched = Object.keys(resultByUrl).length;
    console.log(`  Running total: ${totalFetched} URLs with results\n`);

    if (waveStart + WAVE_SIZE < urlBatches.length) await sleep(3000);
  }

  console.log(`\nScraper complete. URLs with results: ${totalFetched}/${urls.length}`);

  // ── Apply enrichment updates ──────────────────────────────────────────────
  console.log('\nApplying enrichment updates...');

  let rowsUpdated   = 0;
  let rowsUnmatched = 0; // URLs the actor failed to fetch
  const newPrimaryEmails = []; // for MX re-check

  for (let i = 0; i < targetRows.length; i += UPDATE_BATCH) {
    const slice = targetRows.slice(i, i + UPDATE_BATCH);

    await Promise.all(slice.map(async (shop) => {
      const urlKey = shop.website?.replace(/\/$/, '').toLowerCase();
      const scraperResult = urlKey ? (resultByUrl[urlKey] || null) : null;

      if (!scraperResult) rowsUnmatched++;

      const { update, changedFields } = buildEnrichmentUpdate(shop, scraperResult, PASS_B_RUN_ID);

      // Always write a data_source_events row (even if no fields changed — records the attempt)
      const { error: evErr } = await supabase.from('data_source_events').insert({
        shop_id:          shop.id,
        run_id:           PASS_B_RUN_ID,
        source:           'contact_info_scraper',
        event_type:       changedFields.length > 0 ? 'update' : 'no_change',
        fields_changed:   changedFields.length > 0 ? changedFields : [],
        match_method:     'shop_id',
        match_confidence: 1.0,
      });
      if (evErr) console.warn(`data_source_events error for ${shop.id}:`, evErr.message);

      if (changedFields.length === 0) return;

      // Track newly-added primary_emails for MX verification
      if (update.primary_email && !shop.primary_email) {
        newPrimaryEmails.push({ shopId: shop.id, email: update.primary_email });
      }

      const { error: upErr } = await supabase
        .from('discovered_shops')
        .update(update)
        .eq('id', shop.id);

      if (upErr) {
        console.warn(`Update error for shop ${shop.id}:`, upErr.message);
        return;
      }
      rowsUpdated++;
    }));

    process.stdout.write(`\r  Progress: ${Math.min(i + UPDATE_BATCH, targetRows.length)}/${targetRows.length}`);
  }
  console.log(`\n  Shops updated: ${rowsUpdated}`);
  console.log(`  Fetch failed (cert flags stay NULL): ${rowsUnmatched}`);

  // ── MX verification for newly-added primary_emails ────────────────────────
  console.log(`\nMX verifying ${newPrimaryEmails.length} newly-added primary emails...`);

  const uniqueNewEmails = [...new Set(newPrimaryEmails.map(r => r.email))];
  const mxResults = await batchMxCheck(uniqueNewEmails, 20);
  const now = nowIso();

  // Build email → mx map
  const emailToMx = mxResults;
  const emailToShops = new Map();
  for (const { shopId, email } of newPrimaryEmails) {
    if (!emailToShops.has(email)) emailToShops.set(email, []);
    emailToShops.get(email).push(shopId);
  }

  let mxValid = 0;
  for (const [email, shopIds] of emailToShops.entries()) {
    const mx = emailToMx[email];
    if (!mx) continue;
    if (mx.valid) mxValid++;

    for (const shopId of shopIds) {
      await supabase.from('discovered_shops').update({
        email_valid:        mx.valid,
        email_check_detail: mx.detail,
        email_verified_at:  now,
      }).eq('id', shopId);
    }
  }

  // Also count existing valid emails toward overall stat
  const { data: existingValid } = await supabase
    .from('discovered_shops')
    .select('id', { count: 'exact' })
    .eq('state', 'Stockholms län')
    .eq('email_valid', true);

  const totalValidNow = existingValid?.length ?? 0;

  console.log(`  Newly MX-valid:   ${mxValid}/${uniqueNewEmails.length}`);
  console.log(`  Total MX-valid in DB: ${totalValidNow}`);

  // ── Close Pass B run ──────────────────────────────────────────────────────
  console.log('\nClosing scrape_runs row...');
  const { error: closeErr } = await supabase
    .from('scrape_runs')
    .update({
      status:          'complete',
      completed_at:    now,
      rows_fetched:    urls.length,       // URLs fed to actor
      rows_inserted:   0,
      rows_updated:    rowsUpdated,       // shops where ≥1 field was written
      rows_unmatched:  rowsUnmatched,     // URLs actor failed to fetch
      cost_usd:        totalApifyCost > 0 ? parseFloat(totalApifyCost.toFixed(4)) : null,
      notes: [
        `Pass B: ${urls.length} URLs fed to ${ACTOR_ID}.`,
        `${totalFetched} URLs returned results.`,
        `${rowsUpdated} shops updated.`,
        `${rowsUnmatched} URLs actor failed to fetch (cert flags remain NULL).`,
        `${mxValid} new MX-valid emails added.`,
      ].join(' '),
    })
    .eq('id', PASS_B_RUN_ID);

  if (closeErr) console.warn('Failed to close scrape_runs:', closeErr.message);
  else console.log('scrape_runs closed.');

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log('\n=== PASS B SUMMARY ===');
  console.log(`  Pass B run ID:          ${PASS_B_RUN_ID}`);
  console.log(`  URLs fed to actor:      ${urls.length}`);
  console.log(`  URLs with results:      ${totalFetched}`);
  console.log(`  Shops updated:          ${rowsUpdated}`);
  console.log(`  Fetch failures (NULL):  ${rowsUnmatched}`);
  console.log(`  New MX-valid emails:    ${mxValid}`);
  if (totalApifyCost > 0) console.log(`  Apify cost:             $${totalApifyCost.toFixed(4)}`);

  return {
    passBRunId:   PASS_B_RUN_ID,
    rowsUpdated,
    rowsUnmatched,
    newMxValid:   mxValid,
    totalMxValid: totalValidNow,
    cost:         totalApifyCost,
  };
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

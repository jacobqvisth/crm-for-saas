/**
 * Stockholm cert-flag + description scraper — Phase SE-Stockholm-3 Pass A
 *
 * Fetches each shop's website directly (no Apify, cost = $0) and:
 *   1. Extracts <meta name="description"> → description (500 char cap)
 *   2. Fetches /om-oss (or equivalent) → about_text (20k char cap)
 *   3. Fetches /tjanster (or equivalent) → services_text (20k char cap)
 *   4. Runs cert-flag regexes on combined page text → 6 boolean fields
 *
 * Cert flags are 3-state: NULL = fetch failed, TRUE = matched, FALSE = text fetched but no match.
 *
 * Run: node scripts/lib/cert-flag-scraper.mjs
 *
 * Requires env (loaded from .env.local):
 *   KUNDBOLAGET_SUPABASE_URL
 *   KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { load } from 'cheerio';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

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
if (!envPath) { console.error('Cannot find .env.local — searched up from', __dirname); process.exit(1); }
dotenv.config({ path: envPath });

const KB_URL = process.env.KUNDBOLAGET_SUPABASE_URL;
const KB_KEY = process.env.KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY;

if (!KB_URL || !KB_KEY) {
  console.error('Missing KUNDBOLAGET_SUPABASE_URL or KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(KB_URL, KB_KEY, { auth: { persistSession: false } });

// ── Config ─────────────────────────────────────────────────────────────────────

const CONCURRENCY       = 20;
const TIMEOUT_MS        = 10_000;
const DOMAIN_DELAY_MS   = 200;
const MAX_ABOUT_CHARS   = 20_000;
const MAX_SVCTEXT_CHARS = 20_000;
const MAX_DESC_CHARS    = 500;
const UPDATE_BATCH      = 25;

const USER_AGENT = 'Mozilla/5.0 (compatible; KundbolagetBot/1.0; +https://kundbolaget.se)';

const ABOUT_PATHS = ['/om-oss', '/om', '/about', '/about-us'];
const SERVICE_PATHS = [
  '/tjanster',
  '/tj\u00e4nster',   // tjänster
  '/services',
  '/vara-tjanster',
  '/v\u00e5ra-tj\u00e4nster', // våra-tjänster
];

const CERT_MATCHERS = {
  rot_advertised:               /\brot\b|rot-avdrag/i,
  gvk_certified:                /\bgvk\b|gvk-certifierad/i,
  saker_vatten_certified:       /s\u00e4ker vatten|s\u00e4kervatten/i,  // säker vatten|säkervatten
  byggforetagen_member:         /byggf\u00f6retagen|\bbf-medlem\b/i,    // byggföretagen
  installatorsforetagen_member: /installat\u00f6rsf\u00f6retagen/i,     // installatörsföretagen
  elsakerhetsverket_registered: /els\u00e4kerhetsverket|auktoriserad elinstallatör/i,
};

const CERT_FLAG_FIELDS = Object.keys(CERT_MATCHERS);

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Semaphore (limits concurrent HTTP fetches to CONCURRENCY) ─────────────────

class Semaphore {
  constructor(n) { this._n = n; this._queue = []; }
  acquire() {
    if (this._n > 0) { this._n--; return Promise.resolve(); }
    return new Promise(resolve => this._queue.push(resolve));
  }
  release() {
    if (this._queue.length > 0) {
      this._queue.shift()();
    } else {
      this._n++;
    }
  }
}

const sem = new Semaphore(CONCURRENCY);
const domainLastFetch = new Map();

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function getDomain(url) {
  try { return new URL(url).hostname.toLowerCase(); }
  catch { return url.toLowerCase(); }
}

async function fetchPage(url) {
  const domain = getDomain(url);

  // Per-domain politeness delay
  const lastFetch = domainLastFetch.get(domain);
  if (lastFetch !== undefined) {
    const elapsed = Date.now() - lastFetch;
    if (elapsed < DOMAIN_DELAY_MS) await sleep(DOMAIN_DELAY_MS - elapsed);
  }
  domainLastFetch.set(domain, Date.now());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function fetchWithSem(url) {
  await sem.acquire();
  try { return await fetchPage(url); }
  finally { sem.release(); }
}

// Try paths in order; return { html, path } for the first 2xx response, else null.
async function tryPaths(baseUrl, paths) {
  const base = baseUrl.replace(/\/$/, '');
  for (const path of paths) {
    const html = await fetchWithSem(base + path);
    if (html) return { html, path };
  }
  return null;
}

// ── HTML → plain text ─────────────────────────────────────────────────────────

function htmlToText(html) {
  const $ = load(html);
  // Remove noise elements
  $('script, style, nav, header, footer, noscript').remove();
  $(
    '[class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"],' +
    '[class*="gdpr"], [id*="gdpr"], [class*="banner"], [id*="banner"],' +
    '[class*="popup"], [id*="popup"], [class*="overlay"], [id*="overlay"],' +
    '[class*="modal"], [id*="modal"]'
  ).remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function extractMetaDesc(html) {
  const $ = load(html);
  const desc =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';
  return desc.trim().slice(0, MAX_DESC_CHARS) || null;
}

// ── Process one shop ──────────────────────────────────────────────────────────

async function processShop(shop) {
  const base = shop.website.replace(/\/$/, '');
  const out = {
    id:           shop.id,
    description:  null,
    about_text:   null,
    services_text: null,
    cert_flags:   null,   // null = fetch failed; object = evaluated (all 6 present)
    fetchFailed:  false,
    sourceInfo:   {},
    truncated:    [],
  };

  // 1. Homepage (required)
  const homeHtml = await fetchWithSem(base);
  if (!homeHtml) {
    out.fetchFailed = true;
    return out;
  }

  out.description = extractMetaDesc(homeHtml);
  if (out.description) out.sourceInfo.description = { source: 'website_meta', at: nowIso() };

  const homeText = htmlToText(homeHtml);

  // 2. About page (fallback to homepage text if none found)
  const aboutFetch = await tryPaths(base, ABOUT_PATHS);
  let aboutText;
  if (aboutFetch) {
    aboutText = htmlToText(aboutFetch.html);
    out.sourceInfo.about_text = { source: 'website_om_oss', at: nowIso(), path: aboutFetch.path };
  } else {
    aboutText = homeText;
    out.sourceInfo.about_text = { source: 'website_homepage_fallback', at: nowIso() };
  }
  if (aboutText.length > MAX_ABOUT_CHARS) {
    out.truncated.push('about_text');
    aboutText = aboutText.slice(0, MAX_ABOUT_CHARS);
  }
  out.about_text = aboutText || null;

  // 3. Services page (leave NULL if not found — don't fall back to homepage)
  const serviceFetch = await tryPaths(base, SERVICE_PATHS);
  let serviceText = null;
  if (serviceFetch) {
    serviceText = htmlToText(serviceFetch.html);
    if (serviceText.length > MAX_SVCTEXT_CHARS) {
      out.truncated.push('services_text');
      serviceText = serviceText.slice(0, MAX_SVCTEXT_CHARS);
    }
    out.services_text = serviceText || null;
    out.sourceInfo.services_text = { source: 'website_tjanster', at: nowIso(), path: serviceFetch.path };
  }

  // 4. /kontakt — include in cert-flag regex pool but don't store separately
  const kontaktHtml = await fetchWithSem(base + '/kontakt');
  const kontaktText = kontaktHtml ? htmlToText(kontaktHtml) : '';

  // 5. Cert-flag regexes on combined text
  const combined = [homeText, aboutText, serviceText || '', kontaktText].join(' ');
  const flags = {};
  const certAt = nowIso();
  const certSource = { source: 'cert_flag_scraper', at: certAt };
  for (const [field, re] of Object.entries(CERT_MATCHERS)) {
    flags[field] = re.test(combined);
    out.sourceInfo[field] = certSource;
  }
  out.cert_flags = flags;

  return out;
}

// ── Paginated fetch of target rows ────────────────────────────────────────────

async function fetchTargetRows() {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('discovered_shops')
      .select('id, website, sources')
      .eq('state', 'Stockholms län')
      .is('rot_advertised', null)
      .not('website', 'is', null)
      .order('id')
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  return rows;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Stockholm cert-flag + description scraper — Phase SE-Stockholm-3 Pass A ===\n');

  // Open scrape_runs row
  console.log('Opening scrape_runs row...');
  const { data: runRow, error: runErr } = await supabase
    .from('scrape_runs')
    .insert({
      source: 'cert_flag_scraper',
      scope:  'stockholm_metro_cert_flags',
      status: 'running',
      meta: {
        fetcher:       'node-fetch+cheerio',
        concurrency:   CONCURRENCY,
        timeout_ms:    TIMEOUT_MS,
        paths_tried:   [...ABOUT_PATHS, ...SERVICE_PATHS, '/kontakt'],
      },
    })
    .select('id')
    .single();

  if (runErr) { console.error('Failed to open scrape_runs:', runErr.message); process.exit(1); }
  const PASS_A_RUN_ID = runRow.id;
  console.log(`Pass A run ID: ${PASS_A_RUN_ID}\n`);

  // Fetch targets
  console.log('Fetching target rows...');
  let targetRows;
  try { targetRows = await fetchTargetRows(); }
  catch (e) { console.error('Failed to fetch targets:', e.message); process.exit(1); }
  console.log(`Target rows (state=Stockholms län, website IS NOT NULL, rot_advertised IS NULL): ${targetRows.length}\n`);

  if (targetRows.length === 0) {
    console.log('No targets — nothing to do.');
    await supabase.from('scrape_runs').update({ status: 'complete', completed_at: nowIso(), rows_fetched: 0, rows_updated: 0, cost_usd: 0, notes: 'No targets.' }).eq('id', PASS_A_RUN_ID);
    return;
  }

  // Launch all fetches (semaphore limits concurrency to CONCURRENCY)
  console.log(`Launching ${targetRows.length} fetch jobs (concurrency=${CONCURRENCY})...\n`);
  let fetchDone = 0;

  const allResults = await Promise.all(
    targetRows.map(async (shop) => {
      const result = await processShop(shop);
      fetchDone++;
      if (fetchDone % 100 === 0 || fetchDone === targetRows.length) {
        process.stdout.write(`\r  Fetched: ${fetchDone}/${targetRows.length}  `);
      }
      return { shop, result };
    })
  );
  console.log('\n  All fetches complete.\n');

  // DB writes
  console.log('Writing enrichment updates to DB...');
  let shopsUpdated = 0;
  let fetchFailed = 0;
  const truncationNotes = [];

  for (let i = 0; i < allResults.length; i += UPDATE_BATCH) {
    const slice = allResults.slice(i, i + UPDATE_BATCH);
    await Promise.all(slice.map(async ({ shop, result: r }) => {
      if (r.fetchFailed) {
        fetchFailed++;
        // Record fetch-failed attempt — cert flags stay NULL (3-state semantic)
        const { error: evErr } = await supabase.from('data_source_events').insert({
          shop_id:          shop.id,
          run_id:           PASS_A_RUN_ID,
          source:           'cert_flag_scraper',
          event_type:       'fetch_failed',
          fields_changed:   [],
          match_method:     'shop_id',
          match_confidence: 1.0,
        });
        if (evErr) console.warn(`data_source_events error (fetch_failed) ${shop.id}:`, evErr.message);
        return;
      }

      // Build update payload — only include fields we actually have values for
      const update = {};
      const changedFields = [];

      if (r.description !== null)   { update.description   = r.description;   changedFields.push('description'); }
      if (r.about_text !== null)    { update.about_text    = r.about_text;    changedFields.push('about_text'); }
      if (r.services_text !== null) { update.services_text = r.services_text; changedFields.push('services_text'); }

      if (r.cert_flags) {
        for (const field of CERT_FLAG_FIELDS) {
          update[field] = r.cert_flags[field];
          changedFields.push(field);
        }
      }

      // Merge sources (preserve existing provenance)
      const mergedSources = { ...(shop.sources || {}), ...r.sourceInfo };
      update.sources = mergedSources;
      update.last_enriched_at = nowIso();

      // Apply update
      const { error: upErr } = await supabase
        .from('discovered_shops')
        .update(update)
        .eq('id', shop.id);

      if (upErr) {
        console.warn(`\nUpdate error for shop ${shop.id}:`, upErr.message);
        return;
      }
      shopsUpdated++;

      // Record data_source_events
      const { error: evErr } = await supabase.from('data_source_events').insert({
        shop_id:          shop.id,
        run_id:           PASS_A_RUN_ID,
        source:           'cert_flag_scraper',
        event_type:       'update',
        fields_changed:   changedFields,
        match_method:     'shop_id',
        match_confidence: 1.0,
      });
      if (evErr) console.warn(`data_source_events error ${shop.id}:`, evErr.message);

      if (r.truncated.length > 0) truncationNotes.push(`${shop.id}: ${r.truncated.join(',')}`);
    }));

    if (i % (UPDATE_BATCH * 10) === 0 || i + UPDATE_BATCH >= allResults.length) {
      process.stdout.write(`\r  Written: ${Math.min(i + UPDATE_BATCH, allResults.length)}/${allResults.length}  `);
    }
  }
  console.log('\n  DB writes complete.\n');

  const totalAttempted = targetRows.length;
  const notes = [
    `Pass A: ${totalAttempted} shops targeted.`,
    `${shopsUpdated} shops updated (cert flags + text fields).`,
    `${fetchFailed} fetch failures — cert flags stay NULL.`,
    truncationNotes.length > 0
      ? `${truncationNotes.length} pages truncated at 20k chars.`
      : 'No pages required truncation.',
  ].join(' ');

  // Close run
  const { error: closeErr } = await supabase
    .from('scrape_runs')
    .update({
      status:         'complete',
      completed_at:   nowIso(),
      rows_fetched:   totalAttempted,
      rows_inserted:  0,
      rows_updated:   shopsUpdated,
      rows_unmatched: fetchFailed,
      cost_usd:       0,
      notes,
    })
    .eq('id', PASS_A_RUN_ID);

  if (closeErr) console.warn('Failed to close scrape_runs:', closeErr.message);
  else console.log('scrape_runs closed.\n');

  console.log('=== PASS A SUMMARY ===');
  console.log(`  Pass A run ID:      ${PASS_A_RUN_ID}`);
  console.log(`  Shops targeted:     ${totalAttempted}`);
  console.log(`  Shops updated:      ${shopsUpdated}`);
  console.log(`  Fetch failures:     ${fetchFailed} (cert flags remain NULL)`);
  console.log(`  Pages truncated:    ${truncationNotes.length}`);
  console.log(`  Apify cost:         $0.00`);
  console.log();
}

main().catch(e => {
  console.error('\nFatal error:', e);
  process.exit(1);
});

/**
 * Stockholm metro Google Maps scrape — Phase SE-Stockholm-2 Pass A (gap-fill)
 *
 * Re-queues the 28 cells missed in Phase 1 (concurrent-memory cap hit at job 32)
 * plus sub-grids the one saturated cell (byggfirma @ Stockholm central → 4 quadrant cells).
 *
 * Total: 28 missed + 4 sub-grid = 32 Apify jobs.
 *
 * Key difference from Phase 1: jobs are launched in WAVES of 5, and each wave
 * is polled to completion before the next wave starts — prevents memory cap.
 *
 * Merge-not-clobber upsert: existing Phase-1 rows only have NULLs filled in;
 * non-NULL fields are not overwritten.
 *
 * Run:
 *   node scripts/orchestrate-stockholm-gapfill.mjs
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
import { normalizedDomain, normalizedPhone, normalizedName } from './lib/normalize.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Walk up the directory tree to find .env.local
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

// ── Config ─────────────────────────────────────────────────────────────────────

const PHASE1_RUN_ID = 'ceea8d09-7e9e-4236-a10d-7a2f4404e699';
const APIFY_TOKEN   = process.env.APIFY_TOKEN;
const KB_URL        = process.env.KUNDBOLAGET_SUPABASE_URL;
const KB_KEY        = process.env.KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY;

for (const [k, v] of [['APIFY_TOKEN', APIFY_TOKEN], ['KUNDBOLAGET_SUPABASE_URL', KB_URL], ['KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY', KB_KEY]]) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const supabase = createClient(KB_URL, KB_KEY, { auth: { persistSession: false } });

const WAVE_SIZE = 5; // launch ≤5 concurrent Apify jobs per wave

// ── Gap-fill grid ─────────────────────────────────────────────────────────────

// Phase 1 launched 32/60 jobs — the first 30 (geos 0-4 × 6 primary terms) + Södertälje
// jobs 31-32 (byggföretag, byggfirma) before the concurrent-memory cap hit.
// Missing jobs:
//   - Södertälje × 4 primary terms (elektriker, rörmokare, snickare, målare)
//   - Nacka/Täby × 6 primary terms (all missed)
//   - Secondary terms × geos 0, 1, 5 (Stockholm central, N, Södertälje) = 18 jobs
//   - Sub-grid: byggfirma @ Stockholm central split into 4 quadrant cells

const GEO_SODERTÄLJE  = { name: 'Södertälje',   lat: 59.1955, lng: 17.6252, radius: 10000 };
const GEO_NACKA_TÄBY  = { name: 'Nacka/Täby',    lat: 59.3100, lng: 18.1700, radius: 10000 };
const GEO_STOCKHOLM_C = { name: 'Stockholm central', lat: 59.3293, lng: 18.0686, radius: 20000 };
const GEO_STOCKHOLM_N = { name: 'Stockholm offset N', lat: 59.4293, lng: 18.0686, radius: 15000 };

// Secondary-term geos (indices 0, 1, 5 from Phase 1)
const SECONDARY_GEOS = [GEO_STOCKHOLM_C, GEO_STOCKHOLM_N, GEO_SODERTÄLJE];

const PRIMARY_TERMS_SÖDERTÄLJE_MISSING   = ['elektriker', 'rörmokare', 'snickare', 'målare'];
const PRIMARY_TERMS_NACKA_TÄBY_ALL       = ['byggföretag', 'byggfirma', 'elektriker', 'rörmokare', 'snickare', 'målare'];
const SECONDARY_TERMS                    = ['kakelsättare', 'golvläggare', 'takläggare', 'plåtslagare', 'ventilation', 'markarbete'];

// Sub-grid for saturated byggfirma @ Stockholm central cell (4 quadrant cells)
const SUBGRID_CELLS = [
  { name: 'byggfirma-subgrid-NE', lat: 59.3893, lng: 18.1400, radius: 10000, term: 'byggfirma' },
  { name: 'byggfirma-subgrid-NW', lat: 59.3893, lng: 17.9972, radius: 10000, term: 'byggfirma' },
  { name: 'byggfirma-subgrid-SE', lat: 59.2693, lng: 18.1400, radius: 10000, term: 'byggfirma' },
  { name: 'byggfirma-subgrid-SW', lat: 59.2693, lng: 17.9972, radius: 10000, term: 'byggfirma' },
];

// Build 32 gap-fill jobs
const GAP_JOBS = [];

// Södertälje: 4 missing primary terms
for (const term of PRIMARY_TERMS_SÖDERTÄLJE_MISSING) {
  GAP_JOBS.push({ geo: GEO_SODERTÄLJE, term, label: `${term}@Södertälje` });
}

// Nacka/Täby: all 6 primary terms
for (const term of PRIMARY_TERMS_NACKA_TÄBY_ALL) {
  GAP_JOBS.push({ geo: GEO_NACKA_TÄBY, term, label: `${term}@Nacka/Täby` });
}

// Secondary terms: 3 geos × 6 terms = 18 jobs
for (const geo of SECONDARY_GEOS) {
  for (const term of SECONDARY_TERMS) {
    GAP_JOBS.push({ geo, term, label: `${term}@${geo.name}` });
  }
}

// Sub-grid byggfirma cells: 4 jobs
for (const cell of SUBGRID_CELLS) {
  GAP_JOBS.push({ geo: { name: cell.name, lat: cell.lat, lng: cell.lng, radius: cell.radius }, term: cell.term, label: `${cell.term}@${cell.name}` });
}

console.log(`Gap-fill jobs: ${GAP_JOBS.length}`);
// Verify 32
if (GAP_JOBS.length !== 32) {
  console.error(`Expected 32 jobs, got ${GAP_JOBS.length}. Aborting.`);
  process.exit(1);
}

// ── Category filters (same as Phase 1) ───────────────────────────────────────

const INCLUDE_CATEGORIES = new Set([
  'general contractor', 'builder', 'construction company', 'electrician', 'plumber',
  'carpenter', 'painter', 'roofer', 'tiler', 'flooring contractor', 'tile contractor',
  'metal fabricator', 'roofing contractor', 'masonry contractor', 'excavating contractor',
  'hvac contractor', 'air conditioning contractor', 'bathroom remodeler', 'kitchen remodeler',
  'drywall contractor', 'insulation contractor', 'landscaper', 'paving contractor',
  'concrete contractor', 'framing contractor', 'handyman',
  'byggnadsarbetare', 'hantverkare', 'byggentreprenör', 'elektrisk installatör',
  'rörmokeri', 'snickeri', 'måleri', 'takläggare', 'golvläggare', 'kakel',
]);

const EXCLUDE_CATEGORIES = new Set([
  'hardware store', 'building materials store', 'home improvement store',
  'furniture store', 'appliance store', 'real estate agency', 'architect',
  'interior designer', 'lighting store', 'paint store', 'chimney sweep',
  'fence supplier', 'lumber store',
]);

function passesFilter(categories) {
  if (!categories || categories.length === 0) return true;
  const lower = categories.map(c => c.toLowerCase());
  if (lower.every(c => EXCLUDE_CATEGORIES.has(c))) return false;
  return true; // keep everything not all-excluded
}

// ── Apify helpers ─────────────────────────────────────────────────────────────

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

async function launchGoogleMapsJob(job) {
  const { geo, term } = job;
  const body = {
    searchStringsArray: [term],
    customGeolocation: {
      type: 'Point',
      coordinates: [geo.lng, geo.lat],
      radiusMeters: geo.radius,
    },
    maxCrawledPlacesPerSearch: 500,
    scrapeContacts: true,
    language: 'sv',
    includeHistogram: false,
    includeOpeningHours: true,
  };
  const data = await apifyPost('/acts/compass~crawler-google-places/runs', body);
  return data.data?.id || data.id;
}

async function pollRunUntilDone(runId, jobLabel, maxWaitMs = 45 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await sleep(20000);
    const data = await apifyGet(`/actor-runs/${runId}`);
    const status = data.data?.status;
    if (status === 'SUCCEEDED') return data.data;
    if (['FAILED', 'TIMED-OUT', 'ABORTED'].includes(status)) {
      throw new Error(`Run ${runId} (${jobLabel}) ended with status ${status}`);
    }
    process.stdout.write('.');
  }
  throw new Error(`Run ${runId} (${jobLabel}) timed out after ${maxWaitMs / 60000} min`);
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

async function getApifyRunCost(runId) {
  try {
    const data = await apifyGet(`/actor-runs/${runId}`);
    return data.data?.stats?.computeUnitsMillis
      ? data.data.stats.computeUnitsMillis / 1000 * 0.0025 // rough cost in USD
      : (data.data?.usageTotalUsd ?? 0);
  } catch { return 0; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Map Apify place to discovered_shops row ───────────────────────────────────

function nowIso() { return new Date().toISOString(); }

function mapPlaceToRow(place) {
  const website = place.website || null;
  const phone   = place.phone   || null;
  const allCats = place.categories || [];

  return {
    name:                place.title || place.name || null,
    google_place_id:     place.placeId || place.id || null,
    phone,
    website,
    domain:              website ? normalizedDomain(website) : null,
    all_categories:      allCats.length ? allCats : null,
    category:            allCats[0] || null,
    address:             place.address || null,
    street:              place.street || null,
    city:                place.city || null,
    postal_code:         place.postalCode || null,
    state:               place.state || 'Stockholms län',
    country:             place.country || 'Sweden',
    country_code:        place.countryCode || 'SE',
    latitude:            place.location?.lat ?? null,
    longitude:           place.location?.lng ?? null,
    google_rating:       place.totalScore ?? null,
    google_review_count: place.reviewsCount ?? null,
    google_maps_url:     place.url || null,
    opening_hours:       place.openingHours?.length ? place.openingHours : null,
    all_emails:          place.emails?.length ? place.emails : null,
    primary_email:       place.emails?.[0] || null,
    all_phones:          place.phones?.length ? place.phones : (phone ? [phone] : null),
    instagram_url:       place.instagram || place.instagramUrl || null,
    facebook_url:        place.facebook  || place.facebookUrl  || null,
    linkedin_url:        place.linkedin  || place.linkedinUrl  || null,
    source:              'google_maps',
    status:              'new',
    scraped_at:          nowIso(),
    normalized_domain:   website ? normalizedDomain(website) : null,
    normalized_phone:    phone   ? normalizedPhone(phone, 'SE') : null,
    normalized_name:     normalizedName(place.title || place.name),
    sources: cleanSources({
      name:    { source: 'google_maps', at: nowIso() },
      phone:   phone   ? { source: 'google_maps', at: nowIso() } : undefined,
      website: website ? { source: 'google_maps', at: nowIso() } : undefined,
      address: place.address ? { source: 'google_maps', at: nowIso() } : undefined,
    }),
  };
}

function cleanSources(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// ── Merge-not-clobber upsert ──────────────────────────────────────────────────
// For rows that collide with existing Phase-1 shops (same google_place_id),
// only fill NULL fields — do not overwrite non-NULL existing data.

const BATCH_SIZE = 50;

async function upsertWithMerge(newRows, passARunId) {
  const withPlaceId    = newRows.filter(r => r.google_place_id);
  const withoutPlaceId = newRows.filter(r => !r.google_place_id);

  let inserted = 0;
  let updated  = 0;

  if (withPlaceId.length) {
    for (let i = 0; i < withPlaceId.length; i += BATCH_SIZE) {
      const batch = withPlaceId.slice(i, i + BATCH_SIZE);
      const placeIds = batch.map(r => r.google_place_id);

      // Fetch existing rows so we can do merge
      const { data: existing, error: fetchErr } = await supabase
        .from('discovered_shops')
        .select('id, google_place_id, name, phone, website, domain, address, city, postal_code, latitude, longitude, google_rating, google_review_count, all_categories, category, opening_hours, primary_email, all_emails, all_phones, instagram_url, facebook_url, linkedin_url, normalized_domain, normalized_phone, normalized_name, sources, status')
        .in('google_place_id', placeIds);

      if (fetchErr) throw new Error(`Fetch existing error: ${fetchErr.message}`);

      const existingMap = new Map((existing || []).map(r => [r.google_place_id, r]));

      const toInsert = [];
      const toUpdate = [];

      for (const newRow of batch) {
        const ex = existingMap.get(newRow.google_place_id);
        if (!ex) {
          toInsert.push(newRow);
        } else {
          // Merge: only fill NULLs
          const merged = { id: ex.id };
          const changedFields = [];
          const arrayFields = ['all_emails', 'all_phones', 'all_categories'];
          const scalarFields = ['phone', 'website', 'domain', 'address', 'city', 'postal_code',
            'latitude', 'longitude', 'google_rating', 'google_review_count', 'category',
            'opening_hours', 'primary_email', 'instagram_url', 'facebook_url', 'linkedin_url',
            'normalized_domain', 'normalized_phone', 'normalized_name', 'scraped_at'];

          for (const field of scalarFields) {
            if (ex[field] == null && newRow[field] != null) {
              merged[field] = newRow[field];
              changedFields.push(field);
            }
          }

          // For arrays: union existing + new
          for (const field of arrayFields) {
            const exArr = ex[field] || [];
            const newArr = newRow[field] || [];
            if (newArr.length > 0) {
              const union = [...new Set([...exArr, ...newArr])];
              if (union.length > exArr.length) {
                merged[field] = union;
                changedFields.push(field);
              }
            }
          }

          // Merge sources JSONB — add entries for fields we're filling
          if (changedFields.length > 0) {
            const existingSources = ex.sources || {};
            const newSources = newRow.sources || {};
            const mergedSources = { ...existingSources };
            for (const field of changedFields) {
              if (newSources[field]) mergedSources[field] = newSources[field];
            }
            merged.sources = mergedSources;
            toUpdate.push({ row: merged, changedFields, shopId: ex.id });
          }
        }
      }

      // Insert new rows
      if (toInsert.length) {
        const { data: ins, error: insErr } = await supabase
          .from('discovered_shops')
          .insert(toInsert)
          .select('id, google_place_id');
        if (insErr) { console.warn('Insert error:', insErr.message); }
        else {
          inserted += (ins || []).length;
          const events = (ins || []).map(r => ({
            shop_id: r.id, run_id: passARunId, source: 'google_maps', event_type: 'insert',
            fields_changed: Object.keys(toInsert.find(row => row.google_place_id === r.google_place_id) || {}),
            match_method: 'google_place_id', match_confidence: 1.0,
          }));
          if (events.length) {
            const { error: evErr } = await supabase.from('data_source_events').insert(events);
            if (evErr) console.warn('data_source_events insert error:', evErr.message);
          }
        }
      }

      // Update merged rows
      for (const { row, changedFields, shopId } of toUpdate) {
        if (Object.keys(row).length <= 1) continue; // only id, nothing to update
        const { error: upErr } = await supabase
          .from('discovered_shops')
          .update(row)
          .eq('id', shopId);
        if (upErr) { console.warn(`Update error for ${shopId}:`, upErr.message); continue; }
        updated++;

        const { error: evErr } = await supabase.from('data_source_events').insert({
          shop_id: shopId, run_id: passARunId, source: 'google_maps', event_type: 'update',
          fields_changed: changedFields, match_method: 'google_place_id', match_confidence: 1.0,
        });
        if (evErr) console.warn('data_source_events update-event error:', evErr.message);
      }

      process.stdout.write(`\r  Upserted ${Math.min(i + BATCH_SIZE, withPlaceId.length)}/${withPlaceId.length}`);
    }
    console.log();
  }

  // Rows without google_place_id: simple insert
  for (let i = 0; i < withoutPlaceId.length; i += BATCH_SIZE) {
    const batch = withoutPlaceId.slice(i, i + BATCH_SIZE);
    const { data: ins, error } = await supabase
      .from('discovered_shops')
      .insert(batch)
      .select('id');
    if (error) { console.warn('Insert (no place_id) error:', error.message); continue; }
    const events = (ins || []).map(r => ({
      shop_id: r.id, run_id: passARunId, source: 'google_maps', event_type: 'insert',
      fields_changed: ['name', 'phone', 'website'],
      match_method: 'none', match_confidence: null,
    }));
    if (events.length) await supabase.from('data_source_events').insert(events);
    inserted += (ins || []).length;
  }

  return { inserted, updated };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Stockholm metro gap-fill — Phase SE-Stockholm-2 Pass A ===');
  console.log(`Parent Phase-1 run: ${PHASE1_RUN_ID}`);
  console.log(`Jobs to launch: ${GAP_JOBS.length} (28 missed + 4 sub-grid)\n`);

  // ── Open scrape_runs row ──────────────────────────────────────────────────
  console.log('Opening scrape_runs row...');
  const { data: runRow, error: runErr } = await supabase
    .from('scrape_runs')
    .insert({
      source: 'google_maps',
      scope:  'stockholm_metro_gapfill',
      status: 'running',
      meta: {
        purpose:          'Re-queue 28 missed cells + 4-way sub-grid on byggfirma @ Stockholm central',
        parent_run_id:    PHASE1_RUN_ID,
        batch_concurrency: WAVE_SIZE,
        total_jobs:       GAP_JOBS.length,
      },
    })
    .select('id')
    .single();

  if (runErr) { console.error('Failed to open scrape_runs:', runErr.message); process.exit(1); }
  const PASS_A_RUN_ID = runRow.id;
  console.log(`Pass A run ID: ${PASS_A_RUN_ID}\n`);

  // ── Launch jobs in waves ──────────────────────────────────────────────────
  const allPlaces = new Map(); // dedupeKey → row
  let totalFetched  = 0;
  let totalFiltered = 0;
  const saturatedCells = [];
  const failedJobs = [];
  let totalCostUsd = 0;

  console.log(`Launching ${GAP_JOBS.length} jobs in waves of ${WAVE_SIZE}...\n`);

  for (let waveStart = 0; waveStart < GAP_JOBS.length; waveStart += WAVE_SIZE) {
    const wave = GAP_JOBS.slice(waveStart, waveStart + WAVE_SIZE);
    const waveNum = Math.floor(waveStart / WAVE_SIZE) + 1;
    const totalWaves = Math.ceil(GAP_JOBS.length / WAVE_SIZE);
    console.log(`\n--- Wave ${waveNum}/${totalWaves} (jobs ${waveStart + 1}–${waveStart + wave.length}) ---`);

    // Launch all jobs in this wave
    const launched = await Promise.all(wave.map(async (job, idx) => {
      try {
        const runId = await launchGoogleMapsJob(job);
        console.log(`  [${waveStart + idx + 1}/${GAP_JOBS.length}] launched: ${job.label} → ${runId}`);
        return { job, runId, error: null };
      } catch (e) {
        console.warn(`  FAILED to launch: ${job.label}: ${e.message}`);
        failedJobs.push({ label: job.label, error: e.message });
        return { job, runId: null, error: e.message };
      }
    }));

    // Poll this wave to completion before launching next wave
    const active = launched.filter(j => j.runId);
    console.log(`  Polling ${active.length} runs to completion...`);

    await Promise.all(active.map(async ({ job, runId }) => {
      try {
        const runData = await pollRunUntilDone(runId, job.label);
        const items = await fetchDatasetItems(runData.defaultDatasetId);
        totalFetched += items.length;
        totalCostUsd += await getApifyRunCost(runId);

        let kept = 0;
        for (const place of items) {
          if (!passesFilter(place.categories || [])) { totalFiltered++; continue; }
          const row = mapPlaceToRow(place);
          if (!row.name) continue;
          const dedupeKey = row.google_place_id || (row.normalized_name + '|' + (row.postal_code || ''));
          if (!allPlaces.has(dedupeKey)) {
            allPlaces.set(dedupeKey, row);
            kept++;
          }
        }

        const hitCap = items.length >= 500;
        if (hitCap) {
          saturatedCells.push(job.label);
          console.log(`\n  ⚠️  HIT 500-CAP: ${job.label} (${items.length} results — flag for sub-grid in Phase 3)`);
        } else {
          console.log(`\n  [done] ${job.label}: ${items.length} raw → ${kept} kept`);
        }
      } catch (e) {
        console.warn(`\n  POLL FAILED: ${job.label}: ${e.message}`);
        failedJobs.push({ label: job.label, error: e.message });
      }
    }));

    // Brief pause between waves
    if (waveStart + WAVE_SIZE < GAP_JOBS.length) await sleep(3000);
  }

  const rows = [...allPlaces.values()];
  console.log(`\n\nAll waves complete.`);
  console.log(`  Unique rows after dedup: ${rows.length}`);
  console.log(`  Filtered (exclude set):  ${totalFiltered}`);
  console.log(`  Failed jobs:             ${failedJobs.length}`);
  if (saturatedCells.length) console.log(`  ⚠️  Saturated cells:     ${saturatedCells.join(', ')}`);

  // ── Upsert (merge-not-clobber) ────────────────────────────────────────────
  console.log('\nUpserting to discovered_shops (merge-not-clobber)...');
  let totalInserted = 0;
  let totalUpdated  = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { inserted, updated } = await upsertWithMerge(batch, PASS_A_RUN_ID);
    totalInserted += inserted;
    totalUpdated  += updated;
  }

  console.log(`  Inserted (new rows): ${totalInserted}`);
  console.log(`  Updated (merged):    ${totalUpdated}`);

  // ── Persist saturated_cells to meta, close run ────────────────────────────
  console.log('\nClosing scrape_runs row...');
  const notes = [
    `Pass A: ${GAP_JOBS.length} jobs (28 missed + 4 sub-grid).`,
    `Failed to launch/poll: ${failedJobs.length > 0 ? failedJobs.map(j => j.label).join(', ') : 'none'}.`,
    saturatedCells.length ? `Saturated cells (500-cap hit): ${saturatedCells.join(', ')}.` : 'No new saturated cells.',
  ].join(' ');

  const { error: closeErr } = await supabase
    .from('scrape_runs')
    .update({
      status:          'complete',
      completed_at:    nowIso(),
      rows_fetched:    totalFetched,
      rows_inserted:   totalInserted,
      rows_updated:    totalUpdated,
      rows_unmatched:  totalFiltered,
      cost_usd:        totalCostUsd > 0 ? parseFloat(totalCostUsd.toFixed(4)) : null,
      notes,
      meta: {
        purpose:           'Re-queue 28 missed cells + 4-way sub-grid on byggfirma @ Stockholm central',
        parent_run_id:     PHASE1_RUN_ID,
        batch_concurrency: WAVE_SIZE,
        total_jobs:        GAP_JOBS.length,
        saturated_cells:   saturatedCells,
        failed_jobs:       failedJobs,
      },
    })
    .eq('id', PASS_A_RUN_ID);

  if (closeErr) console.warn('Failed to close scrape_runs:', closeErr.message);
  else console.log('scrape_runs closed.');

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log('\n=== PASS A SUMMARY ===');
  console.log(`  Pass A run ID:     ${PASS_A_RUN_ID}`);
  console.log(`  Jobs launched:     ${GAP_JOBS.length - failedJobs.length}/${GAP_JOBS.length}`);
  console.log(`  Total Apify rows:  ${totalFetched}`);
  console.log(`  Filtered:          ${totalFiltered}`);
  console.log(`  Unique kept:       ${rows.length}`);
  console.log(`  Inserted:          ${totalInserted}`);
  console.log(`  Merged (updated):  ${totalUpdated}`);
  if (totalCostUsd > 0) console.log(`  Apify cost:        $${totalCostUsd.toFixed(4)}`);
  if (saturatedCells.length) console.log(`  ⚠️  Saturated:    ${saturatedCells.join(', ')}`);
  if (failedJobs.length)     console.log(`  ❌ Failed:        ${failedJobs.map(j => j.label).join(', ')}`);

  return {
    passARunId: PASS_A_RUN_ID,
    inserted: totalInserted,
    updated: totalUpdated,
    totalRows: rows.length,
  };
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

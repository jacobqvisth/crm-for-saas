/**
 * ServiceFinder scraper — Phase SE-Stockholm-4a (pilot) + Phase SE-Stockholm-4b (national)
 *
 * Modes:
 *   Default (no flags):  Stockholm pilot — discovery crawl via hard-coded cities, Stockholm filter
 *   --national:          National run — sitemap-based ID universe, concurrent category crawl, no geo filter
 *
 * Run:
 *   node scripts/scrape-servicefinder.mjs [--national] [--run-id <uuid>] [--dry-run]
 *
 * Requires env (loaded from .env.local):
 *   KUNDBOLAGET_SUPABASE_URL
 *   KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY
 */

import { load } from 'cheerio';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  normalizeDomain,
  normalizePhone,
  normalizeName,
  makeReviewId,
  isStockholmsLan,
  postalToState,
} from './lib/normalize.mjs';
import { upsertShop, upsertReview } from './lib/shop-merger.mjs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Load .env.local
let envPath = null;
for (const candidate of [join(ROOT, '.env.local'), join(ROOT, '..', '.env.local')]) {
  if (existsSync(candidate)) { envPath = candidate; break; }
}
if (envPath) dotenv.config({ path: envPath });

const SUPABASE_URL = process.env.KUNDBOLAGET_SUPABASE_URL;
const SUPABASE_KEY = process.env.KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing KUNDBOLAGET_SUPABASE_URL or KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run');
const NATIONAL = ARGS.includes('--national');
const RUN_ID_ARG = (() => {
  const idx = ARGS.indexOf('--run-id');
  return idx >= 0 ? ARGS[idx + 1] : null;
})();

// Pre-created run ID for Stockholm pilot (4a legacy)
const PILOT_RUN_ID = RUN_ID_ARG || 'bf3150ba-b072-4c74-a466-000a2ad91dd7';

const BASE_URL = 'https://servicefinder.se';
const UA = 'Kundbolaget-ContractorIndex/1.0 (+https://kundbolaget.se/contact; jacob@wrenchlane.com)';
const RATE_MS = Math.ceil(1000 / 1.5); // ~667ms between requests
const CHECKPOINT_EVERY = 100;

const TRADE_SLUGS = [
  'elektriker',
  'rormokare',
  'vvs-ror',
  'stambyte',
  'snickare',
  'murare',
  'tak',
  'taklaggare',
  'totalentreprenad',
];

// Legacy pilot cities (Stockholm)
const DISCOVERY_CITIES_STOCKHOLM = [
  'stockholm',
  'solna',
  'sundbyberg',
  'nacka',
  'taby',
  'huddinge',
  'sodertalje',
  'jarfalla',
  'lidingo',
  'vaxholm',
  'vallentuna',
  'upplands-vasby',
  'sigtuna',
  'nynashamn',
  'haninge',
  'tyreso',
  'botkyrka',
  'salem',
  'ekeroe',
  'upplands-bro',
  'norrtaelje',
  'danderyd',
  'sollentuna',
  'ekerö',
];

const MAX_PAGES_PER_COMBO = 15;

// Category mapping: first match in priority order wins
const CATEGORY_MAP = [
  { slugs: ['elektriker'],                          category: 'electrical' },
  { slugs: ['rormokare', 'vvs-ror', 'stambyte'],   category: 'plumbing' },
  { slugs: ['snickare'],                             category: 'carpentry' },
  { slugs: ['murare'],                               category: 'masonry' },
  { slugs: ['tak', 'taklaggare', 'platslagare'],    category: 'roofing' },
  { slugs: ['totalentreprenad'],                     category: 'construction' },
  { slugs: ['malare', 'malning-tapetsering'],        category: 'painting' },
];

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

let consecutiveRateLimits = 0;

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(url, retries = 3, backoffMs = 3000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'sv-SE,sv;q=0.9',
        },
        signal: AbortSignal.timeout(20000),
      });

      if (res.status === 429 || res.status >= 500) {
        consecutiveRateLimits++;
        if (consecutiveRateLimits >= 3) {
          throw new Error(`STOP: 3 consecutive rate-limits/server-errors. Last status: ${res.status}`);
        }
        const wait = backoffMs * Math.pow(3, attempt);
        console.warn(`  [${res.status}] ${url} — backing off ${wait}ms`);
        await delay(wait);
        continue;
      }

      consecutiveRateLimits = 0;

      if (!res.ok) return null; // 404, 410, etc.
      return await res.text();
    } catch (err) {
      if (err.message.startsWith('STOP:')) throw err;
      if (attempt === retries) {
        console.error(`  [fetch error] ${url}: ${err.message}`);
        return null;
      }
      await delay(backoffMs * Math.pow(3, attempt));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sitemap discovery (national mode)
// ---------------------------------------------------------------------------

/**
 * Fetch SF sitemap chain and extract all foretag IDs with their state.
 *
 * SF sitemap hierarchy (3 levels):
 *   /sitemaps/businesses.xml   → sitemapindex: Active, InactiveWithReview, InactiveWithoutReview
 *   /sitemaps/businessesActive.xml → sitemapindex: businessesActive-1.xml, …
 *   /sitemaps/businessesActive-1.xml → urlset: actual /foretag/<id> entries
 *
 * Returns Map<foretagId, 'active' | 'inactive_with_reviews'>
 */
async function discoverFromSitemap() {
  const stateMap = new Map(); // foretagId → state

  // Level 1: businesses.xml lists the state-level sitemapindex files
  console.log('  Fetching businesses.xml...');
  const businessesXml = await fetchPage(`${BASE_URL}/sitemaps/businesses.xml`);
  if (!businessesXml) throw new Error('Failed to fetch businesses.xml');

  const stateIndexUrls = [];
  const locRe = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = locRe.exec(businessesXml)) !== null) {
    const url = m[1];
    if (url.includes('businessesActive') || url.includes('businessesInactiveWithReview')) {
      stateIndexUrls.push(url);
    }
  }
  console.log(`  Found ${stateIndexUrls.length} state-level sitemap index files`);

  // Level 2: each state-level file is itself a sitemapindex with numbered sub-sitemaps
  const leafSitemaps = []; // { url, state }
  for (const indexUrl of stateIndexUrls) {
    const isActive = indexUrl.includes('businessesActive') && !indexUrl.includes('Inactive');
    const state = isActive ? 'active' : 'inactive_with_reviews';

    await delay(RATE_MS);
    const xml = await fetchPage(indexUrl);
    if (!xml) { console.warn(`  [skip] ${indexUrl}`); continue; }

    const subRe = /<loc>([^<]+)<\/loc>/g;
    let sm;
    while ((sm = subRe.exec(xml)) !== null) {
      const url = sm[1];
      // Numbered leaf sitemaps end in -N.xml (e.g. businessesActive-1.xml)
      if (/-\d+\.xml$/.test(url)) {
        leafSitemaps.push({ url, state });
      }
    }
  }
  console.log(`  Found ${leafSitemaps.length} leaf sitemap files`);

  // Level 3: fetch each leaf sitemap and collect foretag IDs
  for (const { url: sitemapUrl, state } of leafSitemaps) {
    await delay(RATE_MS);
    const xml = await fetchPage(sitemapUrl);
    if (!xml) { console.warn(`  [skip] ${sitemapUrl}`); continue; }

    const profileRe = /<loc>https:\/\/servicefinder\.se\/foretag\/(\d+)<\/loc>/g;
    let pm;
    let count = 0;
    while ((pm = profileRe.exec(xml)) !== null) {
      stateMap.set(pm[1], state);
      count++;
    }
    console.log(`  ${sitemapUrl.split('/').pop()}: ${count} profiles (${state})`);
  }

  console.log(`Sitemap discovery complete: ${stateMap.size} total unique foretag IDs`);
  return stateMap;
}

// ---------------------------------------------------------------------------
// City slug discovery (national mode)
// ---------------------------------------------------------------------------

async function discoverCitySlugs(oneTrade = 'elektriker') {
  const url = `${BASE_URL}/hantverkare/${oneTrade}`;
  const html = await fetchPage(url);
  if (!html) return [];

  const cities = [];
  const re = /href="\/hantverkare\/[^/]+\/([a-z0-9-]+)"/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const city = m[1];
    if (!seen.has(city)) {
      seen.add(city);
      cities.push(city);
    }
  }
  return cities;
}

// ---------------------------------------------------------------------------
// Discovery crawl: trade × city → Map<foretagId, Set<tradeSlug>>
// ---------------------------------------------------------------------------

async function runDiscoveryCrawl(cities) {
  const tradeMap = new Map(); // foretagId (string) → Set<tradeSlug>
  let reqCount = 0;

  for (const trade of TRADE_SLUGS) {
    for (const city of cities) {
      // Paginate each trade/city combo
      for (let page = 1; page <= MAX_PAGES_PER_COMBO; page++) {
        const url = page === 1
          ? `${BASE_URL}/hantverkare/${trade}/${city}`
          : `${BASE_URL}/hantverkare/${trade}/${city}?page=${page}`;

        await delay(RATE_MS);
        const html = await fetchPage(url);
        reqCount++;

        if (!html) break; // 404 or error — stop paginating this combo

        // Extract foretag IDs from href="/foretag/(\d+)"
        const re = /href="\/foretag\/(\d+)"/g;
        let m;
        let newOnPage = 0;
        while ((m = re.exec(html)) !== null) {
          const id = m[1];
          const isNew = !tradeMap.has(id);
          if (!tradeMap.has(id)) tradeMap.set(id, new Set());
          tradeMap.get(id).add(trade);
          if (isNew) newOnPage++;
        }

        if (page === 1 && newOnPage > 0) {
          console.log(`  discovered: ${trade}/${city} p${page} → ${newOnPage} new (${tradeMap.size} total unique)`);
        } else if (page > 1 && newOnPage > 0) {
          console.log(`    p${page} → +${newOnPage} new (${tradeMap.size} total unique)`);
        }

        // Stop if page returned no new profiles (or no profiles at all)
        if (newOnPage === 0) break;

        // Stop if there's no "next page" signal
        if (!html.includes('Nästa sida') && !html.includes('page=' + (page + 1))) break;
      }
    }
  }

  console.log(`Discovery crawl complete: ${tradeMap.size} unique profiles in ${reqCount} requests`);
  return tradeMap;
}

// ---------------------------------------------------------------------------
// ld+json parser
// ---------------------------------------------------------------------------

function parseLdJson(html) {
  const $ = load(html);
  const scripts = $('script[type="application/ld+json"]').toArray();

  for (const el of scripts) {
    try {
      const data = JSON.parse($(el).html() || '');
      if (data && data['@type'] === 'LocalBusiness') return data;
      // Also handle @graph arrays
      if (data && data['@graph']) {
        const lb = data['@graph'].find(n => n['@type'] === 'LocalBusiness');
        if (lb) return lb;
      }
    } catch { /* skip malformed */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTML extractors — 9 "all info" fields
// ---------------------------------------------------------------------------

// Updated in Phase 4b: added f-skattesedel variants
const F_SKATT_RE = /\b(godkänd för f-skatt|innehar f-skatt|f-skatt godkänd|innehavare av f-skatt|med f-skatt|f-skattsedel|f-skattesedel|f\.-skattesedel|innehar f-skattesedel)\b/i;
const BANKID_RE     = /\bverifierad med bankid\b|\bbankid-verifierad\b|\bbankid\s+verifierad\b/i;
const INS_CARRIER_RE = /\b(trygg-hansa|if försäkring|if forsakring|folksam|länsförsäkringar|lansforsakringar|moderna försäkringar|moderna forsakringar|gjensidige|protector)\b/i;
const INS_AMT_RE    = /(\d{1,3})\s*(msek|miljoner kronor|miljoner kr|mkr|mnkr)\b/i;
const INS_KEYWORD_RE = /\b(försäkrad|försäkring|ansvarsförsäkring|forsakring|forsakrad)\b/i;
const WARRANTY_RE   = /(\d{1,2})\s*(?:års?|åriga?)\s*garanti\b|\bgarantitid[:\s]+(\d{1,2})\s*år\b/i;
const SF_JOBS_RE    = /har utfört (\d[\d\s]*) jobb(?:\s*på\s*Servicefinder)?/i;

function extractFSkatt(text, pageParsedOk) {
  if (!pageParsedOk) return null;
  return F_SKATT_RE.test(text) ? true : false;
}

function extractBankId(text) {
  return BANKID_RE.test(text) ? true : false;
}

function extractInsurance(text) {
  const carrierMatch = text.match(INS_CARRIER_RE);
  if (!carrierMatch) return { carrier: null, amount: null };

  const carrier = carrierMatch[0].toLowerCase();
  const keywordIdx = text.search(INS_KEYWORD_RE);
  const carrierIdx = text.search(INS_CARRIER_RE);
  if (keywordIdx < 0) return { carrier, amount: null };

  const nearby = Math.abs(keywordIdx - carrierIdx) < 200;
  if (!nearby) return { carrier, amount: null };

  const amtMatch = text.match(INS_AMT_RE);
  if (!amtMatch) return { carrier, amount: null };

  return { carrier, amount: parseInt(amtMatch[1]) * 1_000_000 };
}

function extractWarranty(text) {
  const m = text.match(WARRANTY_RE);
  if (!m) return null;
  return parseInt(m[1] || m[2]) || null;
}

function extractSfJobs(text) {
  const m = text.match(SF_JOBS_RE);
  if (!m) return null;
  return parseInt(m[1].replace(/\s/g, '')) || null;
}

const SHARED_PLATFORM_DOMAINS = new Set([
  'mittanbudmarketplaces.com', 'mittanbud.com', 'anbud.se', 'byggahus.se',
  'blocket.se', 'hittahem.se', 'hantverkare.se', 'topphantverkare.se',
  'reco.se', 'trustpilot.com', 'allabolag.se', 'hitta.se', 'eniro.se',
  'gulasidorna.se', 'foretaget.se', 'proff.se', 'uc.se',
]);

function extractExternalWebsite(html, $) {
  let found = null;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href.startsWith('http')) return;
    if (found) return;

    const skipDomains = [
      'servicefinder.se', 'facebook.com', 'instagram.com',
      'linkedin.com', 'google.', 'youtube.com', 'twitter.com',
      'x.com', 'tiktok.com',
    ];
    if (skipDomains.some(d => href.includes(d))) return;

    let hostname = '';
    try { hostname = new URL(href).hostname.replace(/^www\./, ''); } catch { return; }
    if (SHARED_PLATFORM_DOMAINS.has(hostname)) return;

    found = href;
  });
  return found;
}

function extractGalleryImages(html, $) {
  const photos = [];
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (
      src.includes('servicefinder') &&
      (src.includes('/uploads/') || src.includes('/photos/') || src.includes('/gallery/')) &&
      !src.includes('placeholder') &&
      !src.includes('avatar') &&
      !src.includes('logo')
    ) {
      photos.push(src);
    }
  });
  return photos.slice(0, 20);
}

function extractPartialOrgNumber(taxId) {
  if (!taxId) return null;
  const clean = taxId.replace(/[\s*-]/g, '').replace(/^0+/, '');
  return clean.length >= 6 ? clean.slice(0, 6) : null;
}

function deriveCategoryFromTrades(tradeSet) {
  for (const { slugs, category } of CATEGORY_MAP) {
    if (slugs.some(s => tradeSet.has(s))) return category;
  }
  return 'construction_other';
}

// ---------------------------------------------------------------------------
// Profile parser
// ---------------------------------------------------------------------------

function parseProfile(html, foretagId, tradeSet, sfState) {
  const $ = load(html);
  const ld = parseLdJson(html);

  const fullText = $.text();
  const pageParsedOk = !!ld;

  // Inactive profiles often lack ld+json name — fall back to <h1> or <title>
  const name = ld?.name
    || $('h1').first().text().replace(/\s+/g, ' ').trim().slice(0, 200) || null
    || $('title').first().text().split('|')[0].replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  const rawPhone = ld?.telephone || null;
  const postalCode = ld?.address?.postalCode?.replace(/\s/g, '') || null;
  const city = ld?.address?.addressLocality || null;
  const address = ld?.address?.streetAddress || null;
  const description = ld?.description?.trim()?.slice(0, 500) || null;
  const logoUrl = (typeof ld?.image === 'string' ? ld.image : ld?.image?.url) || null;

  const sfRating = ld?.aggregateRating?.ratingValue
    ? parseFloat(ld.aggregateRating.ratingValue)
    : null;
  const sfReviewCount = ld?.aggregateRating?.reviewCount
    ? parseInt(ld.aggregateRating.reviewCount)
    : null;

  const areaServed = Array.isArray(ld?.areaServed)
    ? ld.areaServed.map(a => (typeof a === 'string' ? a : a.name)).filter(Boolean)
    : [];

  const website = extractExternalWebsite(html, $);
  const fSkatt = extractFSkatt(fullText, pageParsedOk);
  const bankId = extractBankId(fullText);
  const { carrier: insCarrier, amount: insAmount } = extractInsurance(fullText);
  const warrantyYears = extractWarranty(fullText);
  const sfJobs = extractSfJobs(fullText);
  const photos = extractGalleryImages(html, $);
  const partialOrg = extractPartialOrgNumber(ld?.taxID);

  const rawReviews = Array.isArray(ld?.review) ? ld.review : [];
  const reviews = rawReviews.map(r => ({
    source: 'servicefinder',
    source_review_id: makeReviewId('servicefinder', String(foretagId), r.author?.name, r.datePublished),
    source_profile_id: String(foretagId),
    source_url: `${BASE_URL}/foretag/${foretagId}`,
    author_name: r.author?.name || null,
    rating: parseFloat(r.reviewRating?.ratingValue) || null,
    best_rating: parseFloat(r.reviewRating?.bestRating) || 5.0,
    review_title: r.name || null,
    review_body: r.reviewBody || null,
    published_at: r.datePublished || null,
    language: 'sv',
    raw: r,
  })).filter(r => r.rating !== null);

  const phone = normalizePhone(rawPhone);
  const domain = normalizeDomain(website);
  const normalName = normalizeName(name);
  const state = postalToState(postalCode);
  const category = deriveCategoryFromTrades(tradeSet);

  const sources = {};
  if (name)       sources.name        = 'servicefinder';
  if (phone)      sources.phone       = 'servicefinder';
  if (address)    sources.address     = 'servicefinder';
  if (description) sources.description = 'servicefinder';
  if (logoUrl)    sources.logo_url    = 'servicefinder';
  if (fSkatt !== null) sources.f_skatt_registered = 'servicefinder';
  if (bankId)     sources.bankid_verified = 'servicefinder';
  if (insCarrier) sources.insurance_carrier = 'servicefinder';
  if (warrantyYears) sources.warranty_years = 'servicefinder';
  if (sfJobs)     sources.servicefinder_jobs_completed = 'servicefinder';

  return {
    name,
    phone,
    website: website || null,
    address,
    postal_code: postalCode,
    city,
    country_code: 'SE',
    state,
    latitude: null,
    longitude: null,
    org_number: null,
    partial_org_number: partialOrg,

    servicefinder_id:            String(foretagId),
    servicefinder_url:           `${BASE_URL}/foretag/${foretagId}`,
    servicefinder_rating:        sfRating,
    servicefinder_review_count:  sfReviewCount,
    servicefinder_state:         sfState || 'active',
    servicefinder_area_served:   areaServed.length ? areaServed : null,
    servicefinder_jobs_completed: sfJobs,

    description,
    logo_url: logoUrl,
    photos: photos.length ? photos : null,

    f_skatt_registered: fSkatt,
    bankid_verified:    bankId,
    insurance_carrier:  insCarrier,
    insurance_amount_sek: insAmount,
    warranty_years:     warrantyYears,

    category,
    all_categories: Array.from(tradeSet),

    normalized_domain: domain,
    normalized_phone:  phone,
    normalized_name:   normalName,

    source:     'servicefinder',
    sources,
    scraped_at: new Date().toISOString(),

    reviews,
  };
}

// ---------------------------------------------------------------------------
// Checkpoint helpers
// ---------------------------------------------------------------------------

function checkpointPath(runId, mode) {
  return `/tmp/sf-${mode}-${runId}.json`;
}

function loadCheckpoint(runId, mode) {
  const p = checkpointPath(runId, mode);
  if (!existsSync(p)) return new Set();
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return new Set(data.done || []);
  } catch { return new Set(); }
}

function saveCheckpoint(runId, mode, doneSet) {
  if (DRY_RUN) return;
  writeFileSync(checkpointPath(runId, mode), JSON.stringify({ done: Array.from(doneSet) }));
}

// ---------------------------------------------------------------------------
// National run
// ---------------------------------------------------------------------------

async function runNational() {
  console.log('[SF national] dry_run=' + DRY_RUN);

  // Create run row
  let runId = RUN_ID_ARG;
  if (!runId && !DRY_RUN) {
    const { data, error } = await supabase
      .from('scrape_runs')
      .insert({
        source: 'servicefinder',
        scope: 'national',
        status: 'running',
        meta: {
          rate_req_per_s: 1.5,
          expected_profiles: 4050,
          user_agent: UA,
          review_limit_per_profile: 3,
          review_limit_note: 'SF ld+json only ships 3 most-recent reviews; true total in servicefinder_review_count',
        },
      })
      .select('id')
      .single();
    if (error) { console.error('Failed to create run row:', error.message); process.exit(1); }
    runId = data.id;
    console.log(`Created scrape_run: ${runId}`);
  } else if (!runId) {
    runId = 'dry-run-' + Date.now();
  }

  // Step 1: Sitemap discovery
  console.log('\n=== Sitemap discovery ===');
  const sitemapStateMap = await discoverFromSitemap();

  // Step 2: Category crawl (concurrent with profile fetch, but we do it first for simplicity)
  console.log('\n=== Category crawl: discovering city slugs ===');
  await delay(RATE_MS);
  const cities = await discoverCitySlugs('elektriker');
  console.log(`Discovered ${cities.length} city slugs from SF`);

  if (cities.length === 0) {
    console.warn('City slug discovery returned 0 cities — using fallback list');
  }

  const effectiveCities = cities.length > 0 ? cities : DISCOVERY_CITIES_STOCKHOLM;

  console.log('\n=== Category crawl: trade × city ===');
  const tradeMap = await runDiscoveryCrawl(effectiveCities);

  // Step 3: Profile fetch
  const allIds = Array.from(sitemapStateMap.keys());
  console.log(`\nProfile IDs from sitemap: ${allIds.length}`);

  const done = loadCheckpoint(runId, 'national');
  const toFetch = allIds.filter(id => !done.has(id));
  console.log(`Already done: ${done.size}, remaining: ${toFetch.length}`);

  const stats = { fetched: 0, inserted: 0, updated: 0, failed: 0, reviews: 0 };
  let checkpointCounter = 0;

  console.log('\n=== Profile fetch + merge ===');
  for (const foretagId of toFetch) {
    const tradeSet = tradeMap.get(foretagId) || new Set(['construction_other']);
    const sfState = sitemapStateMap.get(foretagId) || 'active';
    const url = `${BASE_URL}/foretag/${foretagId}`;

    await delay(RATE_MS);
    const html = await fetchPage(url);
    stats.fetched++;

    if (!html) {
      stats.failed++;
      done.add(foretagId);
      continue;
    }

    let candidate;
    try {
      candidate = parseProfile(html, foretagId, tradeSet, sfState);
    } catch (err) {
      console.error(`  [parse error] foretag/${foretagId}: ${err.message}`);
      stats.failed++;
      done.add(foretagId);
      continue;
    }

    if (stats.fetched % 50 === 0) {
      console.log(`  [${stats.fetched}/${toFetch.length}] inserted=${stats.inserted} updated=${stats.updated} failed=${stats.failed} reviews=${stats.reviews}`);
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] would upsert foretag/${foretagId}: ${candidate.name} (${candidate.city}, ${candidate.postal_code}) state=${sfState}`);
      done.add(foretagId);
      continue;
    }

    const result = await upsertShop(supabase, runId, candidate);

    if (result.action === 'insert') stats.inserted++;
    else if (result.action === 'update') stats.updated++;
    else stats.failed++;

    if (result.shopId && candidate.reviews.length > 0) {
      for (const review of candidate.reviews) {
        await upsertReview(supabase, runId, result.shopId, review);
        stats.reviews++;
      }
    }

    done.add(foretagId);

    checkpointCounter++;
    if (checkpointCounter % CHECKPOINT_EVERY === 0) {
      saveCheckpoint(runId, 'national', done);
      console.log(`  [checkpoint] ${done.size} done, stats:`, stats);
    }
  }

  saveCheckpoint(runId, 'national', done);

  console.log('\n=== National run complete ===');
  console.log(stats);

  if (!DRY_RUN) {
    const { error } = await supabase
      .from('scrape_runs')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        rows_fetched: stats.fetched,
        rows_updated: stats.updated,
        rows_inserted: stats.inserted,
        rows_unmatched: stats.inserted,
        cost_usd: 0,
        notes: `National run: ${stats.inserted} new + ${stats.updated} updated + ${stats.failed} failed. ${stats.reviews} reviews. Sitemap: ${allIds.length} profiles. Category crawl: ${tradeMap.size} categorised. Cities: ${effectiveCities.length}.`,
      })
      .eq('id', runId);

    if (error) console.error('Failed to close run:', error.message);
    else console.log(`Run ${runId} marked complete.`);
  }

  return runId;
}

// ---------------------------------------------------------------------------
// Stockholm pilot (legacy — Phase 4a)
// ---------------------------------------------------------------------------

async function runPilot() {
  console.log(`[SF pilot] run_id=${PILOT_RUN_ID} dry_run=${DRY_RUN}`);

  console.log('\n=== Discovery crawl ===');
  const tradeMap = await runDiscoveryCrawl(DISCOVERY_CITIES_STOCKHOLM);

  if (tradeMap.size === 0) {
    console.error('Discovery crawl returned 0 profiles — aborting.');
    process.exit(1);
  }

  const allIds = Array.from(tradeMap.keys());
  console.log(`\nProfile IDs to fetch: ${allIds.length}`);

  const done = loadCheckpoint(PILOT_RUN_ID, 'pilot');
  const toFetch = allIds.filter(id => !done.has(id));
  console.log(`Already done: ${done.size}, remaining: ${toFetch.length}`);

  const stats = { fetched: 0, skipped_non_stockholm: 0, inserted: 0, updated: 0, failed: 0, reviews: 0 };
  let checkpointCounter = 0;

  console.log('\n=== Profile fetch + merge ===');
  for (const foretagId of toFetch) {
    const tradeSet = tradeMap.get(foretagId);
    const url = `${BASE_URL}/foretag/${foretagId}`;

    await delay(RATE_MS);
    const html = await fetchPage(url);
    stats.fetched++;

    if (!html) {
      stats.failed++;
      done.add(foretagId);
      continue;
    }

    let candidate;
    try {
      candidate = parseProfile(html, foretagId, tradeSet, 'active');
    } catch (err) {
      console.error(`  [parse error] foretag/${foretagId}: ${err.message}`);
      stats.failed++;
      done.add(foretagId);
      continue;
    }

    // Stockholm filter (pilot only)
    if (!isStockholmsLan(candidate.postal_code)) {
      stats.skipped_non_stockholm++;
      done.add(foretagId);
      continue;
    }

    if (stats.fetched % 20 === 0) {
      console.log(`  [${stats.fetched}/${toFetch.length}] inserted=${stats.inserted} updated=${stats.updated} skipped=${stats.skipped_non_stockholm}`);
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] would upsert foretag/${foretagId}: ${candidate.name} (${candidate.city}, ${candidate.postal_code})`);
      done.add(foretagId);
      continue;
    }

    const result = await upsertShop(supabase, PILOT_RUN_ID, candidate);

    if (result.action === 'insert') stats.inserted++;
    else if (result.action === 'update') stats.updated++;
    else stats.failed++;

    if (result.shopId && candidate.reviews.length > 0) {
      for (const review of candidate.reviews) {
        await upsertReview(supabase, PILOT_RUN_ID, result.shopId, review);
        stats.reviews++;
      }
    }

    done.add(foretagId);

    checkpointCounter++;
    if (checkpointCounter % CHECKPOINT_EVERY === 0) {
      saveCheckpoint(PILOT_RUN_ID, 'pilot', done);
      console.log(`  [checkpoint] ${done.size} done, stats:`, stats);
    }
  }

  saveCheckpoint(PILOT_RUN_ID, 'pilot', done);

  console.log('\n=== Pilot complete ===');
  console.log(stats);

  if (!DRY_RUN) {
    const { error } = await supabase
      .from('scrape_runs')
      .update({
        status: 'complete',
        completed_at: new Date().toISOString(),
        rows_fetched: stats.fetched,
        rows_updated: stats.updated,
        rows_inserted: stats.inserted,
        rows_unmatched: stats.inserted,
        cost_usd: 0,
        notes: `Stockholm pilot: ${stats.inserted} new + ${stats.updated} updated + ${stats.skipped_non_stockholm} skipped (non-Stockholm) + ${stats.failed} failed. ${stats.reviews} reviews. Discovery found ${allIds.length} unique profiles across ${TRADE_SLUGS.length} trades × ${DISCOVERY_CITIES_STOCKHOLM.length} cities.`,
      })
      .eq('id', PILOT_RUN_ID);

    if (error) console.error('Failed to close run:', error.message);
    else console.log(`Run ${PILOT_RUN_ID} marked complete.`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  if (NATIONAL) {
    await runNational();
  } else {
    await runPilot();
  }
}

main().catch(err => {
  if (err.message.startsWith('STOP:')) {
    console.error('\n⚠️  Rate-limit stop triggered:', err.message);
    const runId = RUN_ID_ARG || (NATIONAL ? null : PILOT_RUN_ID);
    if (runId) {
      supabase.from('scrape_runs')
        .update({ status: 'paused', notes: err.message })
        .eq('id', runId)
        .then(({ error }) => {
          if (error) console.error('Failed to mark run paused:', error.message);
          process.exit(1);
        });
    } else {
      process.exit(1);
    }
  } else {
    console.error('Fatal error:', err);
    process.exit(1);
  }
});

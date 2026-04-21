/**
 * DoRunner national scraper — Phase SE-Stockholm-4b
 *
 * Strategy:
 *   1. Discovery: sitemap → profiles_0.xml → all foretag slugs (~440)
 *   2. Profile fetch at 2 req/s
 *   3. Parse ld+json LocalBusiness + HTML extractors
 *   4. Classify category via name/service keywords
 *   5. Upsert via shop-merger (additive merge, shared with SF scraper)
 *
 * Run: node scripts/scrape-dorunner.mjs [--run-id <uuid>] [--dry-run]
 *
 * Requires env (loaded from .env.local):
 *   KUNDBOLAGET_SUPABASE_URL
 *   KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY
 */

import { load } from 'cheerio';
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
  postalToState,
} from './lib/normalize.mjs';
import { upsertShop, upsertReview } from './lib/shop-merger.mjs';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

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
const RUN_ID_ARG = (() => {
  const idx = ARGS.indexOf('--run-id');
  return idx >= 0 ? ARGS[idx + 1] : null;
})();

const BASE_URL = 'https://www.dorunner.se';
const UA = 'Kundbolaget-ContractorIndex/1.0 (+https://kundbolaget.se/contact; jacob@wrenchlane.com)';
const RATE_MS = Math.ceil(1000 / 2.0); // 500ms between requests (2 req/s)
const CHECKPOINT_EVERY = 100;

// Shared marketplace blocklist (from SF scraper Phase 4a)
const SHARED_PLATFORM_DOMAINS = new Set([
  'mittanbudmarketplaces.com', 'mittanbud.com', 'anbud.se', 'byggahus.se',
  'blocket.se', 'hittahem.se', 'hantverkare.se', 'topphantverkare.se',
  'reco.se', 'trustpilot.com', 'allabolag.se', 'hitta.se', 'eniro.se',
  'gulasidorna.se', 'foretaget.se', 'proff.se', 'uc.se',
  'dorunner.se', 'servicefinder.se',
]);

// ---------------------------------------------------------------------------
// Category classification
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS = [
  { keywords: ['elektriker', 'el-', 'elinstallation', 'elarbete', 'elverk'],           category: 'electrical' },
  { keywords: ['rör', 'vvs', 'rörläggare', 'rörmokare', 'stambyte', 'avlopp', 'vatten'], category: 'plumbing' },
  { keywords: ['snickare', 'snickeri', 'träarbete', 'fönster', 'dörr'],                 category: 'carpentry' },
  { keywords: ['murare', 'murning', 'betong', 'kakel', 'puts'],                          category: 'masonry' },
  { keywords: ['tak', 'takläggar', 'plåtslagare', 'takarbete', 'tätning'],               category: 'roofing' },
  { keywords: ['målare', 'målning', 'tapetsering', 'fasadmålning'],                      category: 'painting' },
  { keywords: ['totalentreprenad', 'generalentreprenör', 'byggentreprenad'],              category: 'construction' },
  { keywords: ['mark', 'schakt', 'anläggning', 'trädgård', 'utemiljö'],                  category: 'landscaping' },
];

function classifyCategory(name, servicesText) {
  const combined = ((name || '') + ' ' + (servicesText || '')).toLowerCase();
  for (const { keywords, category } of CATEGORY_KEYWORDS) {
    if (keywords.some(kw => combined.includes(kw))) return category;
  }
  return 'construction_other';
}

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
      if (!res.ok) return null;
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
// Sitemap discovery
// ---------------------------------------------------------------------------

async function discoverProfileSlugs() {
  const slugs = [];

  console.log('  Fetching sitemap index...');
  const indexXml = await fetchPage(`${BASE_URL}/sitemap/sitemap.xml`, 3, 3000);
  if (!indexXml) throw new Error('Failed to fetch DR sitemap index');

  // Find profiles_0.xml
  const locRe = /<loc>([^<]+profiles[^<]+\.xml[^<]*)<\/loc>/g;
  const profileSitemaps = [];
  let m;
  while ((m = locRe.exec(indexXml)) !== null) {
    profileSitemaps.push(m[1]);
  }

  if (profileSitemaps.length === 0) {
    console.warn('No profile sitemaps found in index, trying profiles_0.xml directly');
    profileSitemaps.push(`${BASE_URL}/sitemap/profiles_0.xml`); // fallback
  }

  console.log(`  Found ${profileSitemaps.length} profile sitemap file(s)`);

  for (const sitemapUrl of profileSitemaps) {
    await delay(RATE_MS);
    const xml = await fetchPage(sitemapUrl);
    if (!xml) {
      console.warn(`  [skip] Failed to fetch ${sitemapUrl}`);
      continue;
    }

    // DR uses URL-encoded /företag/ path on www.dorunner.se
    const profileRe = /<loc>(https:\/\/www\.dorunner\.se\/f(?:%C3%B6|ö)retag\/([^<]+))<\/loc>/g;
    let pm;
    let count = 0;
    while ((pm = profileRe.exec(xml)) !== null) {
      const profileUrl = pm[1];
      const slug = pm[2].replace(/\/$/, ''); // strip trailing slash
      slugs.push({ slug, profileUrl });
      count++;
    }
    console.log(`  ${sitemapUrl.split('/').pop()}: ${count} profiles`);
  }

  console.log(`Discovery complete: ${slugs.length} total DoRunner profiles`);
  return slugs;
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
      if (data && data['@graph']) {
        const lb = data['@graph'].find(n => n['@type'] === 'LocalBusiness');
        if (lb) return lb;
      }
    } catch { /* skip malformed */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTML extractors
// ---------------------------------------------------------------------------

// Same regex patterns as SF (re-declared locally to keep script self-contained)
const F_SKATT_RE     = /\b(godkänd för f-skatt|innehar f-skatt|f-skatt godkänd|innehavare av f-skatt|med f-skatt|f-skattsedel|f-skattesedel|f\.-skattesedel|innehar f-skattesedel)\b/i;
const INS_CARRIER_RE = /\b(trygg-hansa|if försäkring|if forsakring|folksam|länsförsäkringar|lansforsakringar|moderna försäkringar|moderna forsakringar|gjensidige|protector)\b/i;
const INS_AMT_RE     = /(\d{1,3})\s*(msek|miljoner kronor|miljoner kr|mkr|mnkr)\b/i;
const INS_KEYWORD_RE = /\b(försäkrad|försäkring|ansvarsförsäkring|forsakring|forsakrad)\b/i;
const WARRANTY_RE    = /(\d{1,2})\s*(?:års?|åriga?)\s*garanti\b|\bgarantitid[:\s]+(\d{1,2})\s*år\b/i;
const ORG_NUMBER_RE  = /\b(\d{6}-\d{4})\b/;
// DoRunner's own company registration number appears in every page footer — not a contractor org number
const PLATFORM_ORG_BLOCKLIST = new Set(['556723-4603']);
const POSTAL_CITY_RE = /\b(\d{3}\s?\d{2})\s+([A-ZÅÄÖ][a-zåäö]+(?:\s[A-ZÅÄÖ][a-zåäö]+)*)\b/;

function extractInsurance(text) {
  const carrierMatch = text.match(INS_CARRIER_RE);
  if (!carrierMatch) return { carrier: null, amount: null };
  const carrier = carrierMatch[0].toLowerCase();
  const keywordIdx = text.search(INS_KEYWORD_RE);
  const carrierIdx = text.search(INS_CARRIER_RE);
  if (keywordIdx < 0) return { carrier, amount: null };
  if (Math.abs(keywordIdx - carrierIdx) >= 200) return { carrier, amount: null };
  const amtMatch = text.match(INS_AMT_RE);
  if (!amtMatch) return { carrier, amount: null };
  return { carrier, amount: parseInt(amtMatch[1]) * 1_000_000 };
}

function extractWebsite(html, $, profileUrl) {
  let found = null;
  const skipDomains = [
    'dorunner.se', 'servicefinder.se', 'facebook.com', 'instagram.com',
    'linkedin.com', 'google.', 'youtube.com', 'twitter.com', 'x.com',
  ];
  $('a[href]').each((_, el) => {
    if (found) return;
    const href = $(el).attr('href') || '';
    if (!href.startsWith('http')) return;
    if (skipDomains.some(d => href.includes(d))) return;
    let hostname = '';
    try { hostname = new URL(href).hostname.replace(/^www\./, ''); } catch { return; }
    if (SHARED_PLATFORM_DOMAINS.has(hostname)) return;
    found = href;
  });
  return found;
}

function extractServicesText($) {
  // Look for a services/about section — DR has varying structures
  const candidates = [
    $('[class*="service"]').text(),
    $('[class*="about"]').text(),
    $('[class*="description"]').text(),
    $('main p').first().text(),
  ];
  for (const t of candidates) {
    const trimmed = t.trim();
    if (trimmed.length > 30) return trimmed.slice(0, 800);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Profile parser
// ---------------------------------------------------------------------------

function parseProfile(html, slug, profileUrl) {
  const $ = load(html);
  const ld = parseLdJson(html);
  const fullText = $.text();

  // Core from ld+json
  const name = ld?.name || null;
  const rawPhone = ld?.telephone || null;
  const description = ld?.description?.trim()?.slice(0, 500) || null;
  const logoUrl = (typeof ld?.image === 'string' ? ld.image : ld?.image?.url) || null;

  // Rating from ld+json
  const drRating = ld?.aggregateRating?.ratingValue
    ? parseFloat(ld.aggregateRating.ratingValue)
    : null;
  const drReviewCount = ld?.aggregateRating?.reviewCount
    ? parseInt(ld.aggregateRating.reviewCount)
    : null;

  // Postal + city from HTML (ld+json address may be absent or partial)
  let postalCode = ld?.address?.postalCode?.replace(/\s/g, '') || null;
  let city = ld?.address?.addressLocality || null;
  if (!postalCode || !city) {
    const pcMatch = fullText.match(POSTAL_CITY_RE);
    if (pcMatch) {
      if (!postalCode) postalCode = pcMatch[1].replace(/\s/g, '');
      if (!city) city = pcMatch[2];
    }
  }

  // Org number (full 10-digit) — skip known platform org numbers (appear in page footer/chrome)
  const orgMatch = fullText.match(ORG_NUMBER_RE);
  const rawOrg = orgMatch ? orgMatch[1] : null;
  const orgNumber = rawOrg && !PLATFORM_ORG_BLOCKLIST.has(rawOrg) ? rawOrg : null;
  const partialOrgNumber = orgNumber ? orgNumber.replace('-', '').slice(0, 6) : null;

  // Website
  const website = extractWebsite(html, $, profileUrl);

  // Services text (for category classification + DB storage)
  const servicesText = extractServicesText($);

  // Trust signals (same extractors as SF)
  const fSkatt = F_SKATT_RE.test(fullText) ? true : false;
  const { carrier: insCarrier, amount: insAmount } = extractInsurance(fullText);
  const warrantyYears = (() => {
    const m = fullText.match(WARRANTY_RE);
    return m ? (parseInt(m[1] || m[2]) || null) : null;
  })();

  // Reviews from ld+json
  const rawReviews = Array.isArray(ld?.review) ? ld.review : [];
  const reviews = rawReviews.map(r => ({
    source: 'dorunner',
    source_review_id: makeReviewId('dorunner', slug, r.author?.name, r.datePublished),
    source_profile_id: slug,
    source_url: profileUrl,
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
  const category = classifyCategory(name, servicesText);

  const sources = {};
  if (name)         sources.name              = 'dorunner';
  if (phone)        sources.phone             = 'dorunner';
  if (description)  sources.description       = 'dorunner';
  if (logoUrl)      sources.logo_url          = 'dorunner';
  if (fSkatt)       sources.f_skatt_registered = 'dorunner';
  if (insCarrier)   sources.insurance_carrier  = 'dorunner';
  if (warrantyYears) sources.warranty_years   = 'dorunner';

  return {
    name,
    phone,
    website: website || null,
    address: ld?.address?.streetAddress || null,
    postal_code: postalCode,
    city,
    country_code: 'SE',
    state,
    latitude: null,
    longitude: null,
    org_number: orgNumber,
    partial_org_number: partialOrgNumber,

    // DoRunner-specific
    dorunner_slug:         slug,
    dorunner_url:          profileUrl,
    dorunner_rating:       drRating,
    dorunner_review_count: drReviewCount,
    dorunner_jobs_completed: null,

    // Content
    description,
    services_text: servicesText,
    logo_url: logoUrl,

    // Trust signals
    f_skatt_registered:  fSkatt || false,
    bankid_verified:     null,
    insurance_carrier:   insCarrier,
    insurance_amount_sek: insAmount,
    warranty_years:      warrantyYears,

    // Category
    category,
    all_categories: [category],

    // Match keys
    normalized_domain: domain,
    normalized_phone:  phone,
    normalized_name:   normalName,

    // Provenance
    source:     'dorunner',
    sources,
    scraped_at: new Date().toISOString(),

    reviews,
  };
}

// ---------------------------------------------------------------------------
// Checkpoint helpers
// ---------------------------------------------------------------------------

function checkpointPath(runId) {
  return `/tmp/dr-national-${runId}.json`;
}

function loadCheckpoint(runId) {
  const p = checkpointPath(runId);
  if (!existsSync(p)) return new Set();
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return new Set(data.done || []);
  } catch { return new Set(); }
}

function saveCheckpoint(runId, doneSet) {
  if (DRY_RUN) return;
  writeFileSync(checkpointPath(runId), JSON.stringify({ done: Array.from(doneSet) }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[DR national] dry_run=${DRY_RUN}`);

  // Create run row
  let runId = RUN_ID_ARG;
  if (!runId && !DRY_RUN) {
    const { data, error } = await supabase
      .from('scrape_runs')
      .insert({
        source: 'dorunner',
        scope: 'national',
        status: 'running',
        meta: {
          rate_req_per_s: 2.0,
          expected_profiles: 440,
          user_agent: UA,
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

  // Discovery
  console.log('\n=== Sitemap discovery ===');
  const profiles = await discoverProfileSlugs();

  if (profiles.length === 0) {
    console.error('No profiles discovered — aborting.');
    if (!DRY_RUN) {
      await supabase.from('scrape_runs').update({ status: 'failed', notes: 'No profiles discovered' }).eq('id', runId);
    }
    process.exit(1);
  }

  // Load checkpoint
  const done = loadCheckpoint(runId);
  const toFetch = profiles.filter(({ slug }) => !done.has(slug));
  console.log(`\nProfiles to fetch: ${toFetch.length} (${done.size} already done)`);

  const stats = { fetched: 0, inserted: 0, updated: 0, failed: 0, reviews: 0 };
  let checkpointCounter = 0;

  console.log('\n=== Profile fetch + merge ===');
  for (const { slug, profileUrl } of toFetch) {
    await delay(RATE_MS);
    const html = await fetchPage(profileUrl);
    stats.fetched++;

    if (!html) {
      stats.failed++;
      done.add(slug);
      continue;
    }

    let candidate;
    try {
      candidate = parseProfile(html, slug, profileUrl);
    } catch (err) {
      console.error(`  [parse error] ${slug}: ${err.message}`);
      stats.failed++;
      done.add(slug);
      continue;
    }

    if (stats.fetched % 20 === 0) {
      console.log(`  [${stats.fetched}/${toFetch.length}] inserted=${stats.inserted} updated=${stats.updated} failed=${stats.failed} reviews=${stats.reviews}`);
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] would upsert ${slug}: ${candidate.name} (${candidate.city}, ${candidate.postal_code})`);
      done.add(slug);
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

    done.add(slug);

    checkpointCounter++;
    if (checkpointCounter % CHECKPOINT_EVERY === 0) {
      saveCheckpoint(runId, done);
      console.log(`  [checkpoint] ${done.size} done, stats:`, stats);
    }
  }

  saveCheckpoint(runId, done);

  console.log('\n=== DoRunner national run complete ===');
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
        notes: `National run: ${stats.inserted} new + ${stats.updated} updated + ${stats.failed} failed. ${stats.reviews} reviews. Total profiles discovered: ${profiles.length}.`,
      })
      .eq('id', runId);

    if (error) console.error('Failed to close run:', error.message);
    else console.log(`Run ${runId} marked complete.`);
  }
}

main().catch(err => {
  if (err.message.startsWith('STOP:')) {
    console.error('\n⚠️  Rate-limit stop triggered:', err.message);
    if (RUN_ID_ARG) {
      supabase.from('scrape_runs')
        .update({ status: 'paused', notes: err.message })
        .eq('id', RUN_ID_ARG)
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

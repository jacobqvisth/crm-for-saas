/**
 * Promote discovered_shops → contractor_directory (Phase SE-Stockholm-5).
 *
 * Reads Phase 3/4-enriched rows from staging, applies gating + scoring,
 * writes rich rows into contractor_directory with slug generation, chain
 * tags, composite rating, shop_score, reviews_recent snapshot.
 *
 * Modes:
 *   --dry-run  (default) — no writes, prints report
 *   --yes               — commits writes, opens a scrape_runs row
 *
 * Filters:
 *   --country=SE
 *   --state="Stockholms län"
 *   --limit=10000
 *
 * Requires env (loaded from .env.local):
 *   KUNDBOLAGET_SUPABASE_URL
 *   KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY
 */

import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { normalizeDomain, normalizePhone, normalizeName } from './lib/normalize.mjs';
import { slugify } from './lib/slug.mjs';
import { detectChains } from './lib/se-chains.mjs';

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
for (const cand of [join(ROOT, '.env.local'), join(ROOT, '..', '.env.local'), join(ROOT, '..', '..', '.env.local'), join(ROOT, '..', '..', '..', '.env.local'), join(ROOT, '..', '..', '..', '..', '.env.local')]) {
  if (existsSync(cand)) { dotenv.config({ path: cand }); break; }
}
const SUPABASE_URL = process.env.KUNDBOLAGET_SUPABASE_URL;
const SUPABASE_KEY = process.env.KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing KUNDBOLAGET_SUPABASE_URL or KUNDBOLAGET_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const ARGS = process.argv.slice(2);
function argValue(name, def = null) {
  const pfx = `--${name}=`;
  const hit = ARGS.find((a) => a.startsWith(pfx));
  return hit ? hit.slice(pfx.length) : def;
}
const COUNTRY = argValue('country', 'SE');
const STATE = argValue('state', 'Stockholms län');
const LIMIT = parseInt(argValue('limit', '10000'), 10);
const COMMIT = ARGS.includes('--yes');
const DRY = !COMMIT;
const BATCH = 100;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const EXCLUDE_CATEGORIES = new Set(['car_dealer', 'gas_station', 'car_wash']);
const MARKETPLACE_EMAIL_DOMAINS = new Set([
  'mittanbudmarketplaces.com', 'mittanbud.com', 'anbud.se', 'byggahus.se',
  'blocket.se', 'hittahem.se', 'hantverkare.se', 'topphantverkare.se',
  'reco.se', 'trustpilot.com', 'allabolag.se', 'hitta.se', 'eniro.se',
  'gulasidorna.se', 'foretaget.se', 'proff.se', 'uc.se',
  'servicefinder.se', 'dorunner.se', 'offerta.se', 'hemfixare.se',
]);
const PROMOTE_SOURCE = 'discovered_shops_promote_v1';
const CERT_FIELDS = [
  'rot_advertised', 'gvk_certified', 'saker_vatten_certified',
  'byggforetagen_member', 'installatorsforetagen_member',
  'elsakerhetsverket_registered',
];

// ---------------------------------------------------------------------------
// Gating / exclusions
// ---------------------------------------------------------------------------
function hasAnyContact(shop) {
  return Boolean(shop.website || shop.primary_email || shop.phone);
}
function isJunkName(shop) {
  const n = (shop.name || '').trim();
  return n.length <= 2;
}
function isCategoryExcluded(shop) {
  const cats = shop.all_categories && shop.all_categories.length ? shop.all_categories : (shop.category ? [shop.category] : []);
  if (cats.length === 0) return false;
  return cats.every((c) => EXCLUDE_CATEGORIES.has(String(c).toLowerCase()));
}
function emailDomain(email) {
  if (!email) return null;
  const at = email.indexOf('@');
  return at < 0 ? null : email.slice(at + 1).toLowerCase();
}
function isMarketplaceEmail(shop) {
  const emails = [shop.primary_email, ...(shop.all_emails || [])].filter(Boolean);
  if (emails.length === 0) return false;
  return emails.every((e) => {
    const d = emailDomain(e);
    return d && MARKETPLACE_EMAIL_DOMAINS.has(d);
  });
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function computeCompositeRating(shop) {
  const pairs = [
    [shop.google_rating, shop.google_review_count],
    [shop.reco_rating, shop.reco_review_count],
    [shop.trustpilot_rating, shop.trustpilot_review_count],
    [shop.facebook_rating, shop.facebook_review_count],
    [shop.servicefinder_rating, shop.servicefinder_review_count],
    [shop.dorunner_rating, shop.dorunner_review_count],
  ];
  let weightedSum = 0;
  let totalWeight = 0;
  let sourcesCount = 0;
  let totalReviews = 0;
  for (const [r, c] of pairs) {
    if (r != null && c != null && c > 0) {
      weightedSum += Number(r) * Number(c);
      totalWeight += Number(c);
      sourcesCount += 1;
      totalReviews += Number(c);
    }
  }
  const composite = totalWeight > 0 ? weightedSum / totalWeight : null;
  return {
    composite_rating: composite == null ? null : Math.round(composite * 100) / 100,
    review_sources_count: sourcesCount,
    total_review_count: totalReviews,
  };
}

function countTrueCerts(shop) {
  let n = 0;
  for (const f of CERT_FIELDS) if (shop[f] === true) n += 1;
  return n;
}

function computeShopScore(shop, composite) {
  let score = 0;
  if (shop.website) score += 10;
  if (shop.email_valid === true) score += 10;
  if (shop.servicefinder_id) score += 15;
  if (shop.dorunner_slug) score += 10;
  if (shop.f_skatt_registered === true) score += 10;
  if (shop.bankid_verified === true) score += 10;
  score += countTrueCerts(shop) * 5;
  score += Math.min(15, Math.floor((composite.total_review_count || 0) / 5));
  if (composite.composite_rating != null) {
    score += Math.min(10, Math.floor(composite.composite_rating * 2));
  }
  return Math.min(100, score);
}

function hasAnyCert(shop) {
  return CERT_FIELDS.some((f) => shop[f] === true);
}

function softSignalCount(shop, totalReviewCount) {
  let n = 0;
  if (shop.servicefinder_id) n += 1;
  if (shop.dorunner_slug) n += 1;
  if (shop.f_skatt_registered === true) n += 1;
  if (shop.bankid_verified === true) n += 1;
  if (hasAnyCert(shop)) n += 1;
  if (shop.email_valid === true) n += 1;
  if ((totalReviewCount || 0) > 0) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Reviews snapshot
// ---------------------------------------------------------------------------
async function fetchReviewsRecent(shopId) {
  const { data, error } = await supabase
    .from('discovered_shop_reviews')
    .select('source,rating,review_body,author_name,published_at')
    .eq('shop_id', shopId)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data || []).map((r) => ({
    source: r.source,
    rating: r.rating,
    text: r.review_body ? String(r.review_body).slice(0, 500) : null,
    reviewer_name: r.author_name || null,
    review_date: r.published_at ? String(r.published_at).slice(0, 10) : null,
  }));
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------
function baseSlugFor(shop) {
  const raw = [shop.name, shop.city].filter(Boolean).join(' ');
  let base = slugify(raw);
  if (!base) base = slugify(shop.name || '') || 'shop';
  if (base.length > 100) base = base.slice(0, 80).replace(/-+$/, '');
  return base;
}

async function slugExists(slug, localSet) {
  if (localSet.has(slug)) return true;
  const { data, error } = await supabase
    .from('contractor_directory')
    .select('id')
    .eq('public_slug', slug)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function resolveSlug(shop, localSet) {
  const base = baseSlugFor(shop);
  if (!(await slugExists(base, localSet))) return { slug: base, kind: 'unique' };
  for (let i = 2; i <= 20; i++) {
    const cand = `${base}-${i}`;
    if (!(await slugExists(cand, localSet))) return { slug: cand, kind: 'collision' };
  }
  const uuidSuffix = String(shop.id).replace(/-/g, '').slice(0, 8);
  const fallback = `${base}-${uuidSuffix}`;
  return { slug: fallback, kind: 'uuid_fallback' };
}

// ---------------------------------------------------------------------------
// Match-key cascade
// ---------------------------------------------------------------------------
async function findExisting(shop) {
  // 1. discovered_shop_id back-ref
  {
    const { data } = await supabase
      .from('contractor_directory')
      .select('id,public_slug')
      .eq('discovered_shop_id', shop.id)
      .maybeSingle();
    if (data) return { row: data, method: 'discovered_shop_id', confidence: 1.0 };
  }
  // 2. google_place_id
  if (shop.google_place_id) {
    const { data } = await supabase
      .from('contractor_directory')
      .select('id,public_slug')
      .eq('google_place_id', shop.google_place_id)
      .maybeSingle();
    if (data) return { row: data, method: 'google_place_id', confidence: 0.99 };
  }
  // 3. org_number
  if (shop.org_number) {
    const { data } = await supabase
      .from('contractor_directory')
      .select('id,public_slug')
      .eq('org_number', shop.org_number)
      .maybeSingle();
    if (data) return { row: data, method: 'org_number', confidence: 0.99 };
  }
  // 4. domain (normalized)
  const nd = shop.normalized_domain || normalizeDomain(shop.website);
  if (nd) {
    const { data } = await supabase
      .from('contractor_directory')
      .select('id,public_slug')
      .eq('domain', nd)
      .maybeSingle();
    if (data) return { row: data, method: 'domain', confidence: 0.9 };
  }
  // 5. phone (normalized)
  const np = shop.normalized_phone || normalizePhone(shop.phone);
  if (np) {
    const { data } = await supabase
      .from('contractor_directory')
      .select('id,public_slug')
      .eq('phone', np)
      .maybeSingle();
    if (data) return { row: data, method: 'phone', confidence: 0.8 };
  }
  // 6. name+postal
  const nn = shop.normalized_name || normalizeName(shop.name);
  if (nn && shop.postal_code) {
    const { data } = await supabase
      .from('contractor_directory')
      .select('id,public_slug')
      .ilike('name', nn)
      .eq('postal_code', shop.postal_code)
      .maybeSingle();
    if (data) return { row: data, method: 'name_postal', confidence: 0.75 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sources JSON
// ---------------------------------------------------------------------------
function buildSourcesJson(shop) {
  const out = {};
  if (shop.google_place_id) out.google = { place_id: shop.google_place_id, rating: shop.google_rating, review_count: shop.google_review_count };
  if (shop.reco_url) out.reco = { url: shop.reco_url, rating: shop.reco_rating, review_count: shop.reco_review_count, verified: shop.reco_verified };
  if (shop.trustpilot_url) out.trustpilot = { url: shop.trustpilot_url, rating: shop.trustpilot_rating, review_count: shop.trustpilot_review_count };
  if (shop.facebook_rating != null) out.facebook = { rating: shop.facebook_rating, review_count: shop.facebook_review_count };
  if (shop.servicefinder_id) out.servicefinder = { id: shop.servicefinder_id, url: shop.servicefinder_url, rating: shop.servicefinder_rating, review_count: shop.servicefinder_review_count, jobs_completed: shop.servicefinder_jobs_completed };
  if (shop.dorunner_slug) out.dorunner = { slug: shop.dorunner_slug, url: shop.dorunner_url, rating: shop.dorunner_rating, review_count: shop.dorunner_review_count, jobs_completed: shop.dorunner_jobs_completed };
  if (shop.offerta_url) out.offerta = { url: shop.offerta_url, rating: shop.offerta_rating, review_count: shop.offerta_review_count };
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------------------
// Build row payload
// ---------------------------------------------------------------------------
function buildPayload(shop, { composite, shopScore, tags, publicStatus, reviewsRecent, slug, sourcesJson }) {
  const nd = shop.normalized_domain || normalizeDomain(shop.website);
  const np = shop.normalized_phone || normalizePhone(shop.phone);
  return {
    name: shop.name,
    domain: nd,
    website: shop.website,
    phone: np || shop.phone,
    email: shop.primary_email,
    address: shop.address,
    city: shop.city,
    postal_code: shop.postal_code,
    state: shop.state,
    country_code: shop.country_code,
    latitude: shop.latitude,
    longitude: shop.longitude,
    category: shop.category,
    all_categories: shop.all_categories,
    google_place_id: shop.google_place_id,
    rating: composite.composite_rating,
    review_count: composite.total_review_count,
    all_emails: shop.all_emails || [],
    all_phones: shop.all_phones || [],
    instagram_url: shop.instagram_url,
    facebook_url: shop.facebook_url,
    email_valid: shop.email_valid,
    source: shop.source || 'discovered_shops',
    org_number: shop.org_number,
    partial_org_number: shop.partial_org_number,
    description: shop.description,
    about_text: shop.about_text,
    services_text: shop.services_text,
    logo_url: shop.logo_url,
    photos: shop.photos,
    founded_year: shop.founded_year,
    employee_count_range: shop.employee_count_range,
    rot_advertised: shop.rot_advertised,
    gvk_certified: shop.gvk_certified,
    saker_vatten_certified: shop.saker_vatten_certified,
    byggforetagen_member: shop.byggforetagen_member,
    installatorsforetagen_member: shop.installatorsforetagen_member,
    elsakerhetsverket_registered: shop.elsakerhetsverket_registered,
    f_skatt_registered: shop.f_skatt_registered,
    bankid_verified: shop.bankid_verified,
    warranty_years: shop.warranty_years,
    insurance_carrier: shop.insurance_carrier,
    composite_rating: composite.composite_rating,
    total_review_count: composite.total_review_count,
    review_sources_count: composite.review_sources_count,
    reviews_recent: reviewsRecent,
    servicefinder_id: shop.servicefinder_id,
    servicefinder_jobs_completed: shop.servicefinder_jobs_completed,
    dorunner_slug: shop.dorunner_slug,
    dorunner_jobs_completed: shop.dorunner_jobs_completed,
    tags,
    sources: sourcesJson,
    discovered_shop_id: shop.id,
    shop_score: shopScore,
    public_slug: slug,
    public_status: publicStatus,
    promoted_at: new Date().toISOString(),
    promote_source: PROMOTE_SOURCE,
    imported_at: shop.imported_at || new Date().toISOString(),
  };
}

function coalesceUpdate(existing, payload) {
  // Never overwrite a non-null existing value with null.
  // Refetch existing fully for accurate comparison.
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v == null) continue;
    if (existing[k] == null) { out[k] = v; continue; }
    // Array merge: take union (dedup strings)
    if (Array.isArray(existing[k]) && Array.isArray(v)) {
      const merged = Array.from(new Set([...existing[k], ...v])).filter((x) => x != null);
      if (JSON.stringify(merged) !== JSON.stringify(existing[k])) out[k] = merged;
      continue;
    }
    // Growing numeric counters
    if (k === 'total_review_count' || k === 'review_count' || k === 'shop_score' || k === 'review_sources_count') {
      if (Number(v) > Number(existing[k])) out[k] = v;
      continue;
    }
    // Everything else: keep existing, skip
  }
  // Always bump promote stamps
  out.promoted_at = payload.promoted_at;
  out.promote_source = payload.promote_source;
  if (payload.reviews_recent) out.reviews_recent = payload.reviews_recent;
  if (payload.composite_rating != null) out.composite_rating = payload.composite_rating;
  if (payload.tags) out.tags = Array.from(new Set([...(existing.tags || []), ...payload.tags]));
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function openRun() {
  const { data, error } = await supabase
    .from('scrape_runs')
    .insert({
      source: 'contractor_directory_promote',
      scope: `${COUNTRY}:${STATE}`,
      status: 'running',
      started_at: new Date().toISOString(),
      notes: `promote-discovered-shops country=${COUNTRY} state="${STATE}" limit=${LIMIT}`,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function closeRun(runId, counters, status = 'completed') {
  await supabase
    .from('scrape_runs')
    .update({
      status,
      completed_at: new Date().toISOString(),
      rows_fetched: counters.candidates,
      rows_inserted: counters.inserted,
      rows_updated: counters.updated,
      rows_unmatched: counters.skipped,
      meta: counters,
    })
    .eq('id', runId);
}

async function logEvent(runId, shopId, eventType, matchMethod, matchConfidence, fieldsChanged) {
  await supabase.from('data_source_events').insert({
    shop_id: shopId,
    run_id: runId,
    source: 'contractor_directory_promote',
    event_type: eventType,
    match_method: matchMethod,
    match_confidence: matchConfidence,
    fields_changed: fieldsChanged,
  });
}

async function main() {
  const mode = DRY ? 'DRY-RUN' : 'COMMIT';
  console.log(`[promote] ${mode}  country=${COUNTRY}  state="${STATE}"  limit=${LIMIT}`);

  // Smoke test chain detection
  const chainSmoke = [
    ['Bravida AB Stockholm', detectChains('Bravida AB Stockholm')],
    ['Elajo El & Energiteknik AB', detectChains('Elajo El & Energiteknik AB')],
    ['Samuel Rör & VVS AB', detectChains('Samuel Rör & VVS AB')],
  ];
  for (const [n, t] of chainSmoke) console.log(`  chain-detect "${n}" → [${t.join(', ')}]`);

  // Fetch candidates (paginate — Supabase select caps at 1000/request)
  const allShops = [];
  const PAGE = 1000;
  for (let offset = 0; offset < LIMIT; offset += PAGE) {
    const take = Math.min(PAGE, LIMIT - offset);
    let q = supabase
      .from('discovered_shops')
      .select('*')
      .eq('country_code', COUNTRY)
      .neq('status', 'imported')
      .not('name', 'is', null);
    if (STATE) {
      q = q.or(`state.eq.${STATE},state.ilike.stockholm%`);
    }
    q = q.order('scraped_at', { ascending: false }).range(offset, offset + take - 1);
    const { data: page, error: fetchErr } = await q;
    if (fetchErr) throw fetchErr;
    if (!page || page.length === 0) break;
    allShops.push(...page);
    if (page.length < take) break;
  }
  const shops = (allShops || []).filter((s) => s.name && s.name.trim().length > 2 && hasAnyContact(s));

  // Tally gating
  const droppedNoContact = (allShops || []).filter((s) => !hasAnyContact(s)).length;
  const droppedJunk = (allShops || []).filter((s) => isJunkName(s)).length;
  const droppedImported = 0; // filter already excluded
  const excludedCategory = shops.filter(isCategoryExcluded).length;
  const excludedMarketplace = shops.filter(isMarketplaceEmail).length;

  const promotable = shops.filter((s) => !isCategoryExcluded(s) && !isMarketplaceEmail(s));

  // Stats trackers
  const matchMethodCounts = { discovered_shop_id: 0, google_place_id: 0, org_number: 0, domain: 0, phone: 0, name_postal: 0, none_insert: 0 };
  let willPublish = 0;
  let willPend = 0;
  const slugStats = { unique: 0, collision: 0, uuid_fallback: 0 };
  const tagHist = {};
  const writes = { inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const usedSlugs = new Set();

  const runId = (COMMIT && promotable.length > 0) ? await openRun() : null;

  const batchErrors = [];
  for (let i = 0; i < promotable.length; i++) {
    const shop = promotable[i];
    try {
      const composite = computeCompositeRating(shop);
      const softCount = softSignalCount(shop, composite.total_review_count);
      const publicStatus = softCount >= 1 ? 'published' : 'pending';
      const tags = [softCount >= 1 ? 'verified' : 'unverified', ...detectChains(shop.name || shop.normalized_name)];
      for (const t of tags) tagHist[t] = (tagHist[t] || 0) + 1;
      if (publicStatus === 'published') willPublish += 1; else willPend += 1;

      const shopScore = computeShopScore(shop, composite);
      const match = await findExisting(shop);
      const method = match ? match.method : 'none_insert';
      matchMethodCounts[method] = (matchMethodCounts[method] || 0) + 1;

      let slug;
      if (match && match.row.public_slug) {
        slug = match.row.public_slug;
      } else {
        const sr = await resolveSlug(shop, usedSlugs);
        slug = sr.slug;
        slugStats[sr.kind] += 1;
        usedSlugs.add(slug);
      }

      const reviewsRecent = await fetchReviewsRecent(shop.id);
      const sourcesJson = buildSourcesJson(shop);

      const payload = buildPayload(shop, {
        composite, shopScore, tags, publicStatus, reviewsRecent, slug, sourcesJson,
      });

      if (DRY) {
        if (match) writes.updated += 1; else writes.inserted += 1;
        continue;
      }

      if (match) {
        // Fetch full existing row
        const { data: existingRow, error: exErr } = await supabase
          .from('contractor_directory')
          .select('*')
          .eq('id', match.row.id)
          .single();
        if (exErr) throw exErr;
        const updates = coalesceUpdate(existingRow, payload);
        const changedFields = Object.keys(updates);
        if (changedFields.length > 0) {
          const { error: upErr } = await supabase
            .from('contractor_directory')
            .update(updates)
            .eq('id', match.row.id);
          if (upErr) throw upErr;
          writes.updated += 1;
          await logEvent(runId, shop.id, 'update', match.method, match.confidence, changedFields);
        } else {
          writes.skipped += 1;
          await logEvent(runId, shop.id, 'skip', match.method, match.confidence, []);
        }
        // back-stamp
        await supabase
          .from('discovered_shops')
          .update({ status: 'imported' })
          .eq('id', shop.id);
      } else {
        const { data: newRow, error: insErr } = await supabase
          .from('contractor_directory')
          .insert(payload)
          .select('id')
          .single();
        if (insErr) throw insErr;
        writes.inserted += 1;
        await logEvent(runId, shop.id, 'insert', 'none_insert', null, Object.keys(payload));
        await supabase
          .from('discovered_shops')
          .update({ status: 'imported' })
          .eq('id', shop.id);
      }
    } catch (err) {
      writes.errors += 1;
      batchErrors.push({ shop_id: shop.id, message: err?.message || String(err) });
      console.error(`[err] shop=${shop.id} name="${shop.name}": ${err?.message || err}`);
      if (writes.errors > 10 && writes.errors / Math.max(1, i + 1) > 0.02) {
        console.error(`[abort] error ratio > 2%  (${writes.errors}/${i + 1})`);
        if (runId) await closeRun(runId, { candidates: allShops?.length || 0, promotable: promotable.length, inserted: writes.inserted, updated: writes.updated, skipped: writes.skipped, errors: writes.errors }, 'failed');
        process.exit(1);
      }
    }
    if (!DRY && (i + 1) % BATCH === 0) {
      console.log(`  batch  ${i + 1}/${promotable.length}  inserted=${writes.inserted} updated=${writes.updated} skipped=${writes.skipped} errors=${writes.errors}`);
    }
  }

  // ---- Report ----
  console.log('');
  console.log(`Candidates evaluated: ${(allShops || []).length}`);
  console.log(`  Dropped by gating: ${droppedNoContact + droppedJunk + droppedImported}  (no contact: ${droppedNoContact}, already imported: ${droppedImported}, junk names: ${droppedJunk})`);
  console.log(`  Excluded by category overlap: ${excludedCategory}`);
  console.log(`  Excluded by marketplace-domain email: ${excludedMarketplace}`);
  console.log(`  Promotable: ${promotable.length}`);
  console.log('');
  console.log('Match-key cascade (first-hit):');
  for (const k of ['discovered_shop_id', 'google_place_id', 'org_number', 'domain', 'phone', 'name_postal', 'none_insert']) {
    console.log(`  ${k.padEnd(20)} ${matchMethodCounts[k] || 0}`);
  }
  console.log('');
  console.log(`Will publish (≥1 soft signal): ${willPublish}`);
  console.log(`Will pend  (0 soft signals):   ${willPend}`);
  console.log('');
  console.log('Slug generation:');
  console.log(`  Unique slugs:               ${slugStats.unique}`);
  console.log(`  Collisions resolved (-2..): ${slugStats.collision}`);
  console.log(`  UUID-suffix fallback:       ${slugStats.uuid_fallback}`);
  console.log('');
  console.log('Tag histogram (top 15):');
  const sortedTags = Object.entries(tagHist).sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [t, n] of sortedTags) console.log(`  ${t.padEnd(22)} ${n}`);
  console.log('');
  console.log(`Writes: inserted=${writes.inserted}  updated=${writes.updated}  skipped=${writes.skipped}  errors=${writes.errors}`);
  if (DRY) console.log('(dry-run: no writes committed)');

  if (runId) {
    await closeRun(runId, {
      candidates: allShops?.length || 0,
      promotable: promotable.length,
      inserted: writes.inserted,
      updated: writes.updated,
      skipped: writes.skipped,
      errors: writes.errors,
      match_methods: matchMethodCounts,
      tags: tagHist,
      slug_stats: slugStats,
    });
    console.log(`\nrun_id=${runId}  status=completed`);
  }

  if (batchErrors.length > 0) {
    console.log(`\nFirst 5 errors:`);
    for (const e of batchErrors.slice(0, 5)) console.log(`  ${e.shop_id}: ${e.message}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

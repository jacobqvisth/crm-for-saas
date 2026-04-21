/**
 * Upsert helpers for discovered_shops + discovered_shop_reviews.
 *
 * Match priority (first non-null hit wins):
 *   1. google_place_id
 *   2. org_number
 *   3. normalized_domain
 *   4. normalized_phone
 *   5. normalized_name + postal_code
 *   6. partial_org_number + normalized_name
 *
 * Never overwrites non-null existing values (additive merge only),
 * except numeric ratings/counts which always use the higher value.
 */

// ---------------------------------------------------------------------------
// Match helpers
// ---------------------------------------------------------------------------

async function findExisting(supabase, candidate) {
  // 1. google_place_id
  if (candidate.google_place_id) {
    const { data } = await supabase
      .from('discovered_shops')
      .select('id')
      .eq('google_place_id', candidate.google_place_id)
      .maybeSingle();
    if (data) return { row: data, method: 'google_place_id' };
  }

  // 2. org_number
  if (candidate.org_number) {
    const { data } = await supabase
      .from('discovered_shops')
      .select('id')
      .eq('org_number', candidate.org_number)
      .maybeSingle();
    if (data) return { row: data, method: 'org_number' };
  }

  // 3. normalized_domain
  if (candidate.normalized_domain) {
    const { data } = await supabase
      .from('discovered_shops')
      .select('id')
      .eq('normalized_domain', candidate.normalized_domain)
      .maybeSingle();
    if (data) return { row: data, method: 'normalized_domain' };
  }

  // 4. normalized_phone
  if (candidate.normalized_phone) {
    const { data } = await supabase
      .from('discovered_shops')
      .select('id')
      .eq('normalized_phone', candidate.normalized_phone)
      .maybeSingle();
    if (data) return { row: data, method: 'normalized_phone' };
  }

  // 5. normalized_name + postal_code
  if (candidate.normalized_name && candidate.postal_code) {
    const { data } = await supabase
      .from('discovered_shops')
      .select('id')
      .eq('normalized_name', candidate.normalized_name)
      .eq('postal_code', candidate.postal_code)
      .maybeSingle();
    if (data) return { row: data, method: 'name_postal' };
  }

  // 6. partial_org_number + normalized_name
  if (candidate.partial_org_number && candidate.normalized_name) {
    const { data } = await supabase
      .from('discovered_shops')
      .select('id')
      .eq('partial_org_number', candidate.partial_org_number)
      .eq('normalized_name', candidate.normalized_name)
      .maybeSingle();
    if (data) return { row: data, method: 'partial_org_name' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Merge logic: additive — never overwrite non-null, except growing counters
// ---------------------------------------------------------------------------

function buildUpdatePayload(existing, candidate) {
  const fieldsChanged = [];
  const payload = {};

  // Columns that are always additive (keep existing if set)
  const additiveFields = [
    'name', 'phone', 'website', 'address', 'postal_code', 'city', 'state',
    'country_code', 'latitude', 'longitude', 'org_number', 'partial_org_number',
    'normalized_domain', 'normalized_phone', 'normalized_name',
    'description', 'about_text', 'services_text', 'logo_url', 'photos',
    'instagram_url', 'facebook_url', 'category', 'all_categories',
    'servicefinder_id', 'servicefinder_url', 'servicefinder_state',
    'servicefinder_area_served', 'dorunner_slug', 'dorunner_url',
    'insurance_carrier', 'insurance_amount_sek', 'warranty_years',
    // 3-state booleans: only write if existing is NULL
    'f_skatt_registered', 'bankid_verified',
  ];

  for (const col of additiveFields) {
    const newVal = candidate[col];
    const existingVal = existing[col];
    if (newVal !== undefined && newVal !== null && (existingVal === null || existingVal === undefined)) {
      payload[col] = newVal;
      fieldsChanged.push(col);
    }
  }

  // Counters: always overwrite if new value is higher
  const counterPairs = [
    ['servicefinder_review_count', 'servicefinder_rating'],
    ['dorunner_review_count', 'dorunner_rating'],
  ];
  for (const [countCol, ratingCol] of counterPairs) {
    const newCount = candidate[countCol];
    const existingCount = existing[countCol];
    if (typeof newCount === 'number' && newCount > (existingCount ?? 0)) {
      payload[countCol] = newCount;
      fieldsChanged.push(countCol);
      // Update rating whenever count changes
      if (typeof candidate[ratingCol] === 'number') {
        payload[ratingCol] = candidate[ratingCol];
        fieldsChanged.push(ratingCol);
      }
    }
  }

  // Jobs completed: always take higher
  for (const col of ['servicefinder_jobs_completed', 'dorunner_jobs_completed']) {
    const newVal = candidate[col];
    const existingVal = existing[col];
    if (typeof newVal === 'number' && newVal > (existingVal ?? 0)) {
      payload[col] = newVal;
      fieldsChanged.push(col);
    }
  }

  // sources JSONB: merge — existing source entries win (first-write-wins provenance)
  if (candidate.sources && typeof candidate.sources === 'object') {
    const merged = { ...(candidate.sources), ...(existing.sources || {}) };
    if (JSON.stringify(merged) !== JSON.stringify(existing.sources || {})) {
      payload.sources = merged;
      fieldsChanged.push('sources');
    }
  }

  // scraped_at: always update to latest
  if (candidate.scraped_at) {
    payload.scraped_at = candidate.scraped_at;
  }

  return { payload, fieldsChanged };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upsert a shop candidate.
 * @returns {{ action: 'insert'|'update'|'match_ambiguous'|'match_failed', shopId: string|null, matchMethod: string|null, fieldsChanged: string[] }}
 */
export async function upsertShop(supabase, runId, candidate) {
  const match = await findExisting(supabase, candidate);

  if (!match) {
    // INSERT path
    const insertPayload = { ...candidate };
    delete insertPayload.reviews; // not a DB column
    insertPayload.source = insertPayload.source || 'servicefinder';

    const { data: inserted, error } = await supabase
      .from('discovered_shops')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      await writeEvent(supabase, runId, null, 'match_failed', null, []);
      return { action: 'match_failed', shopId: null, matchMethod: null, fieldsChanged: [] };
    }

    await writeEvent(supabase, runId, inserted.id, 'insert', null, Object.keys(insertPayload));
    return { action: 'insert', shopId: inserted.id, matchMethod: null, fieldsChanged: Object.keys(insertPayload) };
  }

  // UPDATE path — fetch full existing row to compute diff
  const { data: existing, error: fetchErr } = await supabase
    .from('discovered_shops')
    .select('*')
    .eq('id', match.row.id)
    .single();

  if (fetchErr) {
    await writeEvent(supabase, runId, match.row.id, 'match_failed', match.method, []);
    return { action: 'match_failed', shopId: match.row.id, matchMethod: match.method, fieldsChanged: [] };
  }

  const { payload, fieldsChanged } = buildUpdatePayload(existing, candidate);

  if (fieldsChanged.length > 0) {
    const { error: updateErr } = await supabase
      .from('discovered_shops')
      .update(payload)
      .eq('id', existing.id);

    if (updateErr) {
      await writeEvent(supabase, runId, existing.id, 'match_failed', match.method, []);
      return { action: 'match_failed', shopId: existing.id, matchMethod: match.method, fieldsChanged: [] };
    }
  }

  await writeEvent(supabase, runId, existing.id, 'update', match.method, fieldsChanged);
  return { action: 'update', shopId: existing.id, matchMethod: match.method, fieldsChanged };
}

/**
 * Upsert a single review row. Idempotent via (source, source_review_id).
 * Already-seen reviews no-op except for last_seen_at bump.
 */
export async function upsertReview(supabase, runId, shopId, review) {
  const payload = {
    shop_id: shopId,
    run_id: runId,
    source: review.source || 'servicefinder',
    source_review_id: review.source_review_id,
    source_profile_id: review.source_profile_id || null,
    source_url: review.source_url || null,
    author_name: review.author_name || null,
    rating: review.rating,
    best_rating: review.best_rating ?? 5.0,
    review_title: review.review_title || null,
    review_body: review.review_body || null,
    published_at: review.published_at || null,
    language: review.language || 'sv',
    raw: review.raw || null,
    last_seen_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('discovered_shop_reviews')
    .upsert(payload, {
      onConflict: 'source,source_review_id',
      ignoreDuplicates: false, // we want the last_seen_at update
    });

  if (error) {
    console.error(`[upsertReview] error for ${review.source_review_id}:`, error.message);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function writeEvent(supabase, runId, shopId, eventType, matchMethod, fieldsChanged) {
  const { error } = await supabase.from('data_source_events').insert({
    run_id: runId,
    shop_id: shopId,
    source: 'servicefinder',
    event_type: eventType,
    match_method: matchMethod,
    fields_changed: fieldsChanged,
  });
  if (error) {
    console.error(`[writeEvent] failed to write ${eventType} event:`, error.message);
  }
}

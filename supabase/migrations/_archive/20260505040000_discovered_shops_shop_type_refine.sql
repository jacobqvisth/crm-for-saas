-- Refine shop_type bucketing. The first cut put 4,771 SE rows in 'other' but
-- inspection of the categories revealed:
--   - Adjacent ICP (Auto machine shop, Auto tune up, Auto electrical, Engine
--     rebuilding, Auto restoration) was being lost as 'other'.
--   - Inspection stations missed by the name-regex filter (97 Car inspection
--     stations + variants) need their own bucket so they're easy to exclude.
--   - Dealers / parts stores / motorcycle / RV / boat / car wash etc. are
--     legitimate non-ICP and should be tagged distinctly so we don't waste
--     enrollment on them.
--
-- New / refined buckets:
--   'auto_repair'  — primary ICP. Now broader: includes machine shop, tune up,
--                    electrical, engine rebuild, restoration, transmission.
--   'auto_glass'   — windshield / glass specialists (soft ICP — they often do
--                    no mechanical, but cross-sell potential).
--   'inspection'   — vehicle inspection station (out of ICP, like Bilprovningen).
--   'dealer'       — car / truck / RV / motorcycle dealer (out of ICP).
--   'parts'        — auto parts store (out of ICP).
--   'motorcycle'   — motorcycle / scooter repair (different segment).
--   'other'        — what's left: car wash, gas station, glazier, salvage, etc.
--
-- Re-runs only affect rows currently in 'other' or NULL — already-classified
-- rows (auto_repair / tire_only / tire_combo / truck_repair / auto_body) keep
-- their type unchanged.

BEGIN;

UPDATE discovered_shops
SET shop_type = CASE
  -- Inspection stations that escaped the name-regex (Bilprovningen etc.)
  WHEN category IN ('Car inspection station','Vehicle inspection') OR category ILIKE '%inspection%'
    THEN 'inspection'

  -- Auto glass / windshield
  WHEN category IN ('Auto glass shop','Auto glass repair service','Glass repair service')
    OR category ILIKE '%auto glass%'
    OR category ILIKE '%windshield%'
    THEN 'auto_glass'

  -- Adjacent ICP — these all do mechanical or substantial repair work
  WHEN category IN ('Auto machine shop','Auto tune up service','Auto electrical service',
                    'Engine rebuilding service','Auto restoration service','Transmission shop',
                    'Brake shop','Auto spring shop','Wheel alignment service','Oil change service')
    OR category ILIKE '%transmission%'
    OR category ILIKE '%engine reb%'
    OR category ILIKE '%machine shop%'
    OR category ILIKE '%electrical%service%'
    THEN 'auto_repair'

  -- Dealers
  WHEN category IN ('Car dealer','Used car dealer','Motor vehicle dealer','Truck dealer',
                    'Motorcycle dealer','RV dealer')
    OR category ILIKE '%dealer%'
    THEN 'dealer'

  -- Parts stores
  WHEN category IN ('Auto parts store','Truck accessories store','Used auto parts store')
    OR category ILIKE '%parts store%'
    THEN 'parts'

  -- Motorcycle / scooter
  WHEN category IN ('Motorcycle repair shop','Scooter repair shop','Motorcycle parts store')
    OR category ILIKE '%motorcycle%'
    OR category ILIKE '%moped%'
    THEN 'motorcycle'

  -- Otherwise leave as-is
  ELSE shop_type
END
WHERE country_code = 'SE' AND (shop_type = 'other' OR shop_type IS NULL);

-- Also: catch the 859 NULL-category rows. If they have any auto-repair signal in
-- all_categories, classify them. Otherwise leave them as 'other' for manual review.
UPDATE discovered_shops
SET shop_type = CASE
  WHEN all_categories && ARRAY['Auto repair shop','Mechanic','Auto body shop']::text[]
    THEN 'auto_repair'
  WHEN all_categories && ARRAY['Tire shop','Wheel store']::text[]
    THEN 'tire_only'
  WHEN all_categories && ARRAY['Truck repair shop']::text[]
    THEN 'truck_repair'
  ELSE 'other'
END
WHERE country_code = 'SE' AND category IS NULL AND (shop_type = 'other' OR shop_type IS NULL);

COMMIT;

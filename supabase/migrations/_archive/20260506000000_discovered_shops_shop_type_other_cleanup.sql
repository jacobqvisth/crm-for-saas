-- Cleanup of the 2,444 SE rows still in shop_type='other' after the v2 refine.
--
-- Findings from inspection:
--   - 803 Lemlist legacy rows are chain workshops (Mekonomen, Autoexperten,
--     BD Group etc) — they ARE auto_repair but had no Google `category` field
--     since they came from a CSV import, not Google Maps.
--   - 859 Apify rows have NULL category but came from auto-repair search terms
--     (raw_data.term in 'bilverkstad'|'bilreparation'|'mekaniker'|'bilservice').
--     Their names often contain 'verkstad'/'bilservice'/'bilrep'/'fordon' — strong workshop signal.
--   - The remaining ~780 rows split into clear non-auto buckets (bicycle/boat/
--     RV/trailer/tractor repair), auto specialty (detailing/upholstery/glazier),
--     salvage/wrecker, and true 'other' (gas station, car wash, dealer broker, etc).
--
-- New buckets:
--   'auto_specialty'      — detailing, upholstery, audio installer, window tint, ceramic coat
--   'non_auto_vehicle'    — bicycle, boat, RV, trailer, tractor, motorcycle (already separate), aircraft
--   'salvage'             — auto wrecker, salvage yard, used parts (some refurbish — soft ICP)
--   'towing'              — towing service (often has workshop attached, soft ICP)
--   'other'               — what's left: gas stations, car washes, brokers, generic stores, manufacturers

BEGIN;

-- 1. Lemlist rows are all known workshops — promote to auto_repair
UPDATE discovered_shops
SET shop_type = 'auto_repair'
WHERE country_code = 'SE'
  AND source = 'lemlist'
  AND shop_type = 'other';

-- 2. NULL-category Apify rows: classify by raw_data.term
--    Auto-repair search terms → auto_repair, däckverkstad → tire_only
UPDATE discovered_shops
SET shop_type = CASE
  WHEN raw_data->>'term' = 'däckverkstad' THEN 'tire_only'
  ELSE 'auto_repair'
END
WHERE country_code = 'SE'
  AND source = 'google_maps'
  AND category IS NULL
  AND shop_type = 'other'
  AND raw_data->>'term' IN ('bilverkstad','bilreparation','mekaniker','bilservice','däckverkstad');

-- 3. Auto specialty (detailing, upholstery, glass-tint, audio, accessories)
UPDATE discovered_shops
SET shop_type = 'auto_specialty'
WHERE country_code = 'SE' AND shop_type = 'other'
  AND (category IN (
        'Car detailing service','Auto upholsterer','Window tinting service',
        'Car stereo store','Car accessories store','Auto broker'
      )
      OR category ILIKE '%detail%'
      OR category ILIKE '%upholster%'
      OR category ILIKE '%tint%'
      OR category ILIKE '%accessor%'
  );

-- 4. Non-auto vehicle repair (bicycle / boat / RV / trailer / tractor / aircraft)
UPDATE discovered_shops
SET shop_type = 'non_auto_vehicle'
WHERE country_code = 'SE' AND shop_type = 'other'
  AND (category IN (
        'Bicycle repair shop','Bicycle Shop','Boat repair shop','RV repair shop',
        'Trailer repair shop','Tractor repair shop','Aircraft maintenance facility'
      )
      OR category ILIKE '%bicycle%'
      OR category ILIKE '%boat%'
      OR category ILIKE '%rv repair%'
      OR category ILIKE '%trailer%'
      OR category ILIKE '%tractor%'
      OR category ILIKE '%aircraft%'
  );

-- 5. Salvage / wrecker (sometimes refurbish — soft ICP)
UPDATE discovered_shops
SET shop_type = 'salvage'
WHERE country_code = 'SE' AND shop_type = 'other'
  AND (category IN ('Salvage yard','Auto wrecker','Used auto parts store')
       OR category ILIKE '%salvage%'
       OR category ILIKE '%wrecker%'
       OR category ILIKE '%scrap%');

-- 6. Towing service
UPDATE discovered_shops
SET shop_type = 'towing'
WHERE country_code = 'SE' AND shop_type = 'other'
  AND (category = 'Towing service' OR category ILIKE '%towing%' OR category ILIKE '%bärgning%');

COMMIT;

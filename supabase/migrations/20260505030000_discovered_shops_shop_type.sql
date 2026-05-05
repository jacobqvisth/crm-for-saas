-- Add `shop_type` to discovered_shops + back-populate from all_categories[].
-- Splits the noisy mix of auto-repair / tire-only / combo / other so sequence
-- enrollment can filter cleanly by shop_type instead of doing fuzzy ILIKE on
-- category strings.
--
-- Buckets:
--   'auto_repair' — primary ICP. Auto repair shop / mechanic / body shop / etc.
--   'tire_combo'  — tire shop that ALSO offers mechanical work (Auto repair shop in all_categories alongside tire). Soft ICP.
--   'tire_only'   — pure tire shop (just Tire shop / Wheel store / Tire repair). Out of ICP.
--   'truck_repair'— truck/heavy-vehicle workshop. Different segment.
--   'auto_body'   — paint/lackering primary. Soft ICP.
--   'other'       — everything else (dealers, parts stores, miscellaneous).

BEGIN;

ALTER TABLE discovered_shops ADD COLUMN IF NOT EXISTS shop_type TEXT;

CREATE INDEX IF NOT EXISTS discovered_shops_shop_type_idx
  ON discovered_shops (shop_type) WHERE shop_type IS NOT NULL;

-- Back-populate. Order matters: most specific buckets first.
UPDATE discovered_shops
SET shop_type = CASE
  -- Truck/heavy-vehicle (different ICP segment but worth flagging)
  WHEN all_categories && ARRAY['Truck repair shop','Heavy machinery repair service']::text[]
    THEN 'truck_repair'

  -- Tire-shop primary that ALSO has mechanical → soft ICP
  WHEN (category ILIKE '%tire%' OR category ILIKE '%däck%')
    AND all_categories && ARRAY['Auto repair shop','Mechanic','Auto body shop','Oil change service','Brake shop']::text[]
    THEN 'tire_combo'

  -- Pure tire shops (no mechanical signal)
  WHEN category IN ('Tire shop','Tire repair shop','Tire service','Wheel store','Used tire shop','Hub cap supplier')
    OR (category ILIKE '%tire%' OR category ILIKE '%däck%')
    THEN 'tire_only'

  -- Auto body / paint shops as primary
  WHEN category ILIKE '%body%' OR category ILIKE '%paint%' OR category ILIKE '%lacker%'
    THEN 'auto_body'

  -- Core auto repair ICP — explicit category match
  WHEN category IN ('Auto repair shop','Auto repair','Mechanic','Car repair and maintenance service','Auto Repair','Car service','Car repair','Auto service')
    OR category ILIKE '%auto repair%'
    OR category ILIKE '%mechanic%'
    OR category ILIKE '%bilverkstad%'
    OR category ILIKE '%bilreparation%'
    OR all_categories && ARRAY['Auto repair shop','Mechanic']::text[]
    THEN 'auto_repair'

  ELSE 'other'
END
WHERE shop_type IS NULL;

COMMIT;

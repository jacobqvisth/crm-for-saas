-- Add freebie fields from Apify Google Maps Scraper that we weren't capturing.
-- All are returned by the base $2.10/1000 scrape — no extra add-on cost.
-- Goal: surface coordinates + Google Maps direct link in the seller UI so
-- finding a workshop is one click, plus capture description / status / service
-- options for ICP segmentation later.

BEGIN;

ALTER TABLE discovered_shops
  ADD COLUMN IF NOT EXISTS google_maps_url     TEXT,    -- direct https://www.google.com/maps/place/... link
  ADD COLUMN IF NOT EXISTS description         TEXT,    -- Google's place description / bio
  ADD COLUMN IF NOT EXISTS permanently_closed  BOOLEAN,
  ADD COLUMN IF NOT EXISTS temporarily_closed  BOOLEAN,
  ADD COLUMN IF NOT EXISTS price_level         INTEGER, -- 1=€, 2=€€, 3=€€€, 4=€€€€
  ADD COLUMN IF NOT EXISTS additional_info     JSONB,   -- service options: payments, accessibility, amenities
  ADD COLUMN IF NOT EXISTS twitter_url         TEXT,
  ADD COLUMN IF NOT EXISTS youtube_url         TEXT,
  ADD COLUMN IF NOT EXISTS plus_code           TEXT,    -- Google Plus Code (alt geo)
  ADD COLUMN IF NOT EXISTS popular_times       JSONB;   -- popularity histogram

-- linkedin_url already exists on discovered_shops (saw it in earlier schema dump)
-- but ADD COLUMN IF NOT EXISTS makes this idempotent if not.
ALTER TABLE discovered_shops
  ADD COLUMN IF NOT EXISTS linkedin_url        TEXT;

CREATE INDEX IF NOT EXISTS discovered_shops_permanently_closed_idx
  ON discovered_shops (permanently_closed) WHERE permanently_closed = TRUE;

COMMIT;

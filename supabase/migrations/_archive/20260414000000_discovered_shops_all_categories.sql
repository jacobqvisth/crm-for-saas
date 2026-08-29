-- Add all_categories TEXT[] to discovered_shops for multi-category support.
-- Apify Google Maps returns multiple categories per shop; previously only
-- categories[0] was stored. This column stores the full array so the
-- category filter can use array-overlap semantics (keep shop if ANY of its
-- categories matches the selected set).
--
-- We keep the existing `category` column (primary/display category) for
-- backward compatibility with existing queries and UI.

ALTER TABLE discovered_shops ADD COLUMN all_categories TEXT[];

-- GIN index for fast array-overlap queries at 10k+ rows
CREATE INDEX discovered_shops_all_categories_gin_idx
  ON discovered_shops USING GIN (all_categories);

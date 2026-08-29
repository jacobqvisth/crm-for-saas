-- Backfill the Lemlist CSV cohort so the CRM knows these contacts/companies
-- have already been sequenced via Lemlist (Hans's "Meko_Autoexperten_BDS_SE"
-- campaign and adjacent campaigns from the 2026-03 export).
--
-- The Lemlist CSV originally landed at the SHOP layer (discovered_shops with
-- source='lemlist', 803 SE rows). Promoting those shops created 758 companies
-- and 765 contacts via the standard discovery flow, so neither row carries any
-- Lemlist signal today. This migration backfills both layers.
--
-- Idempotent: safe to re-run. Tag append is no-op if already present;
-- custom_fields.lemlist is overwritten only with non-null fields from the
-- parent shop's raw_data.lemlist payload.

BEGIN;

-- 1. CONTACTS — set source='lemlist', append 'lemlist-csv' to tags,
--    copy useful Lemlist provenance fields into custom_fields.lemlist.
WITH shop_payload AS (
  SELECT
    crm_company_id,
    -- One company can map to multiple shop rows; pick the most recently-
    -- updated to use as the canonical Lemlist payload.
    (ARRAY_AGG(raw_data->'lemlist' ORDER BY updated_at DESC NULLS LAST))[1] AS lemlist
  FROM discovered_shops
  WHERE source = 'lemlist'
    AND crm_company_id IS NOT NULL
    AND raw_data ? 'lemlist'
  GROUP BY crm_company_id
)
UPDATE contacts c
SET
  source = 'lemlist',
  tags = CASE
    WHEN c.tags IS NULL THEN ARRAY['lemlist-csv']::text[]
    WHEN 'lemlist-csv' = ANY(c.tags) THEN c.tags
    ELSE c.tags || ARRAY['lemlist-csv']::text[]
  END,
  custom_fields = COALESCE(c.custom_fields, '{}'::jsonb)
    || jsonb_build_object(
      'lemlist',
      jsonb_strip_nulls(jsonb_build_object(
        'campaigns',           sp.lemlist->>'campaigns',
        'owner',               sp.lemlist->>'owner',
        'addedToLemlist',      sp.lemlist->>'addedToLemlist',
        'firstContactedDate',  sp.lemlist->>'firstContactedDate',
        'lastContactedDate',   sp.lemlist->>'lastContactedDate',
        'lastRepliedDate',     sp.lemlist->>'lastRepliedDate',
        'isActiveInCampaigns', sp.lemlist->>'isActiveInCampaigns',
        'leadStatus',          sp.lemlist->>'leadStatus'
      ))
    )
FROM shop_payload sp
WHERE c.company_id = sp.crm_company_id;

-- 2. COMPANIES — append 'lemlist-csv' to tags so company-level lists can also
--    filter by it. Keep companies.source untouched (it's nullable today and
--    the column's meaning at company level is fuzzier).
WITH lemlist_companies AS (
  SELECT DISTINCT crm_company_id
  FROM discovered_shops
  WHERE source = 'lemlist' AND crm_company_id IS NOT NULL
)
UPDATE companies co
SET
  tags = CASE
    WHEN co.tags IS NULL THEN ARRAY['lemlist-csv']::text[]
    WHEN 'lemlist-csv' = ANY(co.tags) THEN co.tags
    ELSE co.tags || ARRAY['lemlist-csv']::text[]
  END
FROM lemlist_companies lc
WHERE co.id = lc.crm_company_id;

COMMIT;

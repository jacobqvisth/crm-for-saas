-- Atomic company-merge RPC used by /companies/duplicates.
--
-- Keeps `p_keep_id` and drops `p_drop_id`. Moves contacts, deal_contacts,
-- deals, activities, and contact_list_members to the kept row. Fills nulls
-- on the kept row from the dropped one (never overwrites). Unions tags.
-- Marks the matching company_merge_candidates row as 'merged'.
--
-- Returns a single row with the counts so the API can show "moved N
-- contacts, M deals" feedback. Safe to call when both companies belong to
-- the same workspace; rejects cross-workspace merges with an exception.

CREATE OR REPLACE FUNCTION public.merge_companies(
  p_keep_id UUID,
  p_drop_id UUID,
  p_candidate_row_id UUID DEFAULT NULL,
  p_reviewer_id UUID DEFAULT NULL
)
RETURNS TABLE (
  keep_company_id UUID,
  dropped_company_id UUID,
  contacts_moved INTEGER,
  deals_moved INTEGER,
  activities_moved INTEGER,
  list_memberships_moved INTEGER,
  tags_after TEXT[]
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_keep_workspace UUID;
  v_drop_workspace UUID;
  v_contacts_moved INT := 0;
  v_deals_moved INT := 0;
  v_activities_moved INT := 0;
  v_list_moved INT := 0;
  v_tags_after TEXT[];
  v_drop_row RECORD;
  v_keep_row RECORD;
BEGIN
  IF p_keep_id = p_drop_id THEN
    RAISE EXCEPTION 'keep_id and drop_id must differ';
  END IF;

  SELECT workspace_id INTO v_keep_workspace FROM companies WHERE id = p_keep_id;
  SELECT workspace_id INTO v_drop_workspace FROM companies WHERE id = p_drop_id;

  IF v_keep_workspace IS NULL OR v_drop_workspace IS NULL THEN
    RAISE EXCEPTION 'one or both companies not found';
  END IF;
  IF v_keep_workspace <> v_drop_workspace THEN
    RAISE EXCEPTION 'cross-workspace merge rejected';
  END IF;

  -- Snapshot rows for the null-fill merge.
  SELECT * INTO v_keep_row FROM companies WHERE id = p_keep_id;
  SELECT * INTO v_drop_row FROM companies WHERE id = p_drop_id;

  -- Move contacts.
  UPDATE contacts SET company_id = p_keep_id WHERE company_id = p_drop_id;
  GET DIAGNOSTICS v_contacts_moved = ROW_COUNT;

  -- Move deals. deal_contacts rides along via contact moves above.
  UPDATE deals SET company_id = p_keep_id WHERE company_id = p_drop_id;
  GET DIAGNOSTICS v_deals_moved = ROW_COUNT;

  -- Move activities pinned to the company directly.
  UPDATE activities SET company_id = p_keep_id WHERE company_id = p_drop_id;
  GET DIAGNOSTICS v_activities_moved = ROW_COUNT;

  -- Move list memberships (when list rows attach to companies, not contacts).
  -- contact_list_members has contact_id, not company_id — contact moves
  -- above already covered it. Kept as a no-op placeholder for clarity.
  v_list_moved := 0;

  -- Fill nulls on the kept row from the dropped row. Never overwrite.
  -- Also union tags.
  v_tags_after := (
    SELECT ARRAY(
      SELECT DISTINCT unnest(
        COALESCE(v_keep_row.tags, ARRAY[]::text[])
        || COALESCE(v_drop_row.tags, ARRAY[]::text[])
      )
    )
  );

  UPDATE companies SET
    domain                  = COALESCE(v_keep_row.domain, v_drop_row.domain),
    website                 = COALESCE(v_keep_row.website, v_drop_row.website),
    phone                   = COALESCE(v_keep_row.phone, v_drop_row.phone),
    address                 = COALESCE(v_keep_row.address, v_drop_row.address),
    city                    = COALESCE(v_keep_row.city, v_drop_row.city),
    postal_code             = COALESCE(v_keep_row.postal_code, v_drop_row.postal_code),
    country                 = COALESCE(v_keep_row.country, v_drop_row.country),
    country_code            = COALESCE(v_keep_row.country_code, v_drop_row.country_code),
    industry                = COALESCE(v_keep_row.industry, v_drop_row.industry),
    category                = COALESCE(v_keep_row.category, v_drop_row.category),
    employee_count          = COALESCE(v_keep_row.employee_count, v_drop_row.employee_count),
    google_place_id         = COALESCE(v_keep_row.google_place_id, v_drop_row.google_place_id),
    rating                  = COALESCE(v_keep_row.rating, v_drop_row.rating),
    review_count            = COALESCE(v_keep_row.review_count, v_drop_row.review_count),
    linkedin_url            = COALESCE(v_keep_row.linkedin_url, v_drop_row.linkedin_url),
    instagram_url           = COALESCE(v_keep_row.instagram_url, v_drop_row.instagram_url),
    facebook_url            = COALESCE(v_keep_row.facebook_url, v_drop_row.facebook_url),
    org_number              = COALESCE(v_keep_row.org_number, v_drop_row.org_number),
    wl_workshop_id          = COALESCE(v_keep_row.wl_workshop_id, v_drop_row.wl_workshop_id),
    plan                    = COALESCE(v_keep_row.plan, v_drop_row.plan),
    customer_status         = COALESCE(v_keep_row.customer_status, v_drop_row.customer_status),
    lifecycle_stage         = COALESCE(v_keep_row.lifecycle_stage, v_drop_row.lifecycle_stage),
    activated_at            = COALESCE(v_keep_row.activated_at, v_drop_row.activated_at),
    stripe_customer_id      = COALESCE(v_keep_row.stripe_customer_id, v_drop_row.stripe_customer_id),
    stripe_subscription_id  = COALESCE(v_keep_row.stripe_subscription_id, v_drop_row.stripe_subscription_id),
    notes                   = COALESCE(v_keep_row.notes, v_drop_row.notes),
    tags                    = v_tags_after
  WHERE id = p_keep_id;

  -- Mark merge_candidates rows that reference either side of this pair
  -- as merged. Catches both the row that triggered this merge and any
  -- other pending rows that pair the same two companies in either order.
  UPDATE company_merge_candidates
  SET status = 'merged',
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      updated_at = now()
  WHERE status = 'pending'
    AND (
      (primary_company_id = p_keep_id AND candidate_company_id = p_drop_id)
      OR (primary_company_id = p_drop_id AND candidate_company_id = p_keep_id)
    );

  -- Re-point any other pending candidates that referenced the dropped row
  -- to the kept row, then dedupe by deleting rows that now self-pair.
  UPDATE company_merge_candidates
  SET primary_company_id = p_keep_id
  WHERE status = 'pending' AND primary_company_id = p_drop_id;
  UPDATE company_merge_candidates
  SET candidate_company_id = p_keep_id
  WHERE status = 'pending' AND candidate_company_id = p_drop_id;
  DELETE FROM company_merge_candidates
  WHERE status = 'pending'
    AND primary_company_id = candidate_company_id;

  -- Delete the dropped row last — FK ON DELETE CASCADE handles any
  -- merge_candidates rows still pointing at it.
  DELETE FROM companies WHERE id = p_drop_id;

  RETURN QUERY
  SELECT
    p_keep_id,
    p_drop_id,
    v_contacts_moved,
    v_deals_moved,
    v_activities_moved,
    v_list_moved,
    v_tags_after;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_companies TO authenticated, service_role;

-- Trigram-similarity helpers used by discover-new.ts and /companies/duplicates.
--
-- find_strict_company_match — returns up to one same-country row whose
-- normalized name has trigram similarity >= 0.95 with the input. Used to
-- auto-link a CIO signup to an existing prospect company.
--
-- find_fuzzy_company_matches — returns same-country rows with similarity
-- between 0.6 and 0.95. Fed into company_merge_candidates for human review.

CREATE OR REPLACE FUNCTION public.find_fuzzy_company_matches(
  p_workspace_id UUID,
  p_country_code TEXT,
  p_name TEXT,
  p_min_sim NUMERIC DEFAULT 0.6,
  p_max_sim NUMERIC DEFAULT 0.95,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  similarity NUMERIC,
  wl_workshop_id UUID,
  source TEXT,
  org_number TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    c.name,
    similarity(lower(public.immutable_unaccent(c.name)), lower(public.immutable_unaccent(p_name)))::numeric AS similarity,
    c.wl_workshop_id,
    c.source,
    c.org_number
  FROM companies c
  WHERE c.workspace_id = p_workspace_id
    AND c.country_code = p_country_code
    AND similarity(lower(public.immutable_unaccent(c.name)), lower(public.immutable_unaccent(p_name)))
        BETWEEN p_min_sim AND p_max_sim
  ORDER BY similarity DESC, c.created_at ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.find_fuzzy_company_matches TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.find_strict_company_match(
  p_workspace_id UUID,
  p_country_code TEXT,
  p_name TEXT,
  p_min_sim NUMERIC DEFAULT 0.95
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  similarity NUMERIC,
  wl_workshop_id UUID
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    c.name,
    similarity(lower(public.immutable_unaccent(c.name)), lower(public.immutable_unaccent(p_name)))::numeric AS similarity,
    c.wl_workshop_id
  FROM companies c
  WHERE c.workspace_id = p_workspace_id
    AND c.country_code = p_country_code
    AND similarity(lower(public.immutable_unaccent(c.name)), lower(public.immutable_unaccent(p_name))) >= p_min_sim
  ORDER BY similarity DESC, c.created_at ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.find_strict_company_match TO authenticated, service_role;

-- Foundation for smarter signup → CRM matching + outreach-to-signup attribution.
--
-- Driver: when a wl-app signup lands via discover-new.ts, today the only
-- match key is wl_workshop_id. That misses cases where the company already
-- exists from a prospect import (SCB registry, Lemlist CSV, discovery)
-- under a different email or slightly different name. Result: duplicate
-- company rows and lost attribution between outreach send → signup.
--
-- This migration adds:
--   1. pg_trgm + unaccent extensions for fuzzy name matching
--   2. companies indexes for the new match keys
--   3. company_merge_candidates table — fuzzy matches (similarity 0.6–0.95)
--      that need human review at /companies/duplicates
--   4. contacts attribution columns — link a signup contact back to the
--      outreach email_queue row + sequence that most likely caused it

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- IMMUTABLE wrapper so unaccent() can be used in functional indexes.
-- The built-in unaccent() is STABLE because it reads its dictionary at
-- runtime; pinning the dictionary makes the call deterministic.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  SET search_path = public, extensions
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- Fuzzy name search index. lower(immutable_unaccent(name)) collapses
-- Swedish ä/å/ö so 'Mårdfeldts Bilservice' matches 'Mardfeldts Bilservice'.
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm
  ON companies USING gin (lower(public.immutable_unaccent(name)) gin_trgm_ops);

-- Fast (country, org_number) lookups. Partial index keeps it small —
-- only ~7400 SCB rows have org_number today.
CREATE INDEX IF NOT EXISTS idx_companies_country_org_number
  ON companies (country_code, org_number)
  WHERE org_number IS NOT NULL;

-- Human-review queue for fuzzy (0.6 ≤ similarity < 0.95) candidate matches.
-- The strict matcher in discover-new.ts handles the 0.95+ case
-- automatically; this table catches the borderline ones for one-click
-- review at /companies/duplicates.
CREATE TABLE IF NOT EXISTS company_merge_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  primary_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  candidate_company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  similarity_score NUMERIC(4,3) NOT NULL CHECK (similarity_score BETWEEN 0 AND 1),
  match_signals JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'merged', 'dismissed')),
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT company_merge_candidates_no_self
    CHECK (primary_company_id <> candidate_company_id)
);

CREATE INDEX idx_company_merge_candidates_workspace_status
  ON company_merge_candidates (workspace_id, status, created_at DESC);

-- Prevent the same pair being queued twice while still pending.
-- Order-independent: (A, B) and (B, A) collapse to the same row.
CREATE UNIQUE INDEX idx_company_merge_candidates_pending_pair
  ON company_merge_candidates (
    workspace_id,
    LEAST(primary_company_id, candidate_company_id),
    GREATEST(primary_company_id, candidate_company_id)
  ) WHERE status = 'pending';

ALTER TABLE company_merge_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view workspace merge candidates"
  ON company_merge_candidates FOR SELECT
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE POLICY "Users update workspace merge candidates"
  ON company_merge_candidates FOR UPDATE
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE POLICY "Users insert workspace merge candidates"
  ON company_merge_candidates FOR INSERT
  WITH CHECK (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE POLICY "Users delete workspace merge candidates"
  ON company_merge_candidates FOR DELETE
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER trg_company_merge_candidates_updated_at
  BEFORE UPDATE ON company_merge_candidates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Attribution: when a signup contact gets linked to an existing company
-- that already had outreach contacts, stamp the most-recent send +
-- sequence that touched the company. Enables /ceo/conversions to compute
-- per-sequence signup rates.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS attributed_to_send_id UUID REFERENCES email_queue(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attributed_to_sequence_id UUID REFERENCES sequences(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attributed_via TEXT,
  ADD COLUMN IF NOT EXISTS attributed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_attributed_sequence
  ON contacts (attributed_to_sequence_id, attributed_at DESC)
  WHERE attributed_to_sequence_id IS NOT NULL;

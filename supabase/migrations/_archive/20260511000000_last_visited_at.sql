-- Add last_visited_at to companies and contacts so we have a single source of
-- truth for "when did we (physically or virtually) visit this workshop/contact
-- most recently". Until now visit history only lived in route_stops.visited_at,
-- which means visits that happened OUTSIDE Field Routes (manual drop-bys,
-- pre-CRM outreach) were invisible to the route generator's revisit gate.
--
-- The Field Routes Phase 5 generator now reads MAX(route_stops.visited_at,
-- companies.last_visited_at) so this column directly feeds
-- min_revisit_interval_days enforcement.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS last_visited_at TIMESTAMPTZ;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_visited_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS companies_last_visited_at_idx
  ON public.companies (workspace_id, last_visited_at DESC NULLS LAST);

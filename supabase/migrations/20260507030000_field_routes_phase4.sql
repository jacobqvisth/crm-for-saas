-- Field Routes Phase 4 — per-rep origins, working calendar, revisit interval,
-- multi-rep visibility, do_not_route flagging.

-- 1) Origin + working hours on user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS origin_address     TEXT,
  ADD COLUMN IF NOT EXISTS origin_latitude    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS origin_longitude   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS origin_geocoded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS working_days       JSONB NOT NULL DEFAULT '{"mon":true,"tue":true,"wed":true,"thu":true,"fri":true,"sat":false,"sun":false}'::jsonb;

-- 2) PTO / unavailable dates
CREATE TABLE IF NOT EXISTS user_unavailable_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS user_unavailable_dates_idx
  ON user_unavailable_dates (user_id, date);

ALTER TABLE user_unavailable_dates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_unavailable_dates_workspace_read" ON user_unavailable_dates;
CREATE POLICY "user_unavailable_dates_workspace_read"
  ON user_unavailable_dates FOR SELECT
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP POLICY IF EXISTS "user_unavailable_dates_self_write" ON user_unavailable_dates;
CREATE POLICY "user_unavailable_dates_self_write"
  ON user_unavailable_dates FOR INSERT
  WITH CHECK (user_id = auth.uid() AND workspace_id IN (SELECT get_user_workspace_ids()));

DROP POLICY IF EXISTS "user_unavailable_dates_self_update" ON user_unavailable_dates;
CREATE POLICY "user_unavailable_dates_self_update"
  ON user_unavailable_dates FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_unavailable_dates_self_delete" ON user_unavailable_dates;
CREATE POLICY "user_unavailable_dates_self_delete"
  ON user_unavailable_dates FOR DELETE
  USING (user_id = auth.uid());

-- 3) Per-company min revisit override
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS min_revisit_interval_days INTEGER;

-- 4) Route assignment
ALTER TABLE daily_routes
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS daily_routes_assigned_to_idx
  ON daily_routes (workspace_id, assigned_to, status, generated_at DESC);

-- 5) "Don't route to this shop" flag — set from per-stop removal modal with reason
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS do_not_route BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_route_reason TEXT,
  ADD COLUMN IF NOT EXISTS do_not_route_at TIMESTAMPTZ;

ALTER TABLE discovered_shops
  ADD COLUMN IF NOT EXISTS do_not_route BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_route_reason TEXT,
  ADD COLUMN IF NOT EXISTS do_not_route_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS companies_do_not_route_idx
  ON companies (workspace_id, do_not_route)
  WHERE do_not_route = true;

CREATE INDEX IF NOT EXISTS discovered_shops_do_not_route_idx
  ON discovered_shops (do_not_route)
  WHERE do_not_route = true;

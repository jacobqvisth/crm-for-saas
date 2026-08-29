-- Field Routes — Phase 1
-- Adds lat/lng to companies, creates daily_routes + route_stops tables for the
-- Hans/field-rep route planner. RLS mirrors the tasks table pattern.

-- 1) companies lat/lng (lapsed-customer pool needs coordinates for clustering)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS companies_latlng_idx
  ON companies (latitude, longitude)
  WHERE latitude IS NOT NULL;

-- 2) daily_routes — one row per generated candidate route
CREATE TABLE daily_routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  generation_batch_id UUID NOT NULL,           -- groups the 10 routes from one run

  -- composition
  mode TEXT NOT NULL CHECK (mode IN ('mixed','cold','lapsed')),
  mode_fallback_reason TEXT,                   -- e.g. "lapsed pool < 6 in cluster"
  cluster_label TEXT NOT NULL,                 -- "Stockholm South", "Uppsala", etc.

  -- planning
  origin_address TEXT NOT NULL,
  origin_latitude  DOUBLE PRECISION NOT NULL,
  origin_longitude DOUBLE PRECISION NOT NULL,
  scheduled_for DATE,                          -- NULL until Hans picks a date
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','scheduled','in_progress','completed','discarded')),

  -- precomputed totals
  stop_count INTEGER NOT NULL,
  total_drive_seconds INTEGER NOT NULL,        -- from Routes API
  total_drive_meters  INTEGER NOT NULL,
  estimated_day_seconds INTEGER NOT NULL,      -- drive + 30min × stops

  -- handoff to Google Maps
  google_maps_deeplink TEXT NOT NULL,

  -- raw response for debugging (small enough to keep)
  routes_api_response JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX daily_routes_workspace_status_idx
  ON daily_routes (workspace_id, status, generated_at DESC);

CREATE INDEX daily_routes_scheduled_for_idx
  ON daily_routes (workspace_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL;

CREATE INDEX daily_routes_batch_idx
  ON daily_routes (workspace_id, generation_batch_id);

-- 3) route_stops — one row per stop on a route, in optimized order
CREATE TABLE route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES daily_routes(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stop_order INTEGER NOT NULL,                 -- 0-based, in optimized order from Routes API

  -- the shop being visited, exactly one of these is set
  discovered_shop_id UUID REFERENCES discovered_shops(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,

  -- denormalized at generation time so the route is stable even if the shop later moves/renames
  shop_name TEXT NOT NULL,
  shop_address TEXT NOT NULL,
  latitude  DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,

  -- per-leg drive (from previous waypoint)
  leg_drive_seconds INTEGER,
  leg_drive_meters  INTEGER,

  -- visit state (Phase 3 will use these; create the columns now so the schema is stable)
  visited_at TIMESTAMPTZ,
  visit_outcome TEXT CHECK (visit_outcome IN ('interested','not_interested','closed','no_answer','skipped')),
  visit_notes TEXT,
  follow_up_required BOOLEAN,

  CONSTRAINT route_stops_one_target CHECK (
    (discovered_shop_id IS NOT NULL)::int + (company_id IS NOT NULL)::int = 1
  ),
  UNIQUE (route_id, stop_order)
);

CREATE INDEX route_stops_route_idx ON route_stops (route_id, stop_order);
CREATE INDEX route_stops_workspace_idx ON route_stops (workspace_id);

-- RLS — mirror the tasks pattern (workspace-scoped read/write)
ALTER TABLE daily_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_stops  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can access daily_routes"
  ON daily_routes FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE POLICY "workspace members can access route_stops"
  ON route_stops FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

-- Updated_at trigger on daily_routes (route_stops doesn't have updated_at)
CREATE TRIGGER update_daily_routes_updated_at
  BEFORE UPDATE ON daily_routes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Field Routes — Phase 2
-- reorder_route_stops(p_route_id, p_workspace_id, ...): atomically reassigns
-- stop_order + leg drives across all route_stops in a route, plus updates
-- daily_routes' totals + deeplink + raw response. Wraps the whole thing in a
-- single transaction so the UNIQUE(route_id, stop_order) constraint can't
-- cause partial-failure states during the reassignment.

CREATE OR REPLACE FUNCTION reorder_route_stops(
  p_route_id              UUID,
  p_workspace_id          UUID,
  p_stop_orders           JSONB,   -- [{"id": uuid, "stop_order": int, "leg_drive_seconds": int|null, "leg_drive_meters": int|null}, ...]
  p_total_drive_seconds   INT,
  p_total_drive_meters    INT,
  p_estimated_day_seconds INT,
  p_google_maps_deeplink  TEXT,
  p_routes_api_response   JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_count INT;
  v_input_count    INT;
BEGIN
  -- Verify the route belongs to the workspace
  IF NOT EXISTS (
    SELECT 1 FROM daily_routes
    WHERE id = p_route_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'route % not found in workspace %', p_route_id, p_workspace_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Verify the input set matches the existing stops 1:1 (no dupes, no extras, no missing)
  SELECT COUNT(*) INTO v_existing_count FROM route_stops WHERE route_id = p_route_id;
  SELECT COUNT(DISTINCT (s->>'id')::uuid) INTO v_input_count
    FROM jsonb_array_elements(p_stop_orders) s;
  IF v_existing_count <> v_input_count THEN
    RAISE EXCEPTION 'stopIds count mismatch: existing=% input_distinct=%',
      v_existing_count, v_input_count
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_stop_orders) s
    LEFT JOIN route_stops rs
      ON rs.id = (s->>'id')::uuid AND rs.route_id = p_route_id
    WHERE rs.id IS NULL
  ) THEN
    RAISE EXCEPTION 'stopIds contain ids not belonging to route %', p_route_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Phase A: bump every stop's order to a negative offset so the UNIQUE
  -- (route_id, stop_order) constraint can't collide during reassignment.
  UPDATE route_stops
  SET stop_order = -1 - stop_order
  WHERE route_id = p_route_id;

  -- Phase B: apply the new orders + leg drives.
  UPDATE route_stops rs
  SET
    stop_order        = (s->>'stop_order')::int,
    leg_drive_seconds = NULLIF(s->>'leg_drive_seconds', '')::int,
    leg_drive_meters  = NULLIF(s->>'leg_drive_meters',  '')::int
  FROM jsonb_array_elements(p_stop_orders) s
  WHERE rs.id = (s->>'id')::uuid
    AND rs.route_id = p_route_id;

  -- Update parent route totals + deeplink + raw response
  UPDATE daily_routes
  SET
    total_drive_seconds   = p_total_drive_seconds,
    total_drive_meters    = p_total_drive_meters,
    estimated_day_seconds = p_estimated_day_seconds,
    google_maps_deeplink  = p_google_maps_deeplink,
    routes_api_response   = p_routes_api_response,
    updated_at            = now()
  WHERE id = p_route_id;
END;
$$;

-- Allow authenticated callers to invoke (route handler still gates auth+workspace).
GRANT EXECUTE ON FUNCTION reorder_route_stops(UUID, UUID, JSONB, INT, INT, INT, TEXT, JSONB) TO authenticated, service_role;

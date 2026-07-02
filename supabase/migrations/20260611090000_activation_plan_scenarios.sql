-- Scenario "simulations" for the Activation Plan (/activation): named user
-- journeys (e.g. "Abandoned checkout") that filter the timeline to only the
-- touchpoints involved, so a journey can be followed step by step.
--
--   activation_plan_scenarios — one row per journey, per plan. `color` is the
--                               shared app-level token (src/lib/roadmap/colors.ts).
--   activation_plan_items.scenario_ids — which scenarios a touchpoint belongs
--                               to (UUID[] referencing scenarios; not a FK so
--                               membership is cheap to edit — the scenario
--                               DELETE handler prunes stale ids).
--
-- Default scenarios are lazily seeded per plan on GET /api/activation when a
-- plan has none (existing items are tagged by their seed titles).

CREATE TABLE IF NOT EXISTS activation_plan_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES activation_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'New scenario',
  description TEXT,
  color TEXT NOT NULL DEFAULT 'blue',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE activation_plan_items
  ADD COLUMN IF NOT EXISTS scenario_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_activation_plan_scenarios_plan ON activation_plan_scenarios (plan_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_activation_plan_scenarios_workspace ON activation_plan_scenarios (workspace_id);

ALTER TABLE activation_plan_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access activation_plan_scenarios" ON activation_plan_scenarios;
CREATE POLICY "workspace members can access activation_plan_scenarios"
  ON activation_plan_scenarios FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_activation_plan_scenarios_updated_at
  BEFORE UPDATE ON activation_plan_scenarios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

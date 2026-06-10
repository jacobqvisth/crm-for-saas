-- Activation Plan boards (the /activation page) — a roadmap-style timeline of
-- every touchpoint a user experiences after signing up, plotted on a relative
-- "days since signup" axis instead of calendar dates.
--
-- Three workspace-scoped tables mirroring the roadmap trio (see
-- 20260602095000_roadmap_tables.sql), guarded by the standard RLS pattern.
--
--   activation_plans       — a board. A workspace can have many (e.g. one per segment).
--   activation_plan_groups — swimlanes = channels (Email, In-app, Billing, ...).
--                            `color` is an app-level token (src/lib/roadmap/colors.ts).
--   activation_plan_items  — the touchpoints. day_start/day_end are inclusive
--                            day offsets since signup (day 0 = signup day); a
--                            point touchpoint (one email) has day_start = day_end.
--
-- Item-specific semantics:
--   trigger_type   — 'day_offset' (scheduled N days after signup) or 'event'
--                    (fires on a behavior; day_start is its *typical* day, used
--                    only for placement on the timeline).
--   anchor_event   — for event-triggered items, the behavior that fires it
--                    (free text: first_diagnosis, trial_end, first_payment, ...).
--   cio_campaign_id — links the item to a Customer.io campaign so metrics can
--                    be joined from dashboard_metric_snapshots (PR 2).
--   link_url       — deep link to the source of truth (Customer.io editor, ...).
--
-- The page lazily seeds a default board on first load (see /api/activation GET).

CREATE TABLE IF NOT EXISTS activation_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Activation plan',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activation_plan_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES activation_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'New channel',
  color TEXT NOT NULL DEFAULT 'blue',
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activation_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES activation_plans(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES activation_plan_groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New touchpoint',
  description TEXT,
  day_start INTEGER NOT NULL DEFAULT 0,
  day_end INTEGER NOT NULL DEFAULT 0,
  trigger_type TEXT NOT NULL DEFAULT 'day_offset',
  anchor_event TEXT,
  status TEXT,
  color TEXT,
  cio_campaign_id TEXT,
  link_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT activation_plan_items_days_ordered CHECK (day_end >= day_start),
  CONSTRAINT activation_plan_items_day_start_nonneg CHECK (day_start >= 0),
  CONSTRAINT activation_plan_items_trigger_type CHECK (trigger_type IN ('day_offset', 'event'))
);

-- Indexes for the common access paths (load a board's groups+items).
CREATE INDEX IF NOT EXISTS idx_activation_plans_workspace ON activation_plans (workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_activation_plan_groups_plan ON activation_plan_groups (plan_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_activation_plan_groups_workspace ON activation_plan_groups (workspace_id);
CREATE INDEX IF NOT EXISTS idx_activation_plan_items_plan ON activation_plan_items (plan_id);
CREATE INDEX IF NOT EXISTS idx_activation_plan_items_group ON activation_plan_items (group_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_activation_plan_items_workspace ON activation_plan_items (workspace_id);

-- RLS — same pattern as the roadmap tables.
ALTER TABLE activation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE activation_plan_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE activation_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access activation_plans" ON activation_plans;
CREATE POLICY "workspace members can access activation_plans"
  ON activation_plans FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP POLICY IF EXISTS "workspace members can access activation_plan_groups" ON activation_plan_groups;
CREATE POLICY "workspace members can access activation_plan_groups"
  ON activation_plan_groups FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP POLICY IF EXISTS "workspace members can access activation_plan_items" ON activation_plan_items;
CREATE POLICY "workspace members can access activation_plan_items"
  ON activation_plan_items FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

-- updated_at triggers
CREATE TRIGGER update_activation_plans_updated_at
  BEFORE UPDATE ON activation_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_activation_plan_groups_updated_at
  BEFORE UPDATE ON activation_plan_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_activation_plan_items_updated_at
  BEFORE UPDATE ON activation_plan_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

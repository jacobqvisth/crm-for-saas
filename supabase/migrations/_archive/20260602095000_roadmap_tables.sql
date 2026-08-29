-- Roadmap / timeline boards (the /roadmap page) — a Miro/Jira-style Gantt.
--
-- Three workspace-scoped tables, all guarded by the standard RLS pattern
-- (workspace_id IN (SELECT get_user_workspace_ids())) so any workspace
-- member can read/write their boards, and all are isolated per workspace.
--
--   roadmaps        — a board (e.g. "WL Marketing"). A workspace can have many.
--   roadmap_groups  — swimlanes within a board (Email, Ads, Social Media, ...).
--                     `color` is an app-level token (see src/lib/roadmap/colors.ts),
--                     not a CSS class — yellow|green|blue|orange|purple|red|teal|gray.
--   roadmap_items   — the bars. start_date/end_date are inclusive DATEs; a bar's
--                     duration in days = (end_date - start_date + 1).
--
-- The page lazily seeds a default board on first load (see /api/roadmap GET),
-- so there is no data seeded here.

CREATE TABLE IF NOT EXISTS roadmaps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled roadmap',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roadmap_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'New group',
  color TEXT NOT NULL DEFAULT 'blue',
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roadmap_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  roadmap_id UUID NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES roadmap_groups(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New item',
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT,
  owner TEXT,
  phase TEXT,
  priority TEXT,
  team TEXT,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT roadmap_items_dates_ordered CHECK (end_date >= start_date)
);

-- Indexes for the common access paths (load a board's groups+items).
CREATE INDEX IF NOT EXISTS idx_roadmaps_workspace ON roadmaps (workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_roadmap_groups_roadmap ON roadmap_groups (roadmap_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_roadmap_groups_workspace ON roadmap_groups (workspace_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_items_roadmap ON roadmap_items (roadmap_id);
CREATE INDEX IF NOT EXISTS idx_roadmap_items_group ON roadmap_items (group_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_roadmap_items_workspace ON roadmap_items (workspace_id);

-- RLS — mirror the tasks table: one FOR ALL policy per table, gated on
-- workspace membership. WITH CHECK defaults to the USING expression, so
-- inserts must set a workspace_id the caller belongs to.
ALTER TABLE roadmaps ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmap_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE roadmap_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access roadmaps" ON roadmaps;
CREATE POLICY "workspace members can access roadmaps"
  ON roadmaps FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP POLICY IF EXISTS "workspace members can access roadmap_groups" ON roadmap_groups;
CREATE POLICY "workspace members can access roadmap_groups"
  ON roadmap_groups FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP POLICY IF EXISTS "workspace members can access roadmap_items" ON roadmap_items;
CREATE POLICY "workspace members can access roadmap_items"
  ON roadmap_items FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

-- updated_at triggers
CREATE TRIGGER update_roadmaps_updated_at
  BEFORE UPDATE ON roadmaps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_roadmap_groups_updated_at
  BEFORE UPDATE ON roadmap_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_roadmap_items_updated_at
  BEFORE UPDATE ON roadmap_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

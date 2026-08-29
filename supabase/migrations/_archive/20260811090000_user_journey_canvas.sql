-- User Journey canvas (the /journey page) — a free-form, Miro-style board for
-- mapping how a user travels from the landing page through signup to paying
-- customer. Unlike the activation timeline, items here have absolute canvas
-- coordinates and are dragged around freely.
--
--   journey_boards — a board. A workspace can have many.
--   journey_items  — everything on a board:
--     type 'note'  — sticky note; `content` is the text, `color` the sticky color.
--     type 'label' — free-floating heading text (stage titles etc.).
--     type 'image' — uploaded screenshot; `image_url` points at the public
--                    journey-images storage bucket, `content` is an optional caption.
--     type 'frame' — background section rectangle with a title, rendered
--                    behind other items to group a funnel stage.
--   x/y/w/h are canvas pixels at zoom 1; z orders items within their layer
--   (frames always render under notes/images regardless of z).

CREATE TABLE IF NOT EXISTS journey_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'User Journey',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journey_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES journey_boards(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'note',
  x DOUBLE PRECISION NOT NULL DEFAULT 0,
  y DOUBLE PRECISION NOT NULL DEFAULT 0,
  w DOUBLE PRECISION NOT NULL DEFAULT 200,
  h DOUBLE PRECISION NOT NULL DEFAULT 200,
  z INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  image_url TEXT,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT journey_items_type CHECK (type IN ('note', 'label', 'image', 'frame'))
);

CREATE INDEX IF NOT EXISTS idx_journey_boards_workspace ON journey_boards (workspace_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_journey_items_board ON journey_items (board_id);
CREATE INDEX IF NOT EXISTS idx_journey_items_workspace ON journey_items (workspace_id);

-- RLS — same pattern as the roadmap/activation tables.
ALTER TABLE journey_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE journey_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access journey_boards" ON journey_boards;
CREATE POLICY "workspace members can access journey_boards"
  ON journey_boards FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP POLICY IF EXISTS "workspace members can access journey_items" ON journey_items;
CREATE POLICY "workspace members can access journey_items"
  ON journey_items FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

-- updated_at triggers
CREATE TRIGGER update_journey_boards_updated_at
  BEFORE UPDATE ON journey_boards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_journey_items_updated_at
  BEFORE UPDATE ON journey_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

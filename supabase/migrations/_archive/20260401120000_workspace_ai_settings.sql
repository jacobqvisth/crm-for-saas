CREATE TABLE workspace_ai_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  icp_prompt TEXT,
  filter_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id)
);

ALTER TABLE workspace_ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_can_select_ai_settings"
  ON workspace_ai_settings FOR SELECT
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE POLICY "workspace_members_can_insert_ai_settings"
  ON workspace_ai_settings FOR INSERT
  WITH CHECK (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE POLICY "workspace_members_can_update_ai_settings"
  ON workspace_ai_settings FOR UPDATE
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_workspace_ai_settings_updated_at
  BEFORE UPDATE ON workspace_ai_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

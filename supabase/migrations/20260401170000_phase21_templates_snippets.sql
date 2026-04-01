-- Snippets: reusable text blocks for email writing
CREATE TABLE IF NOT EXISTS snippets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE snippets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage snippets"
  ON snippets FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE INDEX IF NOT EXISTS idx_snippets_workspace ON snippets(workspace_id);

-- Template version history: snapshot of previous template state on each save
CREATE TABLE IF NOT EXISTS template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES email_templates(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can view template versions"
  ON template_versions FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE INDEX IF NOT EXISTS idx_template_versions_template
  ON template_versions(template_id, version DESC);

-- update_updated_at trigger for snippets
CREATE TRIGGER update_snippets_updated_at
  BEFORE UPDATE ON snippets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

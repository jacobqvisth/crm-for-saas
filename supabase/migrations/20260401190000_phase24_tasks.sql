-- Tasks table
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'generic' CHECK (type IN ('email', 'call', 'linkedin', 'generic')),
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can access tasks"
  ON tasks FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

-- Index for common queries
CREATE INDEX tasks_workspace_due ON tasks (workspace_id, due_date);
CREATE INDEX tasks_workspace_contact ON tasks (workspace_id, contact_id);

-- Updated_at trigger
CREATE TRIGGER update_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

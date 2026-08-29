-- Structured product feedback captured during calls to EXISTING users
-- (ideas, bugs, complaints). One call can yield several feedback items, so
-- this is a child table of the call activity rather than a column on it.
-- Prospect calls don't use this — they're handled by activities.outcome +
-- sequence enrollment.

CREATE TABLE call_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- where it came from
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,  -- the call
  contact_id  UUID REFERENCES contacts(id)   ON DELETE CASCADE,
  company_id  UUID REFERENCES companies(id)  ON DELETE CASCADE,
  user_id     UUID,                                               -- who logged it

  -- what it is
  category TEXT NOT NULL CHECK (category IN (
    'bug', 'feature_request', 'complaint', 'praise', 'other'
  )),
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT,
  body  TEXT NOT NULL,

  -- triage workflow (product owns this lifecycle)
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new', 'triaged', 'planned', 'shipped', 'wont_do'
  )),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX call_feedback_workspace_status_idx
  ON call_feedback (workspace_id, status);
CREATE INDEX call_feedback_contact_idx
  ON call_feedback (contact_id);
CREATE INDEX call_feedback_company_idx
  ON call_feedback (company_id);
CREATE INDEX call_feedback_activity_idx
  ON call_feedback (activity_id);

-- RLS — mirror the field_routes / tasks pattern (workspace-scoped read/write)
ALTER TABLE call_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can access call_feedback"
  ON call_feedback FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

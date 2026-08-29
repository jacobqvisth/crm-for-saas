-- Editable AI product knowledge per workspace.
--
-- Until now the canonical Wrenchlane knowledge (product description, pricing,
-- objections, videos, articles, guardrails) lived as a static TS constant at
-- src/lib/inbox/wrenchlane-knowledge.ts. To let Jacob edit it without a code
-- deploy, we persist the markdown per workspace and load it at runtime in both
-- AI paths (draft-reply, generate-email). The TS constant stays as the seed
-- fallback when a workspace has not yet customised it.

CREATE TABLE IF NOT EXISTS workspace_ai_knowledge (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  content_md   TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE workspace_ai_knowledge IS 'Per-workspace markdown the AI is grounded in when drafting inbox replies + cold emails. Falls back to the seed in src/lib/inbox/wrenchlane-knowledge.ts when empty.';
COMMENT ON COLUMN workspace_ai_knowledge.content_md IS 'Full prompt-shape markdown — product description, pricing, objections, video library, etc.';

ALTER TABLE workspace_ai_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_ai_knowledge_read ON workspace_ai_knowledge;
CREATE POLICY workspace_ai_knowledge_read ON workspace_ai_knowledge
  FOR SELECT
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP POLICY IF EXISTS workspace_ai_knowledge_write ON workspace_ai_knowledge;
CREATE POLICY workspace_ai_knowledge_write ON workspace_ai_knowledge
  FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()))
  WITH CHECK (workspace_id IN (SELECT get_user_workspace_ids()));

-- Keep updated_at honest.
CREATE OR REPLACE FUNCTION workspace_ai_knowledge_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_workspace_ai_knowledge_updated_at ON workspace_ai_knowledge;
CREATE TRIGGER trg_workspace_ai_knowledge_updated_at
  BEFORE UPDATE ON workspace_ai_knowledge
  FOR EACH ROW EXECUTE FUNCTION workspace_ai_knowledge_set_updated_at();

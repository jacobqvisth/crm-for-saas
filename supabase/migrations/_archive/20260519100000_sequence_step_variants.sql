-- Phase: multi-variant sequence steps
--
-- A sequence step can have N alternate message bodies. At enrollment (or at
-- send-time for follow-ups) the variant picker chooses one variant per contact
-- via weighted-greedy least-used. The picked variant_id rides on the queue row
-- so opens/replies attribute back to it.
--
-- Strictly additive: a step with zero variants falls back to its own
-- subject_override/body_override (legacy behavior). No backfill required.

CREATE TABLE sequence_step_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_step_id UUID NOT NULL REFERENCES sequence_steps(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  ai_generation_model TEXT,
  ai_parent_variant_id UUID REFERENCES sequence_step_variants(id) ON DELETE SET NULL,
  sends_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sequence_step_variants_step
  ON sequence_step_variants(sequence_step_id);
CREATE INDEX idx_sequence_step_variants_workspace
  ON sequence_step_variants(workspace_id);
CREATE INDEX idx_sequence_step_variants_active
  ON sequence_step_variants(sequence_step_id)
  WHERE is_active = true AND weight > 0;

CREATE TRIGGER update_sequence_step_variants_updated_at
  BEFORE UPDATE ON sequence_step_variants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE sequence_step_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view variants in their workspace"
  ON sequence_step_variants FOR SELECT
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE POLICY "Users insert variants in their workspace"
  ON sequence_step_variants FOR INSERT
  WITH CHECK (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE POLICY "Users update variants in their workspace"
  ON sequence_step_variants FOR UPDATE
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE POLICY "Users delete variants in their workspace"
  ON sequence_step_variants FOR DELETE
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

-- Atomic sends_count increment. Read-modify-write from JS would race under
-- concurrent cron runs + enrollments; this RPC issues a single UPDATE.
CREATE OR REPLACE FUNCTION increment_variant_sends(p_variant_id UUID, p_delta INT)
RETURNS VOID AS $$
BEGIN
  UPDATE sequence_step_variants
  SET sends_count = sends_count + p_delta
  WHERE id = p_variant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION increment_variant_sends(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_variant_sends(UUID, INT) TO authenticated, service_role;

-- Attribution: which variant produced this queue row. NULL = step had no
-- variants when this row was materialized (legacy fallback path).
ALTER TABLE email_queue
  ADD COLUMN variant_id UUID REFERENCES sequence_step_variants(id) ON DELETE SET NULL;

CREATE INDEX idx_email_queue_variant
  ON email_queue(variant_id)
  WHERE variant_id IS NOT NULL;

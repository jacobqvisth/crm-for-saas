-- Phase 17: Suppressions table — unified suppression list
-- Replaces unsubscribes table as the primary suppression check
-- The unsubscribes table is kept for backward compatibility

CREATE TABLE IF NOT EXISTS suppressions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email           TEXT,
  domain          TEXT,
  reason          TEXT        NOT NULL,
  -- reason values: 'unsubscribed', 'bounced', 'objection', 'manual', 'dnclist', 'gdpr_erasure'
  source          TEXT,
  -- source: free text describing where it came from
  active          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Either email or domain must be set (or both)
ALTER TABLE suppressions ADD CONSTRAINT suppressions_email_or_domain
  CHECK (email IS NOT NULL OR domain IS NOT NULL);

-- Unique constraint: one active suppression per email per workspace
CREATE UNIQUE INDEX suppressions_workspace_email_active_idx
  ON suppressions (workspace_id, email)
  WHERE active = TRUE AND email IS NOT NULL;

-- Unique constraint: one active suppression per domain per workspace
CREATE UNIQUE INDEX suppressions_workspace_domain_active_idx
  ON suppressions (workspace_id, domain)
  WHERE active = TRUE AND domain IS NOT NULL;

CREATE INDEX suppressions_workspace_id_idx ON suppressions(workspace_id);
CREATE INDEX suppressions_email_idx ON suppressions(email) WHERE active = TRUE;
CREATE INDEX suppressions_domain_idx ON suppressions(domain) WHERE active = TRUE;

ALTER TABLE suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_members_can_access_suppressions"
  ON suppressions
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_suppressions_updated_at
  BEFORE UPDATE ON suppressions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Migrate existing unsubscribes into suppressions
-- Note: unsubscribes table uses unsubscribed_at (not created_at)
INSERT INTO suppressions (workspace_id, email, reason, source, created_at)
SELECT u.workspace_id, u.email, 'unsubscribed', 'migrated from unsubscribes table', u.unsubscribed_at
FROM unsubscribes u
ON CONFLICT DO NOTHING;
-- Note: created_by column has no FK (workspace_members.user_id has no unique constraint)

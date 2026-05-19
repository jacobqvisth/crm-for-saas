-- Add domain_aliases for workspaces so a single workspace can match
-- multiple email domains at sign-up time.
--
-- Example: Wrenchlane operates wrenchlane.com (primary) and wrenchlane.co.
-- Before this migration, a @wrenchlane.co Google sign-in created a new
-- workspace because the auth callback only matched workspaces.domain.
-- After this migration the callback also matches anything in
-- workspaces.domain_aliases, so @wrenchlane.co users land in the same
-- workspace as @wrenchlane.com users.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS domain_aliases TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN workspaces.domain_aliases IS
  'Extra email domains that should map to this workspace during Google-OAuth sign-up auto-onboarding (e.g. ["wrenchlane.co"] for the wrenchlane.com workspace). Stored as lowercase; auth callback compares case-insensitively.';

-- Seed the main wrenchlane workspace with the .co alias.
UPDATE workspaces
SET domain_aliases = ARRAY['wrenchlane.co']
WHERE domain = 'wrenchlane.com'
  AND NOT ('wrenchlane.co' = ANY(domain_aliases));

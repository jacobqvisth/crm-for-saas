-- Field-visit follow-up controls (Phase 3 of field routes).
--
-- skip_auto_followup: per-company opt-out of the post-visit auto-enroll.
-- do_not_contact: explicit DNC flag (set automatically when a visit outcome
-- is 'not_interested', also editable from the company detail page).

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS skip_auto_followup BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_contact BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS companies_skip_auto_followup_idx
  ON companies (workspace_id, skip_auto_followup)
  WHERE skip_auto_followup = true;

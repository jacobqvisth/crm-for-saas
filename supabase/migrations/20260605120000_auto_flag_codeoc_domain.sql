-- Add codeoc.ai to the internal-test domain backfill. CodeOC is the dev company
-- behind Wrenchlane, so every codeoc.ai account is an internal team member and
-- must be excluded from CEO dashboard metrics (top lists, active users, etc.).
--
-- Mirrors applyInternalTestDomainFlag() in
-- src/lib/ceo/internal-test/auto-flag.ts (codeoc.ai added there too), applied
-- once now against historical rows. Respects is_internal_test_exempt so an
-- individual account can still opt back in.

UPDATE public.dashboard_users
SET
  is_internal_test = true,
  internal_test_note = COALESCE(internal_test_note, 'auto: internal email domain'),
  internal_test_set_at = COALESCE(internal_test_set_at, now()),
  internal_test_set_by = COALESCE(internal_test_set_by, 'auto-domain-filter')
WHERE
  is_internal_test = false
  AND is_internal_test_exempt = false
  AND lower(metadata->>'email_domain') IN ('codeoc.ai');

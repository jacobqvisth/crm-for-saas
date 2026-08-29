-- Auto-flag any dashboard_users whose email domain matches an internal-test
-- domain (currently just @wrenchlane.com). Mirrors what
-- applyInternalTestDomainFlag() in src/lib/ceo/internal-test/auto-flag.ts runs
-- after every core_app sync, but applied once now against historical rows so
-- the next sync doesn't have to.
--
-- We respect dashboard_users.is_internal_test_exempt — an individual user can
-- opt out of being filtered even if their domain is on the internal list.

UPDATE public.dashboard_users
SET
  is_internal_test = true,
  internal_test_note = COALESCE(internal_test_note, 'auto: internal email domain'),
  internal_test_set_at = COALESCE(internal_test_set_at, now()),
  internal_test_set_by = COALESCE(internal_test_set_by, 'auto-domain-filter')
WHERE
  is_internal_test = false
  AND is_internal_test_exempt = false
  AND lower(metadata->>'email_domain') IN ('wrenchlane.com');

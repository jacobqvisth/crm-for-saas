-- Canonical signup timestamp for dashboard_users.
--
-- Background: /ceo/new-users computed an "effective signup date" at read time
-- by falling back through created_at → metadata.customer_io_created_at →
-- metadata.stripe_customer_created_at. When the WL-app's S3 export shipped
-- a brand-new owner with NULL user_created_at AND no CIO/Stripe match yet
-- (e.g. fresh signup, no payment, not in CIO segment), every fallback
-- returned null and the user fell out of the Sign-ups chart entirely. May 11
-- 2026 lost two real signups (Cusmat, Autostar) this way.
--
-- This migration introduces a single explicit field populated by an explicit
-- priority chain in the writer (src/lib/ceo/sync/sources/core-app.ts) so all
-- consumers — Sign-ups chart, future analytics, BI — share one source of
-- truth. A 4th fallback (workshop.created_at) closes the gap that caused
-- the May 11 miss: when a user owns a workshop, the workshop's creation
-- timestamp is the effective signup time even if the user-level timestamp
-- is missing.
--
-- The daily sync-health cron also alerts when any user inserted in the
-- last 24h has signed_up_at = NULL, so a new failure mode never sits
-- silently again.

ALTER TABLE public.dashboard_users
  ADD COLUMN IF NOT EXISTS signed_up_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS dashboard_users_signed_up_at_idx
  ON public.dashboard_users (signed_up_at);

-- Backfill existing rows with the same priority chain the writer will use:
--   1. dashboard_users.created_at (canonical from S3 user_created_at/created_at)
--   2. dashboard_workshops.created_at for the user's workshop (NEW fallback)
--   3. metadata.customer_io_created_at
--   4. metadata.stripe_customer_created_at
--
-- Also stamp metadata.signed_up_at_source so the /ceo/new-users coverage
-- breakdown can distinguish which signal won — useful both for the UI and
-- for spotting silent shifts in source distribution over time.
WITH derived AS (
  SELECT
    du.internal_user_id,
    COALESCE(
      du.created_at,
      dw.created_at,
      NULLIF(du.metadata->>'customer_io_created_at', '')::timestamptz,
      NULLIF(du.metadata->>'stripe_customer_created_at', '')::timestamptz
    ) AS signed_up_at,
    CASE
      WHEN du.created_at IS NOT NULL THEN 'core_app_user'
      WHEN dw.created_at IS NOT NULL THEN 'core_app_workshop'
      WHEN NULLIF(du.metadata->>'customer_io_created_at', '') IS NOT NULL THEN 'customer_io'
      WHEN NULLIF(du.metadata->>'stripe_customer_created_at', '') IS NOT NULL THEN 'stripe'
      ELSE NULL
    END AS signed_up_at_source
  FROM public.dashboard_users du
  LEFT JOIN public.dashboard_workshops dw ON dw.workshop_id = du.workshop_id
)
UPDATE public.dashboard_users du
SET
  signed_up_at = derived.signed_up_at,
  metadata = CASE
    WHEN derived.signed_up_at_source IS NULL THEN du.metadata
    ELSE jsonb_set(
      COALESCE(du.metadata, '{}'::jsonb),
      '{signed_up_at_source}',
      to_jsonb(derived.signed_up_at_source),
      true
    )
  END
FROM derived
WHERE du.internal_user_id = derived.internal_user_id
  AND du.signed_up_at IS NULL;

COMMENT ON COLUMN public.dashboard_users.signed_up_at IS
  'Canonical signup timestamp. Populated by core_app sync writer using priority chain: user_created_at -> created_at -> workshop.created_at -> customer_io_created_at -> stripe_customer_created_at. The winning source is stamped on metadata.signed_up_at_source. Read directly by /ceo/new-users; do not recompute downstream.';

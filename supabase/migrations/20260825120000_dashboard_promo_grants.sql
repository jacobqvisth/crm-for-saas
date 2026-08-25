-- Promo Users (/dashboard/promo-users). Persists Stripe coupon / promotion-code
-- grants so "which users got a discount, and what did they then do?" is a
-- normal dashboard question instead of a one-off Stripe API pull.
--
-- Until now nothing in the warehouse recorded discounts at all: the Stripe sync
-- read subscriptions and paid invoices but dropped every discount field, so the
-- only trace of a promo was free-text left by hand in
-- dashboard_subscriptions.metadata (extension_reason / partner_comp / note).
--
-- GRAIN: one row per (stripe customer, coupon). That is the unit a human means
-- by "this workshop got WRENCHLANE90" — a single coupon applied across a dozen
-- monthly invoices is ONE grant, not twelve. The same customer under two
-- different coupons is two grants.
--
-- The promotion code is an attribute of the grant, not part of its key: the
-- same coupon is often applied both through a code and by hand in the Stripe
-- dashboard, and keying on the code would split that into two half-grants and
-- double-count the customer. `promotion_code` holds the first code seen and
-- metadata.promotion_codes holds all of them.
--
-- Two things feed a grant, and a grant can come from either or both:
--   * a discount currently attached to a subscription (the live state), and
--   * discounts applied on historical invoices (the money actually given up).
-- `source` records which, because a grant seen only on invoices means the
-- discount has since expired or been removed, while a grant seen only on a
-- subscription has not been billed yet.
--
-- Money is stored per grant in the grant's own currency (SEK / USD / EUR are
-- all in use), so never SUM across rows without grouping by currency — the
-- same trap documented for dashboard_subscriptions.mrr_amount_cents.

CREATE TABLE IF NOT EXISTS dashboard_promo_grants (
  grant_id TEXT PRIMARY KEY,
  stripe_customer_id TEXT,
  customer_email TEXT,
  workshop_id UUID,
  internal_user_id TEXT,
  -- Human-facing code (WRENCHLANE90). NULL when the coupon was applied
  -- directly to the customer in the Stripe dashboard with no promotion code,
  -- which is how most of the hand-made comps were given.
  promotion_code TEXT,
  promotion_code_id TEXT,
  coupon_id TEXT NOT NULL,
  coupon_name TEXT,
  percent_off NUMERIC(5, 2),
  amount_off_cents INTEGER,
  duration TEXT,
  duration_in_months INTEGER,
  -- 'subscription' | 'invoice' | 'both'
  source TEXT NOT NULL DEFAULT 'invoice',
  active_on_subscription BOOLEAN NOT NULL DEFAULT FALSE,
  stripe_subscription_id TEXT,
  subscription_status TEXT,
  first_applied_at TIMESTAMPTZ,
  last_applied_at TIMESTAMPTZ,
  invoice_count INTEGER NOT NULL DEFAULT 0,
  total_discount_cents BIGINT NOT NULL DEFAULT 0,
  total_paid_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_promo_grants_email
  ON dashboard_promo_grants (customer_email);

CREATE INDEX IF NOT EXISTS idx_dashboard_promo_grants_customer
  ON dashboard_promo_grants (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_dashboard_promo_grants_code
  ON dashboard_promo_grants (promotion_code);

CREATE INDEX IF NOT EXISTS idx_dashboard_promo_grants_applied
  ON dashboard_promo_grants (last_applied_at DESC);

-- RLS: mirror the other dashboard_* tables — RLS on, authenticated read only.
-- The dashboard reads through the service-role client (bypasses RLS) and the
-- sync writes as service role.
ALTER TABLE dashboard_promo_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read promo grants"
  ON dashboard_promo_grants;
CREATE POLICY "authenticated can read promo grants"
  ON dashboard_promo_grants FOR SELECT
  TO authenticated
  USING (true);

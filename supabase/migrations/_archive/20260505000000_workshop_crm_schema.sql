-- ============================================================================
-- Workshop / customer CRM schema
--
-- Extends companies + contacts to model Wrenchlane platform customers
-- (workshops + their app users) inside the CRM. Adds two new tables:
--   - subscriptions  — Stripe subscription history (one row per stripe sub)
--   - usage_events   — generic event stream for future dashboard merge
--                      (login events, diagnostic events, Stripe webhooks, etc.)
--
-- IDs:
--   companies.wl_workshop_id  = dashboard workshop UUID (unique)
--   contacts.wl_user_id       = AWS Cognito sub UUID  (unique)
-- These are the source of truth for "is this row a real customer".
-- The existing companies.id / contacts.id remain the CRM-internal IDs.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. companies — workshop / customer fields
-- ----------------------------------------------------------------------------
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS wl_workshop_id           UUID,
  ADD COLUMN IF NOT EXISTS lifecycle_stage          TEXT,
  ADD COLUMN IF NOT EXISTS customer_status          TEXT,
  ADD COLUMN IF NOT EXISTS plan                     TEXT,
  ADD COLUMN IF NOT EXISTS plan_billing_cycle       TEXT,
  ADD COLUMN IF NOT EXISTS mrr_cents                INTEGER,
  ADD COLUMN IF NOT EXISTS arr_cents                INTEGER,
  ADD COLUMN IF NOT EXISTS currency                 TEXT,
  ADD COLUMN IF NOT EXISTS trial_ends_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS churned_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS churn_reason             TEXT,
  ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id   TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status      TEXT,
  ADD COLUMN IF NOT EXISTS payment_status           TEXT,
  ADD COLUMN IF NOT EXISTS acquisition_source       TEXT,
  ADD COLUMN IF NOT EXISTS created_by_agent         TEXT,
  ADD COLUMN IF NOT EXISTS account_owner_id         UUID,
  ADD COLUMN IF NOT EXISTS member_count             INTEGER,
  ADD COLUMN IF NOT EXISTS last_active_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_score             INTEGER;

COMMENT ON COLUMN companies.wl_workshop_id IS
  'Wrenchlane platform workshop UUID. Populated only for rows that originated from the Wrenchlane app (existing customers). NULL for prospects, scraped shops, manual adds.';
COMMENT ON COLUMN companies.lifecycle_stage IS
  'Sales/CS funnel stage: lead | mql | sql | trial | paying | churned | reactivation';
COMMENT ON COLUMN companies.customer_status IS
  'Operational customer status: trialing | active | paused | inactive | churned';
COMMENT ON COLUMN companies.mrr_cents IS
  'Normalized monthly recurring revenue in minor units (yearly plans / 12).';

CREATE UNIQUE INDEX IF NOT EXISTS companies_wl_workshop_id_idx
  ON companies (wl_workshop_id) WHERE wl_workshop_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS companies_lifecycle_stage_idx
  ON companies (lifecycle_stage) WHERE lifecycle_stage IS NOT NULL;
CREATE INDEX IF NOT EXISTS companies_customer_status_idx
  ON companies (customer_status) WHERE customer_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS companies_stripe_subscription_id_idx
  ON companies (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. contacts — app user fields
-- ----------------------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS wl_user_id                  UUID,
  ADD COLUMN IF NOT EXISTS app_username                TEXT,
  ADD COLUMN IF NOT EXISTS app_role                    TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at               TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_active_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS login_count                 INTEGER,
  ADD COLUMN IF NOT EXISTS credits_remaining           INTEGER,
  ADD COLUMN IF NOT EXISTS user_plan_type              TEXT,
  ADD COLUMN IF NOT EXISTS user_subscription_status    TEXT,
  ADD COLUMN IF NOT EXISTS user_stripe_customer_id     TEXT,
  ADD COLUMN IF NOT EXISTS user_stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS diagnostics_total           INTEGER,
  ADD COLUMN IF NOT EXISTS diagnostics_first_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS diagnostics_last_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS diagnostics_last_30d        INTEGER;

COMMENT ON COLUMN contacts.wl_user_id IS
  'Wrenchlane platform user UUID (AWS Cognito sub). Populated only for rows that originated from the Wrenchlane app. NULL for cold contacts/prospects.';
COMMENT ON COLUMN contacts.app_role IS
  'Role inside the Wrenchlane app: admin | mechanic';

CREATE UNIQUE INDEX IF NOT EXISTS contacts_wl_user_id_idx
  ON contacts (wl_user_id) WHERE wl_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_app_role_idx
  ON contacts (app_role) WHERE app_role IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_last_active_at_idx
  ON contacts (last_active_at DESC NULLS LAST);

-- ----------------------------------------------------------------------------
-- 3. subscriptions table — Stripe subscription history
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            UUID         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id              UUID         NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT         UNIQUE,
  plan                    TEXT,
  status                  TEXT,
  current_period_start    TIMESTAMPTZ,
  current_period_end      TIMESTAMPTZ,
  trial_start             TIMESTAMPTZ,
  trial_end               TIMESTAMPTZ,
  cancel_at_period_end    BOOLEAN      NOT NULL DEFAULT FALSE,
  canceled_at             TIMESTAMPTZ,
  mrr_cents               INTEGER,
  currency                TEXT         DEFAULT 'EUR',
  metadata                JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_company_idx     ON subscriptions(company_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx      ON subscriptions(status);
CREATE INDEX IF NOT EXISTS subscriptions_workspace_idx   ON subscriptions(workspace_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace_members_can_access_subscriptions" ON subscriptions;
CREATE POLICY "workspace_members_can_access_subscriptions"
  ON subscriptions
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ----------------------------------------------------------------------------
-- 4. usage_events table — generic event stream
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_events (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID          NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id    UUID          REFERENCES companies(id) ON DELETE CASCADE,
  contact_id    UUID          REFERENCES contacts(id) ON DELETE CASCADE,
  event_type    TEXT          NOT NULL,
  event_at      TIMESTAMPTZ   NOT NULL,
  source        TEXT,
  metadata      JSONB         NOT NULL DEFAULT '{}'::jsonb,
  external_id   TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Idempotency: same (source, external_id) ⇒ no duplicate event
CREATE UNIQUE INDEX IF NOT EXISTS usage_events_source_external_id_idx
  ON usage_events (source, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS usage_events_company_at_idx
  ON usage_events (company_id, event_at DESC) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_events_contact_at_idx
  ON usage_events (contact_id, event_at DESC) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_events_type_at_idx
  ON usage_events (event_type, event_at DESC);

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workspace_members_can_access_usage_events" ON usage_events;
CREATE POLICY "workspace_members_can_access_usage_events"
  ON usage_events
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

COMMIT;

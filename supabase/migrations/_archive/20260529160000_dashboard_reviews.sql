-- Reviews dashboard (/ceo/reviews). Tracks Wrenchlane's rating + review
-- count across every SaaS review platform we care about, plus a feed of
-- individual reviews where a platform exposes them.
--
-- Two tables:
--   dashboard_review_snapshots — one row per (platform, as-of date). The
--     latest row per platform is the current scorecard; the full history
--     drives the trend chart. Populated by manual CEO entry (PR1) and, for
--     the few platforms with usable APIs (Google Business Profile,
--     Trustpilot), by the /api/cron/sync-reviews cron (PR2).
--   dashboard_reviews — individual reviews, for platforms that expose them.
--     Upsert on (platform_slug, external_id) so re-syncing is idempotent.
--
-- platform_slug is an app-level enum (see src/lib/ceo/reviews/platforms.ts),
-- intentionally not an FK — the platform list lives in code, not the DB.
-- source = 'manual' | 'api' | 'widget' — where the row's data came from.

CREATE TABLE IF NOT EXISTS dashboard_review_snapshots (
  id BIGSERIAL PRIMARY KEY,
  platform_slug TEXT NOT NULL,
  captured_at DATE NOT NULL,
  rating NUMERIC(2, 1),
  review_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT,
  entered_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform_slug, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_review_snapshots_platform_date
  ON dashboard_review_snapshots (platform_slug, captured_at DESC);

CREATE TABLE IF NOT EXISTS dashboard_reviews (
  id BIGSERIAL PRIMARY KEY,
  platform_slug TEXT NOT NULL,
  external_id TEXT NOT NULL,
  rating NUMERIC(2, 1),
  title TEXT,
  body TEXT,
  author_name TEXT,
  author_company TEXT,
  review_url TEXT,
  reviewed_at TIMESTAMPTZ,
  response_text TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform_slug, external_id)
);

CREATE INDEX IF NOT EXISTS idx_dashboard_reviews_platform_reviewed
  ON dashboard_reviews (platform_slug, reviewed_at DESC);

-- RLS: mirror the other dashboard_* tables — enable RLS with an
-- authenticated-read policy. The CEO dashboard reads via the service-role
-- client (bypasses RLS); writes are service-role only.
ALTER TABLE dashboard_review_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated can read review snapshots"
  ON dashboard_review_snapshots;
CREATE POLICY "authenticated can read review snapshots"
  ON dashboard_review_snapshots FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "authenticated can read reviews"
  ON dashboard_reviews;
CREATE POLICY "authenticated can read reviews"
  ON dashboard_reviews FOR SELECT
  TO authenticated
  USING (true);

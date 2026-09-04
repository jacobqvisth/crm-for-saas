-- Autopilot: publish N articles a day to wrenchlane.com on a fixed clock.
--
-- Deliberately separate from the Releases tab. A release article is triggered by
-- an external event (a broadcast going out) and is a faithful reformatting of
-- copy marketing already approved. Autopilot is the opposite: it is on a clock,
-- it chooses its own subject, and nobody reads the copy before it is public. So
-- it gets its own settings, its own run log, and its own marker tag on the site.
--
-- WHY SETTINGS LIVE IN THE DATABASE AND NOT IN vercel.json
-- The cadence is the thing most likely to be tuned ("make it 3 a day", "start at
-- 07:00", "weekdays only"). Encoding it in the cron expression would mean a
-- deploy per change and would split the truth across two places, since per_day
-- cannot be expressed in cron at all. So the cron fires hourly and asks this
-- table what it is allowed to do. The schedule is data.

CREATE TABLE IF NOT EXISTS article_autopilot_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Ships OFF. Nothing publishes itself until a human turns this on.
  enabled BOOLEAN NOT NULL DEFAULT FALSE,

  -- The cadence. Slots are start_hour, +interval_hours, ... per_day times, so
  -- the default is 08:00 / 10:00 / 12:00 / 14:00 / 16:00 local.
  per_day SMALLINT NOT NULL DEFAULT 5 CHECK (per_day BETWEEN 1 AND 12),
  interval_hours SMALLINT NOT NULL DEFAULT 2 CHECK (interval_hours BETWEEN 1 AND 12),
  start_hour SMALLINT NOT NULL DEFAULT 8 CHECK (start_hour BETWEEN 0 AND 23),
  -- Every other date range in this codebase is Stockholm-local; so is this.
  time_zone TEXT NOT NULL DEFAULT 'Europe/Stockholm',
  weekdays_only BOOLEAN NOT NULL DEFAULT FALSE,

  -- live  = create the CMS item and publish it, public within a minute
  -- stage = create it and stop, so a human presses the last button
  publish_mode TEXT NOT NULL DEFAULT 'live' CHECK (publish_mode IN ('live', 'stage')),

  -- Category names the classifier is allowed to pick from. Empty = all of them.
  -- Names, not Webflow ids, because the ids mean nothing to a human reading this
  -- row and the site's category list is small and stable.
  allowed_categories TEXT[] NOT NULL DEFAULT '{}',
  -- Tag names force-applied to every autopilot article, on top of whatever the
  -- classifier picks. This is how the marker tag gets on.
  extra_tags TEXT[] NOT NULL DEFAULT ARRAY['from-our-data'],

  -- One article in every N is a platform-stats story rather than a case study.
  -- There are only 13 stat angles and they go stale if repeated, so they are the
  -- garnish; real diagnostics are the main well.
  stats_every SMALLINT NOT NULL DEFAULT 7 CHECK (stats_every BETWEEN 0 AND 50),
  -- Days before the same stat angle may be told again.
  stats_cooldown_days SMALLINT NOT NULL DEFAULT 60,

  -- ArticleGenerationOptions overrides (angle, audience, voice, length, ...).
  -- Whatever is absent falls back to normalizeArticleOptions()'s defaults.
  options JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Stamped on every cron invocation, including the ones that decide to do
  -- nothing. Routine skips ("next slot at 14:00") are not worth a row each hour,
  -- but "is the schedule alive at all" still has to be answerable, and an empty
  -- run log cannot distinguish a quiet day from a cron that stopped firing.
  last_checked_at TIMESTAMPTZ,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Every attempt, including the ones that decided not to publish.
--
-- A silent cron that "does nothing" is indistinguishable from a broken one, and
-- that exact ambiguity is what made the Releases tab look healthy while it was
-- returning an empty list. So a skip is a logged outcome with a stated reason,
-- not an absence of rows.
CREATE TABLE IF NOT EXISTS article_autopilot_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- published | staged | skipped | failed
  status TEXT NOT NULL CHECK (status IN ('published', 'staged', 'skipped', 'failed')),
  -- Why, in words, always set. "Autopilot is off", "today's 5 are done",
  -- "no unused diagnostic rich enough to carry a story", a provider error.
  reason TEXT,
  -- 'cron' or 'manual', so a test run is never mistaken for the schedule working.
  trigger TEXT NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual')),

  article_id UUID REFERENCES articles(id) ON DELETE SET NULL,
  source_kind TEXT,
  source_ref TEXT,
  url TEXT,
  model TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_autopilot_runs_workspace
  ON article_autopilot_runs (workspace_id, ran_at DESC);
-- The scheduler's hot query: how many went out today.
CREATE INDEX IF NOT EXISTS idx_autopilot_runs_published
  ON article_autopilot_runs (workspace_id, status, ran_at DESC);

-- RLS: shared team resource, same call as `articles` itself. See
-- _archive/20260804170000_articles.sql for the reasoning.
ALTER TABLE article_autopilot_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_autopilot_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "any authenticated user can access autopilot settings"
  ON article_autopilot_settings;
CREATE POLICY "any authenticated user can access autopilot settings"
  ON article_autopilot_settings FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "any authenticated user can access autopilot runs"
  ON article_autopilot_runs;
CREATE POLICY "any authenticated user can access autopilot runs"
  ON article_autopilot_runs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_article_autopilot_settings_updated_at
  ON article_autopilot_settings;
CREATE TRIGGER update_article_autopilot_settings_updated_at
  BEFORE UPDATE ON article_autopilot_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed the shared Articles workspace so the settings tab has a row to edit.
--
-- The category list is seeded rather than left empty, because empty means "the
-- whole taxonomy" and that would let an unattended article file itself under
-- Product Updates (the Releases tab owns that) or Industry & Trends (which means
-- having an opinion about the market). Off by default plus a safe default scope
-- is the posture; turning it on should not also be the moment you discover where
-- it can post.
--
-- The workspace id is Wrenchlane's, and the categories are Wrenchlane's taxonomy
-- (Diagnostics, Repair Data, Shop Tips). Guarded by SELECT rather than written as a
-- literal VALUES row, because a bare INSERT of another tenant's workspace id fails the
-- foreign key on every OTHER tenant's database and takes the whole migration down with
-- it -- which is what it did on Animech, blocking five later migrations behind it.
--
-- A seed that belongs to one tenant must no-op on the others rather than error. On
-- Wrenchlane this SELECT returns the same single row the VALUES did; everywhere else it
-- returns none.
INSERT INTO article_autopilot_settings (workspace_id, allowed_categories)
SELECT
  w.id,
  ARRAY[
    'Diagnostics',
    'Troubleshooting',
    'Repair Data',
    'Electrical faults',
    'Shop Tips',
    'Predictive Maintenance',
    'Shop Operations'
  ]
FROM workspaces w
WHERE w.id = 'd946ea1f-74b4-492e-ae6a-d50f59ff04f0'
ON CONFLICT (workspace_id) DO NOTHING;

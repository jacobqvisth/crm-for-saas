-- When Autopilot was last switched on, so catch-up cannot back-fill a morning
-- that happened before the feature was running.
--
-- decideRun() compares published-today against slots-elapsed, which is what makes
-- a slot lost to an error get made up at the next hour. Switched on at 14:00 with
-- slots at 08/10/12/14/16, that same rule saw four slots elapsed and nothing
-- published and fired three times in three consecutive hours to "catch up" on
-- slots that were never missed, because the feature was off for all of them.
-- Observed on 2026-09-01, the day it was first enabled.
--
-- Nullable, and null means "no enable recorded", which reads as the old
-- behaviour. Every existing row gets stamped below so the fix takes effect for
-- the tenant that is already running.

ALTER TABLE article_autopilot_settings
  ADD COLUMN IF NOT EXISTS enabled_at TIMESTAMPTZ;

COMMENT ON COLUMN article_autopilot_settings.enabled_at IS
  'When `enabled` last went false->true. Slots earlier than this on the same local day are not counted as missed.';

-- Anything already switched on has been running for a while; stamping it now
-- would suppress a legitimate catch-up for the rest of today, and stamping it at
-- epoch would restore the bug. The start of the current UTC day is the honest
-- reading: it has been on since before today's first slot.
UPDATE article_autopilot_settings
SET enabled_at = date_trunc('day', NOW())
WHERE enabled IS TRUE AND enabled_at IS NULL;

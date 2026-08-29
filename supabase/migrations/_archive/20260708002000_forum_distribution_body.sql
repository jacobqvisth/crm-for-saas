-- Forums → Distribution: each recommendation now carries a ready-to-paste body,
-- not just a title. Previously a card only had suggested_title, so copying it
-- into Reddit produced a title with an empty body. The curated bodies live in
-- src/lib/forums/distribution.ts (DISTRIBUTION_SEED) and are seeded for new
-- workspaces; existing rows are backfilled per-subreddit in the same session.

ALTER TABLE forum_distribution
  ADD COLUMN IF NOT EXISTS suggested_body TEXT;

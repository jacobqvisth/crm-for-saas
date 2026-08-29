-- Allow manually adding videos to the Videos page from the UI.
--
-- `source` distinguishes seed-managed rows ('seed') from ones a user pasted in
-- ('manual'). The GET /api/videos reconcile only prunes 'seed' rows that have
-- left src/lib/videos/seed.ts — 'manual' rows are never auto-pruned, so a
-- pasted video sticks around until the user deletes it.

ALTER TABLE diagnostic_videos
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'seed';

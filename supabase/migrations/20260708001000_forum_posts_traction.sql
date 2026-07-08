-- Forums post generator (/forums): add traction tracking to generated posts,
-- matching the Distribution board. Once a generated post is marked posted with
-- a Reddit URL, we can pull its live upvotes/comments from Reddit's public JSON
-- (see src/lib/forums/reddit.ts) and show how it's doing.

ALTER TABLE forum_posts
  ADD COLUMN IF NOT EXISTS score INT,
  ADD COLUMN IF NOT EXISTS num_comments INT,
  ADD COLUMN IF NOT EXISTS upvote_ratio NUMERIC,
  ADD COLUMN IF NOT EXISTS traction_note TEXT,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

-- Bring "who posted this" tracking to diagnostic posts (forum_posts), matching
-- the topic-campaign side (forum_distribution). Lets the unified board record
-- which Reddit account actually posted a diagnostic post and flag when the
-- Reddit-reported author doesn't match the picked account (author mismatch).
alter table forum_posts
  add column if not exists posted_by_account_id uuid references reddit_accounts(id) on delete set null,
  add column if not exists posted_by_username text;

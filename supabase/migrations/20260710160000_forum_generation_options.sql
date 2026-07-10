-- Forum text generation options
-- ============================================================================
-- Every forum text generator (posts, replies to posts, replies to other
-- people's comments) already stored a `mention_level`. We now let the drafter
-- also pick length / voice / approach ("how should this draft be written").
-- Those three extra axes are stored together as a small JSONB blob so the set
-- can grow without another migration; mention_level stays its own column
-- (existing reads, filters, and the persona-ceiling logic depend on it).
--
-- Shape: {"mentionLevel":"none|subtle|explicit","length":"quick|balanced|thorough",
--         "voice":"owner|mechanic|neutral",
--         "approach":"direct|ask_questions|similar_experience|step_by_step"}
-- Nullable + default '{}' so pre-existing rows normalize to defaults on read.

alter table public.forum_posts
  add column if not exists generation_options jsonb not null default '{}'::jsonb;

alter table public.forum_replies
  add column if not exists generation_options jsonb not null default '{}'::jsonb;

alter table public.forum_thread_replies
  add column if not exists generation_options jsonb not null default '{}'::jsonb;

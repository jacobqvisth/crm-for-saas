-- Forums → per-post thread sub-page + reply-to-comments.
--
-- Our top-level distribution posts are now drawing real comment threads, so the
-- team needs to reply to OTHER people's comments (not just drop a top-level
-- comment). This adds:
--
--   1. Persona fields on reddit_accounts — so the "analyze thread" AI can assign
--      each reply to the teammate it fits and stay inside what that person may
--      say. Three orthogonal flags + a free-text background note:
--        turns_wrenches         — actually works on cars; can speak from the
--                                 bench, give hands-on diagnostic direction.
--        uses_ai_tools          — has used AI car-diagnosis apps; may drop a
--                                 natural "I ran it through an app" aside (= the
--                                 'subtle' mention level).
--        can_mention_wrenchlane — allowed to name Wrenchlane, sparingly (= the
--                                 'explicit' mention level). Most members: false.
--        persona_note           — anything else that shapes their voice.
--
--   2. forum_thread_replies — one row per (forum item × real Reddit comment we
--      want to reply to). Holds the comment we're replying to (author, excerpt,
--      permalink), why it's worth a reply, the drafted reply, which teammate it's
--      assigned to, the allowed mention level, and posting state. `source` +
--      `source_id` point at a forum_distribution rec (soft ref, no FK), matching
--      forum_comment_assignments.

-- ---- 1. Persona on the roster ---------------------------------------------

ALTER TABLE reddit_accounts
  ADD COLUMN IF NOT EXISTS turns_wrenches BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS uses_ai_tools BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS can_mention_wrenchlane BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS persona_note TEXT;

-- Backfill sensible personas for the founder accounts already seeded on prod
-- (new workspaces get these from ACCOUNT_SEED). Everyone else stays all-false
-- until set in the roster panel. Keyed on the known handles so it's a no-op on
-- workspaces that don't have them.
UPDATE reddit_accounts SET uses_ai_tools = TRUE, can_mention_wrenchlane = TRUE
  WHERE username IN ('Minimum-Ad7044', 'Emergency-Parsley964');
UPDATE reddit_accounts SET turns_wrenches = TRUE, uses_ai_tools = TRUE
  WHERE username = 'Minimum-Fig-2004';
UPDATE reddit_accounts SET uses_ai_tools = TRUE
  WHERE username = 'Franqer';

-- ---- 2. Thread reply drafts -----------------------------------------------

CREATE TABLE IF NOT EXISTS forum_thread_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Which board the parent item lives on (only 'distribution' is wired today).
  source TEXT NOT NULL CHECK (source IN ('distribution', 'post')),
  -- forum_distribution.id or forum_posts.id (soft ref, no FK).
  source_id UUID NOT NULL,
  -- The real Reddit comment we're replying to.
  reddit_comment_id TEXT NOT NULL,        -- base-36 id, no "t1_" prefix
  reddit_comment_url TEXT,                -- permalink to that comment
  comment_author TEXT,                    -- bare handle, no "u/"
  comment_excerpt TEXT,                   -- the comment's text (may be trimmed)
  comment_score INTEGER,                  -- its upvotes at analysis time
  -- Why the AI flagged this comment as worth a reply (shown in the UI).
  why TEXT,
  -- Rank within the thread (0 = highest priority).
  priority INTEGER NOT NULL DEFAULT 0,
  -- The teammate this reply is assigned to (persona-matched).
  assigned_owner_label TEXT,
  account_id UUID REFERENCES reddit_accounts(id) ON DELETE SET NULL,
  -- Mention level the AI chose, bounded by the assignee's persona flags.
  mention_level TEXT NOT NULL DEFAULT 'none'
    CHECK (mention_level IN ('none', 'subtle', 'explicit')),
  -- The drafted reply text, ready to copy-paste under that comment.
  reply_text TEXT,
  status TEXT NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'posted', 'skipped')),
  posted_url TEXT,
  posted_at TIMESTAMPTZ,
  confirmed_via TEXT CHECK (confirmed_via IN ('crm', 'reddit_detected')),
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One reply per comment per forum item (re-analysis upserts, preserving state).
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_thread_reply_comment
  ON forum_thread_replies (workspace_id, source, source_id, reddit_comment_id);

-- Sub-page lookup: all replies for one posted item, in priority order.
CREATE INDEX IF NOT EXISTS idx_forum_thread_replies_source
  ON forum_thread_replies (workspace_id, source, source_id);

-- RLS — mirror forum_comment_assignments: one FOR ALL policy gated on
-- workspace membership.
ALTER TABLE forum_thread_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workspace members can access forum_thread_replies"
  ON forum_thread_replies;
CREATE POLICY "workspace members can access forum_thread_replies"
  ON forum_thread_replies FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_forum_thread_replies_updated_at
  BEFORE UPDATE ON forum_thread_replies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

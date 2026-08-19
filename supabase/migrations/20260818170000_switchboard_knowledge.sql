-- Give the switchboard its own knowledge document.
--
-- Until now it shared workspace_ai_knowledge with the email AI, which is wrong in
-- both directions:
--
--   * that document is written for EMAIL. It carries tables of video and article
--     URLs, "put the URL on its own line in the draft", reply-length rules and a
--     subject-line rule. None of that survives being spoken down a phone, and it
--     spends prompt budget on things the receptionist cannot use, since the whole
--     document is injected on every turn.
--   * the reverse is worse: rewriting the shared document for the phone would
--     quietly degrade cold-email and reply drafting, which depend on those tables.
--
-- So the receptionist gets its own copy. When knowledge_md is NULL it still falls
-- back to the shared workspace knowledge, so nothing breaks before one is written.

ALTER TABLE switchboard_settings
  ADD COLUMN knowledge_md TEXT;

COMMENT ON COLUMN switchboard_settings.knowledge_md IS
  'Phone-specific product knowledge for the receptionist, injected whole on every turn. NULL = fall back to the shared workspace_ai_knowledge (written for email).';

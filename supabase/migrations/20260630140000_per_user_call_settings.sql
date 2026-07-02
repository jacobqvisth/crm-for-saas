-- Per-user calling configuration.
--
-- Until now the in-CRM dialer read a single workspace-level config
-- (workspaces.settings.calls.{agent_phone,caller_id,calling_enabled}), so the
-- "ring the agent's phone" number was shared: whoever saved it last won, and two
-- people could not each dial from their own phone. We move the per-agent dialer
-- config onto user_profiles so every member rings their OWN phone and shows
-- their OWN caller ID. The workspace-level settings.calls keys that drive
-- follow-up automation (auto_followup_enabled / sequence_by_outcome) stay where
-- they are — only the per-agent telephony identity moves here.
--
-- call_agent_phone  — the phone 46elks rings first for this user (E.164).
-- call_caller_id    — the caller ID shown to the contact when this user calls
--                     (E.164). NOTE: 46elks only displays a `from` number that
--                     is rented from 46elks or verified on the account; an
--                     unverified personal number is rejected at dial time. Falls
--                     back to CRM_CALL_FROM_NUMBER when blank.
-- call_enabled      — per-user master switch for click-to-call (default on).

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS call_agent_phone TEXT,
  ADD COLUMN IF NOT EXISTS call_caller_id   TEXT,
  ADD COLUMN IF NOT EXISTS call_enabled     BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN user_profiles.call_agent_phone IS
  'E.164 phone 46elks rings first for this user before bridging to the contact. Per-user; replaces the old shared workspaces.settings.calls.agent_phone.';
COMMENT ON COLUMN user_profiles.call_caller_id IS
  'E.164 caller ID shown to the contact when this user places a call. Must be rented/verified on the 46elks account or it is rejected. Blank falls back to CRM_CALL_FROM_NUMBER.';
COMMENT ON COLUMN user_profiles.call_enabled IS
  'Per-user master switch for in-CRM click-to-call. When false, this user''s Call buttons are disabled.';

-- Per-user inbound failover + voicemail config.
--
-- When a customer calls an agent's dedicated number and the agent doesn't
-- answer within call_ring_seconds, the inbound handler rings their
-- call_failover_user_id (another agent) next; if nobody answers and
-- call_voicemail_enabled is true, it takes a recorded voicemail (transcribed +
-- logged like any other call). All editable per-user in /settings/calls.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS call_failover_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS call_ring_seconds      INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS call_voicemail_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN user_profiles.call_failover_user_id IS
  'If this agent does not answer an inbound call to their dedicated number within call_ring_seconds, ring this user next. NULL = no failover.';
COMMENT ON COLUMN user_profiles.call_ring_seconds IS
  'Seconds to ring this agent before failover / voicemail (~5s per ring). Default 25.';
COMMENT ON COLUMN user_profiles.call_voicemail_enabled IS
  'When true, an unanswered inbound call (after failover) records a voicemail that is transcribed + logged.';

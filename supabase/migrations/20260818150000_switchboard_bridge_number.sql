-- Route the switchboard's AI leg through a 46elks WebSocket bridge instead of SIP.
--
-- Why: the 46elks -> ElevenLabs SIP path establishes signalling but carries zero
-- RTP (a 32 second call produced a 44 byte WAV, i.e. a header and no samples).
-- 46elks support pointed at their WebSocket product instead, and the formats line
-- up exactly: 46elks speaks pcm_16000 and the ElevenLabs Agents WebSocket uses
-- pcm_16000 in both directions, so there is no codec negotiation to fail.
--
-- The transfer mechanism is unchanged. The public number still answers with
-- {connect: <leg>, next: /api/switchboard/next}; only the leg differs. When the
-- bridge closes the AI leg, 46elks fires the same `next` action and the existing
-- hunt group rings a human.
--
-- Nullable on purpose: with bridge_number unset the switchboard keeps using the
-- SIP endpoint, so this can be rolled out and rolled back per workspace without
-- a deploy.

ALTER TABLE switchboard_settings
  -- A 46elks number of category "websocket" (+4600700…), whose websocket_url
  -- points at the switchboard-bridge edge function. These CAN be allocated over
  -- the 46elks API, unlike webrtc numbers.
  ADD COLUMN bridge_number TEXT;

COMMENT ON COLUMN switchboard_settings.bridge_number IS
  '46elks websocket number the AI leg is connected to. NULL = use the ElevenLabs SIP endpoint instead (which currently has no audio).';

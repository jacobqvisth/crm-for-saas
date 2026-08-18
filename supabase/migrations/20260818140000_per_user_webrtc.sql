-- Per-user "calls on this computer" (WebRTC).
--
-- Until now computer calling was a single shared endpoint pinned to one person
-- by the ELKS_WEBRTC_OWNER_USER_ID env var, so only that one agent ever saw the
-- "Calls on this computer" pill. That was not arbitrary: on 46elks a WebRTC
-- number IS its SIP account (username = the number without the +, password =
-- the number's `secret`), and one account holds one registration. Two browsers
-- on the same credentials would race for incoming legs.
--
-- The fix is one endpoint per person. These columns hold each user's own WebRTC
-- number and its secret; the resolver in src/lib/calls/webrtc.ts prefers them and
-- falls back to the shared env endpoint for the legacy owner, so nobody's working
-- setup changes until they are given their own number.
--
-- Note for whoever provisions these: 46elks does NOT allow allocating a webrtc
-- number over the API (403 "Cannot allocate webrtc numbers ... in country se",
-- on every capability combination tried). Their support has to create it.

ALTER TABLE user_profiles
  -- The user's own 46elks WebRTC number, E.164 (a +4600… virtual number; these
  -- are not dialable from the public phone network, which is fine because it is
  -- only ever rung by our own bridge).
  ADD COLUMN call_webrtc_number TEXT,
  -- The number's `secret` from the 46elks API, AES-256-GCM via
  -- src/lib/encryption.ts. It necessarily reaches the browser to register the SIP
  -- client, but it is never stored in plaintext at rest.
  ADD COLUMN call_webrtc_secret_encrypted TEXT;

COMMENT ON COLUMN user_profiles.call_webrtc_number IS
  'Per-user 46elks WebRTC number for browser calling. NULL = fall back to the shared ELKS_WEBRTC_* endpoint if this user is its configured owner.';

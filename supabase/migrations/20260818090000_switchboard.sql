-- Switchboard ("telefonväxel") — an inbound AI receptionist that answers the
-- published company number, handles what it can itself, and transfers to a
-- human when the caller asks for one.
--
-- How it differs from call_agent (outbound): the agent there DIALS contacts.
-- Here the customer dials US. The whole flow is one continuous 46elks call:
--
--   caller rings the växel number
--     → /api/switchboard/inbound returns {connect: sip:…elevenlabs, next: …}
--     → the receptionist agent answers and talks
--     → caller asks for a human → agent calls the forward tool (records the
--       target on switchboard_calls) then ends its own leg
--     → 46elks fires the chained `next` action → /api/switchboard/next returns
--       the hunt group from src/lib/calls/inbound-actions.ts (ring, failover,
--       voicemail)
--
-- The caller is never re-dialled and never hears a second ring, because the
-- transfer is a `next` action on the SAME call rather than a new one.
--
-- Three tables:
--   switchboard_settings — one row per workspace: on/off, the number, provider
--                          creds (encrypted), persona, hours, self-service scope
--   switchboard_targets  — who the receptionist may transfer to, and the words
--                          a caller might use to ask for them
--   switchboard_calls    — one row per inbound call: who called, what they
--                          wanted, who it went to, how it ended

CREATE TABLE switchboard_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,

  -- master switch. Off = the inbound webhook rejects, nothing answers.
  enabled BOOLEAN NOT NULL DEFAULT false,

  -- The published växel number (E.164, a 46elks mobile). Inbound only: it is
  -- never used as an outbound caller ID, so it stays a clean public identity.
  number TEXT,

  -- provider (ElevenLabs; kept provider-shaped for a swap, as in call_agent)
  provider TEXT NOT NULL DEFAULT 'elevenlabs',
  -- AES-256-GCM via src/lib/encryption.ts. Optional: the resolver falls back to
  -- ELEVENLABS_API_KEY, then to the workspace's call_agent_settings key, so the
  -- switchboard works without pasting the same key twice.
  provider_api_key_encrypted TEXT,
  provider_agent_id TEXT,
  provider_phone_number_id TEXT,
  provider_kb_doc_id TEXT,
  -- tool name → provider tool id, so a re-provision updates the existing tools
  -- instead of leaving orphaned duplicates behind.
  provider_tool_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- shared secret for our provider-facing webhooks (tools, initiation, post-call)
  webhook_secret TEXT,

  -- persona
  persona_name TEXT NOT NULL DEFAULT 'Mark',
  voice_id TEXT,
  greeting_note TEXT,
  languages_enabled TEXT[] NOT NULL DEFAULT '{sv,en}',

  -- How much the receptionist may do on its own before reaching for a human.
  -- answer_questions: may answer from the workspace knowledge base.
  -- take_messages:    may take a message instead of transferring.
  -- book_callbacks:   may promise a callback (creates a task).
  answer_questions BOOLEAN NOT NULL DEFAULT true,
  take_messages BOOLEAN NOT NULL DEFAULT true,
  book_callbacks BOOLEAN NOT NULL DEFAULT true,

  -- Office hours (Stockholm time, matching the rest of the CRM's ranges).
  -- Outside them nobody is rung: the receptionist takes a message instead.
  open_hour INT NOT NULL DEFAULT 9,
  close_hour INT NOT NULL DEFAULT 17,
  open_days INT[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- ISO weekday, 1 = Mon

  -- Transfer behaviour
  ring_seconds INT NOT NULL DEFAULT 25,
  voicemail_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Hard cap so a stuck conversation can never bill forever.
  max_call_seconds INT NOT NULL DEFAULT 600,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE switchboard_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can access switchboard_settings"
  ON switchboard_settings FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_switchboard_settings_updated_at
  BEFORE UPDATE ON switchboard_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- Who the receptionist may put a caller through to.
--
-- `label` is what the receptionist matches the caller's words against ("Hans",
-- "Jacob", "sales"); `aliases` catches the other ways people ask for the same
-- person (surname, role, common mishearings). The phone rung defaults to the
-- user's own user_profiles.call_agent_phone so there is one place to change it.
CREATE TABLE switchboard_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID,                                   -- CRM user whose phone is rung
  label TEXT NOT NULL,                            -- primary name spoken to callers
  aliases TEXT[] NOT NULL DEFAULT '{}',
  -- Optional override; NULL = use user_profiles.call_agent_phone.
  phone TEXT,
  -- Rung when this target does not answer (NULL = straight to voicemail).
  failover_target_id UUID REFERENCES switchboard_targets(id) ON DELETE SET NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, label)
);

CREATE INDEX idx_switchboard_targets_workspace
  ON switchboard_targets (workspace_id, sort_order);

ALTER TABLE switchboard_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can access switchboard_targets"
  ON switchboard_targets FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_switchboard_targets_updated_at
  BEFORE UPDATE ON switchboard_targets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- One row per inbound call to the växel.
--
-- elks_call_id is the correlation key: 46elks sends it on the inbound webhook,
-- on the chained `next` request, and on hangup, so every stage finds this row.
CREATE TABLE switchboard_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- 46elks call id for the caller's leg (unique per call).
  elks_call_id TEXT NOT NULL,
  -- The shared call_sessions row, so växel calls appear in normal call reporting.
  call_session_id UUID REFERENCES call_sessions(id) ON DELETE SET NULL,

  caller_number TEXT,
  dialed_number TEXT,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN (
    'ringing',      -- webhook hit, about to connect to the receptionist
    'with_agent',   -- the receptionist is talking to the caller
    'forwarding',   -- a human was requested; the next action will ring them
    'connected',    -- a human picked up
    'voicemail',    -- nobody answered, recording a message
    'ended',
    'failed'
  )),

  -- How the call finished. Set when we know; drives the reporting on the page.
  outcome TEXT CHECK (outcome IS NULL OR outcome IN (
    'handled_by_agent',   -- the receptionist answered it, no human needed
    'forwarded',          -- put through to a human who answered
    'no_answer',          -- human requested but nobody picked up
    'voicemail',          -- left a recorded message
    'message_taken',      -- the receptionist wrote down a message
    'callback_booked',
    'abandoned',          -- caller hung up first
    'rejected'            -- switchboard off / outside scope
  )),

  -- What the caller asked for, and where it went.
  requested_label TEXT,
  target_id UUID REFERENCES switchboard_targets(id) ON DELETE SET NULL,
  target_user_id UUID,
  target_phone TEXT,

  -- Provider conversation + what was said.
  provider_conversation_id TEXT,
  transcript JSONB,
  summary TEXT,
  -- Free-text message the receptionist took, mirrored to the contact timeline.
  message_body TEXT,
  caller_name TEXT,                               -- as given on the call

  answered_at TIMESTAMPTZ,
  forwarded_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The correlation key must be unique so the `next` + hangup webhooks can look a
-- call up with .single() and never match two rows.
CREATE UNIQUE INDEX idx_switchboard_calls_elks_id ON switchboard_calls (elks_call_id);
CREATE INDEX idx_switchboard_calls_workspace ON switchboard_calls (workspace_id, created_at DESC);
CREATE INDEX idx_switchboard_calls_contact ON switchboard_calls (contact_id, created_at DESC);
-- Used to resolve "the call currently talking to the receptionist" when the
-- provider's tool call carries no 46elks id.
CREATE INDEX idx_switchboard_calls_live
  ON switchboard_calls (workspace_id, created_at DESC)
  WHERE status IN ('ringing', 'with_agent');

ALTER TABLE switchboard_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can access switchboard_calls"
  ON switchboard_calls FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_switchboard_calls_updated_at
  BEFORE UPDATE ON switchboard_calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- Switchboard calls share call_sessions with human + outbound-agent calls, so
-- they show up in the existing call lists, stats and timeline logging.
ALTER TABLE call_sessions
  DROP CONSTRAINT IF EXISTS call_sessions_initiated_by_check;

ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_initiated_by_check
    CHECK (initiated_by IN ('human', 'agent', 'switchboard'));

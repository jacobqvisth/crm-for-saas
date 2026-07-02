-- In-CRM calling pipeline (46elks bridge → recording → Deepgram → Claude).
--
-- A call_sessions row is the rich record of a single placed call: telephony
-- metadata, the recording, the transcript, and the AI summary + suggested
-- follow-ups. It is created the moment we place the call (status='dialing'),
-- updated by the 46elks hangup webhook (recording + duration), then enriched
-- by the AI processing route (transcript + summary + suggestions).
--
-- The existing `activities` row (type='call') stays the timeline source of
-- truth — call_sessions links to it via activity_id once the AI has run and
-- logCall() has recorded the outcome. call_feedback / tasks / enrollment all
-- continue to hang off that activity exactly as for a manually-logged call.
--
-- Forward-compat note (in-call smartness, a later phase): `transcript` holds
-- an ordered utterance array and `live_tips` is reserved for real-time
-- coaching produced by a streaming path — neither is populated in the batch
-- (post-call) pipeline shipped here.

CREATE TABLE call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- who / what this call is about
  contact_id UUID REFERENCES contacts(id)  ON DELETE SET NULL,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  user_id    UUID,                              -- the agent who placed the call
  list_id    UUID,                              -- optional source call list (attribution)

  -- telephony
  provider         TEXT NOT NULL DEFAULT '46elks',
  provider_call_id TEXT,                        -- 46elks call id ("callid")
  direction        TEXT NOT NULL DEFAULT 'outbound'
                     CHECK (direction IN ('outbound', 'inbound')),
  from_number      TEXT,                         -- caller ID shown to the contact
  agent_number     TEXT,                         -- the phone 46elks bridged to (agent's)
  to_number        TEXT,                         -- the contact's number we dialed

  -- lifecycle
  status TEXT NOT NULL DEFAULT 'dialing' CHECK (status IN (
    'dialing', 'in_progress', 'completed', 'processing',
    'processed', 'failed', 'no_recording'
  )),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  connected_at     TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,
  error            TEXT,

  -- recording + AI artifacts
  recording_url          TEXT,
  recording_storage_path TEXT,                  -- reserved: mirror to Supabase Storage
  transcript             JSONB,                 -- [{speaker,text,start_ms,end_ms}]
  summary                TEXT,                  -- prose key-takeaways summary
  ai_json                JSONB,                 -- structured suggestions (see route)
  ai_model               TEXT,
  ai_processed_at        TIMESTAMPTZ,
  live_tips              JSONB,                 -- reserved for in-call coaching (later phase)

  -- the logged call activity this session produced (created after AI runs)
  activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook lookups are by provider_call_id; keep it unique when present.
CREATE UNIQUE INDEX call_sessions_provider_call_id_idx
  ON call_sessions (provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE INDEX call_sessions_workspace_status_idx
  ON call_sessions (workspace_id, status);
CREATE INDEX call_sessions_contact_idx ON call_sessions (contact_id);
CREATE INDEX call_sessions_company_idx ON call_sessions (company_id);
CREATE INDEX call_sessions_activity_idx ON call_sessions (activity_id);

-- RLS — workspace-scoped read/write (mirrors call_feedback / tasks).
-- The hangup webhook + AI processing run with the service-role key and bypass
-- RLS; interactive reads from the app are gated here.
ALTER TABLE call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can access call_sessions"
  ON call_sessions FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_call_sessions_updated_at
  BEFORE UPDATE ON call_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

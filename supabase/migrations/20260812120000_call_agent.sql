-- AI voice call agent (autonomous outbound calls via a conversational-AI
-- provider bridged over 46elks).
--
-- Three pieces:
--   call_agent_settings  — one row per workspace: on/off, provider creds
--                          (encrypted), persona, guardrails, pacing.
--   call_agent_jobs      — the dial queue. A cron claims queued rows, runs the
--                          safety rails, places the 46elks call that bridges
--                          the contact into the provider's SIP endpoint, and
--                          records the outcome. Modeled on phone_enrichment_jobs.
--   call_sessions        — extended (not forked): agent calls live beside
--                          human calls with initiated_by='agent'.

CREATE TABLE call_agent_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,

  -- master switch + rollout mode
  enabled BOOLEAN NOT NULL DEFAULT false,
  mode TEXT NOT NULL DEFAULT 'approve_each' CHECK (mode IN ('approve_each', 'autonomous')),

  -- provider (ElevenLabs first; interface kept provider-shaped for a swap)
  provider TEXT NOT NULL DEFAULT 'elevenlabs',
  -- API key pasted in the UI, AES-256-GCM via src/lib/encryption.ts.
  provider_api_key_encrypted TEXT,
  -- provider-side agent ids per language ("sv" / "en" → agent id)
  provider_agent_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- provider-side knowledge-base doc id (re-synced from workspace_ai_knowledge)
  provider_kb_doc_id TEXT,
  -- shared secret for our inbound webhooks (initiation + post-call)
  webhook_secret TEXT,

  -- persona
  persona_name TEXT NOT NULL DEFAULT 'Elsa',
  voice_ids JSONB NOT NULL DEFAULT '{}'::jsonb,   -- language → provider voice id
  greeting_note TEXT,                             -- extra instruction appended to the prompt

  -- guardrails / pacing
  daily_cap INT NOT NULL DEFAULT 10,
  max_attempts_per_contact INT NOT NULL DEFAULT 2,
  min_days_between_calls INT NOT NULL DEFAULT 30,
  call_start_hour INT NOT NULL DEFAULT 9,
  call_end_hour INT NOT NULL DEFAULT 16,
  call_days INT[] NOT NULL DEFAULT '{1,2,3,4,5}', -- ISO weekday, 1=Mon
  languages_enabled TEXT[] NOT NULL DEFAULT '{sv,en}',
  callback_owner_user_id UUID,                    -- gets "wants a human" tasks

  -- daily budget counter (reset by date comparison, mirrors workspace_ai_settings)
  daily_call_count INT NOT NULL DEFAULT 0,
  daily_call_date DATE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE call_agent_settings ENABLE ROW LEVEL SECURITY;

-- Members can read + toggle settings, but the encrypted key column is only
-- written through the API route (service role bypasses RLS anyway; the
-- anon/user path never selects the encrypted column — see the API route).
CREATE POLICY "workspace members can access call_agent_settings"
  ON call_agent_settings FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_call_agent_settings_updated_at
  BEFORE UPDATE ON call_agent_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


CREATE TABLE call_agent_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  list_id UUID,                                   -- source list (attribution)
  campaign_key TEXT,                              -- playbook key or free label
  objective TEXT,                                 -- what the agent should achieve

  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    -- pending_approval → queued (approve_each mode inserts as pending_approval)
    'pending_approval', 'queued', 'processing', 'calling',
    'done', 'failed', 'skipped', 'dismissed'
  )),
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  skip_reason TEXT,                               -- why the rails refused to dial
  error TEXT,

  call_session_id UUID REFERENCES call_sessions(id) ON DELETE SET NULL,
  provider_conversation_id TEXT,

  enqueued_by UUID,                               -- user who queued/approved
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_call_agent_jobs_claim
  ON call_agent_jobs (status, scheduled_for)
  WHERE status IN ('queued', 'processing');
CREATE INDEX idx_call_agent_jobs_workspace ON call_agent_jobs (workspace_id, created_at DESC);
CREATE INDEX idx_call_agent_jobs_contact ON call_agent_jobs (contact_id, created_at DESC);

ALTER TABLE call_agent_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can access call_agent_jobs"
  ON call_agent_jobs FOR ALL
  USING (workspace_id IN (SELECT get_user_workspace_ids()));

CREATE TRIGGER update_call_agent_jobs_updated_at
  BEFORE UPDATE ON call_agent_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- Agent calls share call_sessions with human calls.
ALTER TABLE call_sessions
  ADD COLUMN initiated_by TEXT NOT NULL DEFAULT 'human'
    CHECK (initiated_by IN ('human', 'agent')),
  ADD COLUMN agent_job_id UUID REFERENCES call_agent_jobs(id) ON DELETE SET NULL,
  ADD COLUMN provider_conversation_id TEXT;

CREATE INDEX idx_call_sessions_provider_conversation
  ON call_sessions (provider_conversation_id)
  WHERE provider_conversation_id IS NOT NULL;

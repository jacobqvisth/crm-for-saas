import "server-only";

// Thin ElevenLabs Agents Platform (ConvAI) client. Only the endpoints the
// call agent needs; all provisioning happens from the CRM so the ElevenLabs
// dashboard is never required.
//
// Docs: https://elevenlabs.io/docs/api-reference (agents, knowledge-base,
// phone-numbers, conversations, sip-trunk outbound).

const BASE = "https://api.elevenlabs.io";

interface ElevenLabsError {
  status: number;
  body: string;
}

async function el<T>(
  apiKey: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "xi-api-key": apiKey,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "(unreadable)");
    const err: ElevenLabsError = { status: resp.status, body: text.slice(0, 500) };
    throw new Error(`ElevenLabs ${method} ${path} failed (${err.status}): ${err.body}`);
  }
  // DELETE endpoints may return empty bodies.
  const text = await resp.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------------------------------------------------------------------------
// Agents

export interface AgentConfigInput {
  name: string;
  prompt: string;
  firstMessage: string;
  language: string; // default agent language ("sv")
  voiceId: string;
  llm?: string;
  kbDocId?: string | null;
  kbDocName?: string;
  dynamicVariableDefaults: Record<string, string>;
  maxDurationSeconds?: number;
}

function agentPayload(input: AgentConfigInput) {
  return {
    name: input.name,
    conversation_config: {
      agent: {
        first_message: input.firstMessage,
        language: input.language,
        dynamic_variables: {
          dynamic_variable_placeholders: input.dynamicVariableDefaults,
        },
        prompt: {
          prompt: input.prompt,
          ...(input.llm ? { llm: input.llm } : {}),
          temperature: 0.3,
          ...(input.kbDocId
            ? {
                knowledge_base: [
                  {
                    type: "text",
                    name: input.kbDocName ?? "Wrenchlane knowledge",
                    id: input.kbDocId,
                    // "prompt" = always injected. Our knowledge doc is small
                    // (~a few KB) so skipping the RAG-index requirement keeps
                    // provisioning a single idempotent call.
                    usage_mode: "prompt",
                  },
                ],
              }
            : {}),
        },
      },
      tts: {
        voice_id: input.voiceId,
        // Multilingual low-latency model: one agent handles sv + en with a
        // per-call language override instead of one agent per language.
        model_id: "eleven_flash_v2_5",
      },
      conversation: {
        max_duration_seconds: input.maxDurationSeconds ?? 600,
      },
    },
    platform_settings: {
      overrides: {
        conversation_config_override: {
          agent: { first_message: true, language: true },
          tts: { voice_id: true },
        },
        // Without this the workspace-level initiation webhook is never called
        // for inbound (SIP) calls and the agent runs on placeholder defaults.
        enable_conversation_initiation_client_data_from_webhook: true,
      },
    },
  };
}

export async function createAgent(apiKey: string, input: AgentConfigInput): Promise<string> {
  const resp = await el<{ agent_id: string }>(
    apiKey,
    "POST",
    "/v1/convai/agents/create",
    agentPayload(input),
  );
  return resp.agent_id;
}

export async function updateAgent(
  apiKey: string,
  agentId: string,
  input: AgentConfigInput,
): Promise<void> {
  await el(apiKey, "PATCH", `/v1/convai/agents/${agentId}`, agentPayload(input));
}

export async function getAgent(apiKey: string, agentId: string): Promise<unknown | null> {
  try {
    return await el(apiKey, "GET", `/v1/convai/agents/${agentId}`);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Knowledge base

export async function createKnowledgeDoc(
  apiKey: string,
  name: string,
  text: string,
): Promise<string> {
  const resp = await el<{ id: string }>(apiKey, "POST", "/v1/convai/knowledge-base/text", {
    name,
    text,
  });
  return resp.id;
}

export async function deleteKnowledgeDoc(apiKey: string, docId: string): Promise<void> {
  try {
    await el(apiKey, "DELETE", `/v1/convai/knowledge-base/${docId}?force=true`);
  } catch {
    // Already gone / attached elsewhere: not fatal for a re-sync.
  }
}

// ---------------------------------------------------------------------------
// Voices

export interface ProviderVoice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
  verified_languages?: unknown[];
  preview_url?: string;
}

export async function listVoices(apiKey: string): Promise<ProviderVoice[]> {
  const resp = await el<{ voices: ProviderVoice[] }>(
    apiKey,
    "GET",
    "/v2/voices?page_size=100",
  );
  return resp.voices ?? [];
}

// ---------------------------------------------------------------------------
// Phone numbers (SIP trunk) — lets external carriers (46elks) reach the agent
// at sip:{phone_number}@sip.rtc.elevenlabs.io.

export async function importSipPhoneNumber(
  apiKey: string,
  phoneNumber: string,
  label: string,
  agentId: string,
): Promise<string> {
  const resp = await el<{ phone_number_id: string }>(apiKey, "POST", "/v1/convai/phone-numbers", {
    provider: "sip_trunk",
    phone_number: phoneNumber,
    label,
    agent_id: agentId,
    inbound_trunk_config: {
      // 46elks source addresses are not published; allow any source and rely
      // on the number itself being unguessable routing. Tightened later if
      // 46elks documents egress IPs.
      media_encryption: "allowed",
    },
  });
  return resp.phone_number_id;
}

export async function listPhoneNumbers(
  apiKey: string,
): Promise<Array<{ phone_number_id?: string; phone_number: string; agent_id?: string }>> {
  try {
    const resp = await el<Array<{ phone_number_id?: string; phone_number: string; agent_id?: string }>>(
      apiKey,
      "GET",
      "/v1/convai/phone-numbers",
    );
    return Array.isArray(resp) ? resp : [];
  } catch {
    return [];
  }
}

export async function assignPhoneNumberAgent(
  apiKey: string,
  phoneNumberId: string,
  agentId: string,
): Promise<void> {
  await el(apiKey, "PATCH", `/v1/convai/phone-numbers/${phoneNumberId}`, { agent_id: agentId });
}

// ---------------------------------------------------------------------------
// Workspace settings — per-call personalization webhook (inbound calls ask
// our server for dynamic variables before the agent speaks).

export async function setInitiationWebhook(
  apiKey: string,
  url: string,
  authHeaderValue: string,
): Promise<void> {
  await el(apiKey, "PATCH", "/v1/convai/settings", {
    conversation_initiation_client_data_webhook: {
      url,
      request_headers: { "x-callagent-token": authHeaderValue },
    },
  });
}

// ---------------------------------------------------------------------------
// Conversations (results)

export interface ProviderTranscriptTurn {
  role: "agent" | "user";
  message: string | null;
  time_in_call_secs?: number;
}

export interface ProviderConversation {
  conversation_id: string;
  agent_id?: string;
  status: string; // initiated | in-progress | processing | done | failed
  transcript?: ProviderTranscriptTurn[];
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
    phone_call?: Record<string, unknown>;
  };
  analysis?: {
    call_successful?: string;
    transcript_summary?: string;
    evaluation_criteria_results?: Record<string, unknown>;
    data_collection_results?: Record<string, unknown>;
  };
}

export async function getConversation(
  apiKey: string,
  conversationId: string,
): Promise<ProviderConversation> {
  return el(apiKey, "GET", `/v1/convai/conversations/${conversationId}`);
}

export async function listConversations(
  apiKey: string,
  params: { agentId?: string; startAfterUnix?: number },
): Promise<Array<Pick<ProviderConversation, "conversation_id" | "status"> & { start_time_unix_secs?: number; call_duration_secs?: number }>> {
  const q = new URLSearchParams({ page_size: "30" });
  if (params.agentId) q.set("agent_id", params.agentId);
  if (params.startAfterUnix) q.set("call_start_after_unix", String(params.startAfterUnix));
  const resp = await el<{ conversations: Array<Pick<ProviderConversation, "conversation_id" | "status"> & { start_time_unix_secs?: number; call_duration_secs?: number }> }>(
    apiKey,
    "GET",
    `/v1/convai/conversations?${q.toString()}`,
  );
  return resp.conversations ?? [];
}

// ---------------------------------------------------------------------------
// Outbound via ElevenLabs SIP trunk (alternative dial path; requires an
// outbound_trunk_config on the imported number). Unused by the default
// 46elks-originated path but kept so the dial path is switchable.

export async function sipOutboundCall(
  apiKey: string,
  params: {
    agentId: string;
    agentPhoneNumberId: string;
    toNumber: string;
    dynamicVariables: Record<string, string>;
    firstMessageOverride?: string;
    languageOverride?: string;
  },
): Promise<{ conversation_id: string | null }> {
  const resp = await el<{ success: boolean; conversation_id: string | null }>(
    apiKey,
    "POST",
    "/v1/convai/sip-trunk/outbound-call",
    {
      agent_id: params.agentId,
      agent_phone_number_id: params.agentPhoneNumberId,
      to_number: params.toNumber,
      conversation_initiation_client_data: {
        dynamic_variables: params.dynamicVariables,
        ...(params.firstMessageOverride || params.languageOverride
          ? {
              conversation_config_override: {
                agent: {
                  ...(params.firstMessageOverride
                    ? { first_message: params.firstMessageOverride }
                    : {}),
                  ...(params.languageOverride ? { language: params.languageOverride } : {}),
                },
              },
            }
          : {}),
      },
    },
  );
  return { conversation_id: resp.conversation_id ?? null };
}

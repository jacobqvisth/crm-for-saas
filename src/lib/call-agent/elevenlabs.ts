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
  /** Ids of webhook tools (created via createWebhookTool) the agent may call. */
  toolIds?: string[];
  /** Built-in provider tools, e.g. "end_call", "language_detection". */
  systemTools?: string[];
  /** Per-language greeting overrides, used with the language_detection tool so
   *  one agent greets a Swedish caller in Swedish and an English one in English. */
  languagePresets?: Record<string, { firstMessage: string }>;
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
          // Webhook tools are created as standalone objects and referenced by
          // id. System tools are NOT tools in that sense: the API refuses them
          // in the tools collection ("use built_in_tools instead") and also
          // refuses `tools` and `tool_ids` together, so each kind has exactly
          // one home. built_in_tools is a name-keyed map where null = disabled.
          ...(input.toolIds?.length ? { tool_ids: input.toolIds } : {}),
          ...(input.systemTools?.length
            ? {
                built_in_tools: Object.fromEntries(
                  input.systemTools.map((name) => [
                    name,
                    { name, description: "", type: "system", params: { system_tool_type: name } },
                  ]),
                ),
              }
            : {}),
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
      // Per-language overrides. The language_detection system tool switches
      // between them mid-call when the caller speaks another language.
      ...(input.languagePresets && Object.keys(input.languagePresets).length
        ? {
            language_presets: Object.fromEntries(
              Object.entries(input.languagePresets).map(([lang, preset]) => [
                lang,
                { overrides: { agent: { first_message: preset.firstMessage } } },
              ]),
            ),
          }
        : {}),
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
// Webhook tools
//
// A "server tool" the agent can call mid-conversation. Created as a standalone
// object, then attached to an agent by id (prompt.tool_ids). We authenticate by
// putting the workspace webhook secret in a header, so the endpoint can reject
// anything that is not the provider.

export interface WebhookToolParam {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required?: boolean;
}

export interface WebhookToolInput {
  name: string;
  description: string;
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  /** Fields the model fills in and we receive as a JSON body. */
  bodyParams?: WebhookToolParam[];
}

function toolPayload(input: WebhookToolInput) {
  const props: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  for (const p of input.bodyParams ?? []) {
    props[p.name] = { type: p.type, description: p.description };
    if (p.required) required.push(p.name);
  }
  return {
    tool_config: {
      type: "webhook" as const,
      name: input.name,
      description: input.description,
      response_timeout_secs: 10,
      api_schema: {
        url: input.url,
        method: input.method,
        ...(input.headers ? { request_headers: input.headers } : {}),
        ...(input.bodyParams?.length
          ? {
              request_body_schema: {
                type: "object",
                properties: props,
                required,
                description: `Arguments for ${input.name}`,
              },
            }
          : {}),
      },
    },
  };
}

export async function createWebhookTool(
  apiKey: string,
  input: WebhookToolInput,
): Promise<string> {
  const resp = await el<{ id?: string; tool_id?: string }>(
    apiKey,
    "POST",
    "/v1/convai/tools",
    toolPayload(input),
  );
  const id = resp.id ?? resp.tool_id;
  if (!id) throw new Error(`tool create returned no id for ${input.name}`);
  return id;
}

export async function updateWebhookTool(
  apiKey: string,
  toolId: string,
  input: WebhookToolInput,
): Promise<void> {
  await el(apiKey, "PATCH", `/v1/convai/tools/${toolId}`, toolPayload(input));
}

export async function deleteTool(apiKey: string, toolId: string): Promise<void> {
  try {
    await el(apiKey, "DELETE", `/v1/convai/tools/${toolId}`);
  } catch {
    // Already gone, or still attached: not fatal for a re-sync.
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

/**
 * Copy a voice from the public shared library into this workspace so it can be
 * used as an agent voice. Idempotent in practice: if the workspace already has
 * a voice with this name we return the existing id instead of adding a second.
 */
export async function addSharedVoice(
  apiKey: string,
  params: { publicOwnerId: string; voiceId: string; name: string },
): Promise<string> {
  const existing = await listVoices(apiKey).catch(() => [] as ProviderVoice[]);
  const already = existing.find((v) => v.name === params.name);
  if (already) return already.voice_id;

  const resp = await el<{ voice_id: string }>(
    apiKey,
    "POST",
    `/v1/voices/add/${params.publicOwnerId}/${params.voiceId}`,
    { new_name: params.name },
  );
  return resp.voice_id;
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
      allowed_addresses: ["0.0.0.0/0"],
      // "disabled" because 46elks sends plain RTP: with "required" the SIP leg
      // is refused before a conversation is even created (measured 2026-08-18).
      // "allowed" also works at the signalling layer.
      //
      // NOTE this does NOT fix the outstanding audio problem. SIP signalling to
      // ElevenLabs connects fine (the agent runs, the caller's number arrives,
      // the initiation webhook fires, tools work) but RTP never flows in either
      // direction: the agent hears silence and the caller hears nothing, while
      // 46elks reports the leg "failed" with no duration even as ElevenLabs logs
      // a 30s+ "successful" conversation. Reproduced identically on the outbound
      // caller-ID number since 2026-08-13, so it is the 46elks<->ElevenLabs
      // media path, not this config. Ruled out: all three encryption values,
      // `callerid` on the connect, an explicit :5060 port, and `recordcall`.
      // This is the "SIP bridge audio validation" the Call Agent plan flagged as
      // unproven, whose documented fallback is a Twilio trunk.
      media_encryption: "disabled",
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

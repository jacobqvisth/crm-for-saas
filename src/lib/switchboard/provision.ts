import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { loadWrenchlaneKnowledge } from "@/lib/inbox/load-knowledge";
import {
  addSharedVoice,
  assignPhoneNumberAgent,
  createAgent,
  createKnowledgeDoc,
  createWebhookTool,
  deleteKnowledgeDoc,
  getAgent,
  importSipPhoneNumber,
  listPhoneNumbers,
  setInitiationWebhook,
  updateAgent,
  updateWebhookTool,
  type AgentConfigInput,
  type WebhookToolInput,
} from "@/lib/call-agent/elevenlabs";
import { listElksNumbers, setElksNumberVoiceStart } from "@/lib/calls/elks";
import { normalizePhone } from "@/lib/calls/phone";
import { buildGreeting, buildSwitchboardPrompt, SWITCHBOARD_VARIABLE_DEFAULTS } from "./prompt";
import {
  ensureWebhookSecret,
  loadTargets,
  switchboardApiKey,
  type SwitchboardRow,
} from "./settings";
import {
  DEFAULT_SWITCHBOARD_VOICE,
  SWITCHBOARD_SPEECH_SPEED,
  SWITCHBOARD_TURN_TIMEOUT,
} from "./types";

type Client = SupabaseClient<Database>;

export interface ProvisionResult {
  ok: boolean;
  steps: Array<{ step: string; ok: boolean; detail?: string }>;
  agentId?: string;
}

/** The tools the receptionist can call mid-conversation. */
function toolDefinitions(appUrl: string, secret: string): WebhookToolInput[] {
  const headers = { "x-switchboard-token": secret };
  return [
    {
      name: "transfer_call",
      description:
        "Put the caller through to a named person. Call this the moment the caller asks for " +
        "someone by name or asks for a human. After it returns, tell the caller you are " +
        "connecting them and then end the call so the transfer happens.",
      url: `${appUrl}/api/switchboard/tools/transfer`,
      method: "POST",
      headers,
      bodyParams: [
        {
          name: "person",
          type: "string",
          description: "The name of the person the caller asked for, exactly as they said it.",
          required: true,
        },
        {
          name: "reason",
          type: "string",
          description: "One short sentence on what the call is about, for the person picking up.",
        },
        {
          name: "caller_name",
          type: "string",
          description: "The caller's name, if they gave it.",
        },
      ],
    },
    {
      name: "take_message",
      description:
        "Write down a message when nobody is available, the office is closed, or the caller " +
        "prefers not to wait. Confirm the phone number with the caller before calling this.",
      url: `${appUrl}/api/switchboard/tools/message`,
      method: "POST",
      headers,
      bodyParams: [
        {
          name: "caller_name",
          type: "string",
          description: "The caller's name.",
          required: true,
        },
        {
          name: "callback_number",
          type: "string",
          description: "The number to call back, as the caller said it.",
          required: true,
        },
        {
          name: "message",
          type: "string",
          description: "What the message is about, in the caller's own words where possible.",
          required: true,
        },
        {
          name: "for_person",
          type: "string",
          description: "Who the message is for, if the caller named someone.",
        },
        {
          name: "callback_window",
          type: "string",
          description: "When the caller asked to be called back, if they said.",
        },
      ],
    },
  ];
}

/**
 * Idempotently provision the switchboard:
 *   1. knowledge-base doc from workspace_ai_knowledge (so the receptionist can
 *      answer product questions itself)
 *   2. a Swedish male voice copied out of the shared library, once
 *   3. the transfer_call + take_message webhook tools
 *   4. the receptionist agent (created once, updated on every re-provision)
 *   5. the SIP phone-number object for the växel number, linked to the agent
 *   6. the 46elks number's inbound action pointed at /api/switchboard/inbound
 *   7. the conversation-initiation webhook, so the agent knows who is calling
 *
 * Safe to run repeatedly: this is the "Provision / Sync" button's handler.
 */
export async function provisionSwitchboard(
  supabase: Client,
  row: SwitchboardRow,
  appUrl: string,
): Promise<ProvisionResult> {
  const steps: ProvisionResult["steps"] = [];
  const apiKey = await switchboardApiKey(supabase, row);
  if (!apiKey) {
    return { ok: false, steps: [{ step: "api_key", ok: false, detail: "no API key configured" }] };
  }

  const number = normalizePhone(row.number);
  if (!number) {
    return {
      ok: false,
      steps: [{ step: "number", ok: false, detail: "no switchboard number set" }],
    };
  }

  const secret = await ensureWebhookSecret(supabase, row);
  const updates: Record<string, Json | string | null> = {};

  // 1) Knowledge base -------------------------------------------------------
  let kbDocId = row.provider_kb_doc_id;
  try {
    const { contentMd } = await loadWrenchlaneKnowledge(supabase, row.workspace_id);
    const newDocId = await createKnowledgeDoc(
      apiKey,
      `Wrenchlane reception knowledge ${new Date().toISOString().slice(0, 10)}`,
      contentMd,
    );
    if (kbDocId && kbDocId !== newDocId) await deleteKnowledgeDoc(apiKey, kbDocId);
    kbDocId = newDocId;
    updates.provider_kb_doc_id = newDocId;
    steps.push({ step: "knowledge_base", ok: true });
  } catch (err) {
    steps.push({
      step: "knowledge_base",
      ok: false,
      detail: err instanceof Error ? err.message : "failed",
    });
  }

  // 2) Voice ----------------------------------------------------------------
  let voiceId = row.voice_id;
  if (!voiceId) {
    try {
      voiceId = await addSharedVoice(apiKey, {
        publicOwnerId: DEFAULT_SWITCHBOARD_VOICE.publicOwnerId,
        voiceId: DEFAULT_SWITCHBOARD_VOICE.sharedVoiceId,
        name: DEFAULT_SWITCHBOARD_VOICE.name,
      });
      updates.voice_id = voiceId;
      steps.push({ step: "voice", ok: true, detail: DEFAULT_SWITCHBOARD_VOICE.name });
    } catch (err) {
      steps.push({
        step: "voice",
        ok: false,
        detail: err instanceof Error ? err.message : "failed",
      });
    }
  }

  // 3) Tools ----------------------------------------------------------------
  // Tool ids are stored so a re-provision updates in place instead of leaving
  // orphaned duplicates on the provider side.
  const existingToolIds = ((row.provider_tool_ids ?? {}) as Record<string, string>) ?? {};
  const toolIds: string[] = [];
  const toolIdMap: Record<string, string> = {};
  for (const def of toolDefinitions(appUrl, secret)) {
    try {
      const existing = existingToolIds[def.name];
      if (existing) {
        await updateWebhookTool(apiKey, existing, def);
        toolIds.push(existing);
        toolIdMap[def.name] = existing;
      } else {
        const id = await createWebhookTool(apiKey, def);
        toolIds.push(id);
        toolIdMap[def.name] = id;
      }
      steps.push({ step: `tool:${def.name}`, ok: true });
    } catch (err) {
      steps.push({
        step: `tool:${def.name}`,
        ok: false,
        detail: err instanceof Error ? err.message : "failed",
      });
    }
  }
  updates.provider_tool_ids = toolIdMap as unknown as Json;

  // 4) Agent ----------------------------------------------------------------
  const targets = await loadTargets(supabase, row.workspace_id);
  const primaryLanguage = row.languages_enabled.includes("sv") ? "sv" : "en";

  const input: AgentConfigInput = {
    name: `Wrenchlane Reception (${row.persona_name})`,
    prompt: buildSwitchboardPrompt({
      personaName: row.persona_name,
      targetLabels: targets.filter((t) => t.enabled).map((t) => t.label),
      answerQuestions: row.answer_questions,
      takeMessages: row.take_messages,
      bookCallbacks: row.book_callbacks,
      greetingNote: row.greeting_note,
    }),
    firstMessage: buildGreeting(row.persona_name, primaryLanguage),
    language: primaryLanguage,
    voiceId: voiceId ?? DEFAULT_SWITCHBOARD_VOICE.sharedVoiceId,
    kbDocId,
    kbDocName: "Wrenchlane reception knowledge",
    dynamicVariableDefaults: SWITCHBOARD_VARIABLE_DEFAULTS,
    maxDurationSeconds: row.max_call_seconds,
    speed: SWITCHBOARD_SPEECH_SPEED,
    turnTimeoutSeconds: SWITCHBOARD_TURN_TIMEOUT,
    toolIds,
    // end_call is what makes the transfer work: it ends the agent's leg so
    // 46elks moves on to the chained `next` action. language_detection lets one
    // agent take Swedish and English callers.
    systemTools: ["end_call", "language_detection"],
    languagePresets: Object.fromEntries(
      row.languages_enabled.map((lang) => [
        lang,
        { firstMessage: buildGreeting(row.persona_name, lang) },
      ]),
    ),
  };

  let agentId = row.provider_agent_id;
  try {
    if (agentId && (await getAgent(apiKey, agentId))) {
      await updateAgent(apiKey, agentId, input);
      steps.push({ step: "agent_update", ok: true });
    } else {
      agentId = await createAgent(apiKey, input);
      updates.provider_agent_id = agentId;
      steps.push({ step: "agent_create", ok: true, detail: agentId });
    }
  } catch (err) {
    steps.push({
      step: "agent",
      ok: false,
      detail: err instanceof Error ? err.message : "failed",
    });
  }

  // 5) SIP phone number ------------------------------------------------------
  if (agentId) {
    try {
      const existing = await listPhoneNumbers(apiKey);
      const match = existing.find((p) => p.phone_number === number);
      if (match?.phone_number_id) {
        const phoneNumberId = match.phone_number_id;
        await assignPhoneNumberAgent(apiKey, phoneNumberId, agentId);
        updates.provider_phone_number_id = phoneNumberId;
        steps.push({ step: "sip_number_assign", ok: true });
      } else {
        const id = await importSipPhoneNumber(
          apiKey,
          number,
          `Wrenchlane switchboard (${number})`,
          agentId,
        );
        updates.provider_phone_number_id = id;
        steps.push({ step: "sip_number_import", ok: true, detail: id });
      }
    } catch (err) {
      steps.push({
        step: "sip_number",
        ok: false,
        detail: err instanceof Error ? err.message : "failed",
      });
    }
  }

  // 6) Point the 46elks number at our inbound handler ------------------------
  try {
    const elksNumbers = await listElksNumbers();
    const target = elksNumbers.find((n) => normalizePhone(n.number) === number);
    if (!target?.id) {
      steps.push({
        step: "elks_inbound",
        ok: false,
        detail: `${number} is not allocated on the 46elks account`,
      });
    } else {
      const inboundUrl = `${appUrl}/api/switchboard/inbound?token=${encodeURIComponent(secret)}`;
      await setElksNumberVoiceStart(target.id, inboundUrl, "Wrenchlane switchboard");
      steps.push({ step: "elks_inbound", ok: true });
    }
  } catch (err) {
    steps.push({
      step: "elks_inbound",
      ok: false,
      detail: err instanceof Error ? err.message : "failed",
    });
  }

  // 7) Conversation-initiation webhook --------------------------------------
  // Workspace-level and single on the provider side, and the outbound call agent
  // already owns it. So we register the SAME url the call agent uses and let
  // that route dispatch on agent_id. Re-registering identical values is a no-op,
  // and if the call agent was never provisioned we register with our own secret.
  try {
    const { data: callAgent } = await supabase
      .from("call_agent_settings")
      .select("webhook_secret")
      .eq("workspace_id", row.workspace_id)
      .maybeSingle();
    const token = callAgent?.webhook_secret || secret;
    await setInitiationWebhook(apiKey, `${appUrl}/api/call-agent/initiation`, token);
    steps.push({ step: "initiation_webhook", ok: true });
  } catch (err) {
    steps.push({
      step: "initiation_webhook",
      ok: false,
      detail: err instanceof Error ? err.message : "failed",
    });
  }

  if (Object.keys(updates).length) {
    await supabase.from("switchboard_settings").update(updates).eq("workspace_id", row.workspace_id);
  }

  return {
    ok: steps.every((s) => s.ok),
    steps,
    agentId: agentId ?? undefined,
  };
}

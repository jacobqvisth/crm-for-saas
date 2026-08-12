import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables } from "@/lib/database.types";
import { loadWrenchlaneKnowledge } from "@/lib/inbox/load-knowledge";
import {
  createAgent,
  createKnowledgeDoc,
  deleteKnowledgeDoc,
  getAgent,
  importSipPhoneNumber,
  listPhoneNumbers,
  assignPhoneNumberAgent,
  setInitiationWebhook,
  updateAgent,
  type AgentConfigInput,
} from "./elevenlabs";
import { buildAgentPrompt, buildFirstMessage, DYNAMIC_VARIABLE_DEFAULTS } from "./prompt";
import { ensureWebhookSecret, providerApiKey } from "./settings";

type Client = SupabaseClient<Database>;
type SettingsRow = Tables<"call_agent_settings">;

// A calm, natural multilingual ElevenLabs voice as the out-of-the-box default;
// replaceable from the settings UI (voice picker).
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

export interface ProvisionResult {
  ok: boolean;
  steps: Array<{ step: string; ok: boolean; detail?: string }>;
  agentId?: string;
}

/**
 * Idempotently provision everything on the ElevenLabs side from the CRM:
 *   1. knowledge-base doc from workspace_ai_knowledge (recreated on re-sync)
 *   2. the conversational agent (created once, updated on every re-provision)
 *   3. the SIP phone-number object for the workspace caller ID + agent link
 *   4. the workspace-level conversation-initiation webhook (per-call briefs)
 *
 * Safe to run repeatedly — this is the "Provision / Sync" button's handler.
 */
export async function provisionCallAgent(
  supabase: Client,
  row: SettingsRow,
  appUrl: string,
): Promise<ProvisionResult> {
  const steps: ProvisionResult["steps"] = [];
  const apiKey = providerApiKey(row);
  if (!apiKey) {
    return { ok: false, steps: [{ step: "api_key", ok: false, detail: "no API key configured" }] };
  }

  const secret = await ensureWebhookSecret(supabase, row);
  const updates: Record<string, Json | string | null> = {};

  // 1) Knowledge base -------------------------------------------------------
  let kbDocId = row.provider_kb_doc_id;
  try {
    const { contentMd } = await loadWrenchlaneKnowledge(supabase, row.workspace_id);
    const newDocId = await createKnowledgeDoc(
      apiKey,
      `Wrenchlane knowledge ${new Date().toISOString().slice(0, 10)}`,
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

  // 2) Agent ----------------------------------------------------------------
  const agentIds = (row.provider_agent_ids ?? {}) as Record<string, string>;
  const voiceIds = (row.voice_ids ?? {}) as Record<string, string>;
  const input: AgentConfigInput = {
    name: `Wrenchlane Call Agent (${row.persona_name})`,
    prompt: buildAgentPrompt({
      personaName: row.persona_name,
      knowledgeMd: "See the attached knowledge document.",
      greetingNote: row.greeting_note,
    }),
    firstMessage: buildFirstMessage(row.persona_name),
    language: row.languages_enabled.includes("sv") ? "sv" : "en",
    voiceId: voiceIds.default ?? DEFAULT_VOICE_ID,
    kbDocId,
    kbDocName: "Wrenchlane knowledge",
    dynamicVariableDefaults: DYNAMIC_VARIABLE_DEFAULTS,
  };

  let agentId = agentIds.default ?? null;
  try {
    if (agentId && (await getAgent(apiKey, agentId))) {
      await updateAgent(apiKey, agentId, input);
      steps.push({ step: "agent_update", ok: true });
    } else {
      agentId = await createAgent(apiKey, input);
      steps.push({ step: "agent_create", ok: true });
    }
    updates.provider_agent_ids = { ...agentIds, default: agentId } as unknown as Json;
  } catch (err) {
    steps.push({
      step: "agent",
      ok: false,
      detail: err instanceof Error ? err.message : "failed",
    });
    if (Object.keys(updates).length > 0) {
      await supabase.from("call_agent_settings").update(updates).eq("workspace_id", row.workspace_id);
    }
    return { ok: false, steps };
  }

  // 3) SIP phone number for the caller ID ------------------------------------
  const callerId = process.env.CRM_CALL_FROM_NUMBER;
  if (callerId && agentId) {
    try {
      const numbers = await listPhoneNumbers(apiKey);
      const existing = numbers.find((n) => n.phone_number === callerId);
      if (existing?.phone_number_id) {
        if (existing.agent_id !== agentId) {
          await assignPhoneNumberAgent(apiKey, existing.phone_number_id, agentId);
        }
        steps.push({ step: "sip_number", ok: true, detail: "already imported" });
      } else {
        await importSipPhoneNumber(apiKey, callerId, "Wrenchlane CRM (46elks)", agentId);
        steps.push({ step: "sip_number", ok: true, detail: "imported" });
      }
    } catch (err) {
      steps.push({
        step: "sip_number",
        ok: false,
        detail: err instanceof Error ? err.message : "failed",
      });
    }
  } else {
    steps.push({ step: "sip_number", ok: false, detail: "CRM_CALL_FROM_NUMBER not set" });
  }

  // 4) Per-call personalization webhook --------------------------------------
  try {
    await setInitiationWebhook(
      apiKey,
      `${appUrl}/api/call-agent/initiation?token=${secret}`,
      secret,
    );
    steps.push({ step: "initiation_webhook", ok: true });
  } catch (err) {
    steps.push({
      step: "initiation_webhook",
      ok: false,
      detail: err instanceof Error ? err.message : "failed",
    });
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from("call_agent_settings").update(updates).eq("workspace_id", row.workspace_id);
    Object.assign(row, updates);
  }

  return { ok: steps.every((s) => s.ok || s.step === "sip_number"), steps, agentId: agentId ?? undefined };
}

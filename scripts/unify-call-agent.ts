/**
 * One-off: unify the two voice agents into ONE — Mark takes outbound too.
 *
 * What it does (idempotent, safe to re-run):
 *   1. Reads the switchboard's provider_agent_id (Mark) for the workspace.
 *   2. PATCHes that ElevenLabs agent so per-call overrides may carry a system
 *      prompt (the outbound persona is injected per conversation by
 *      /api/call-agent/initiation), alongside the already-allowed
 *      first_message/language/voice overrides. Also renames the agent to
 *      reflect its double duty.
 *   3. Points call_agent_settings.provider_agent_ids.default at Mark and sets
 *      persona_name to the switchboard persona, so outbound calls are placed
 *      as Mark. Elsa's old agent is left in place at the provider, unused.
 *
 * Run:
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/unify-call-agent.ts
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const WORKSPACE_ID = "d946ea1f-74b4-492e-ae6a-d50f59ff04f0"; // "My Workspace"
const ELEVENLABS_API = "https://api.elevenlabs.io";

function service() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function el(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");
  const resp = await fetch(`${ELEVENLABS_API}${path}`, {
    method,
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!resp.ok) {
    throw new Error(`${method} ${path} -> ${resp.status}: ${await resp.text()}`);
  }
  return (await resp.json()) as Record<string, unknown>;
}

async function main() {
  const supabase = service();

  const { data: switchboard } = await supabase
    .from("switchboard_settings")
    .select("provider_agent_id, persona_name")
    .eq("workspace_id", WORKSPACE_ID)
    .maybeSingle();
  if (!switchboard?.provider_agent_id) {
    throw new Error("switchboard has no provider_agent_id — provision the switchboard first");
  }
  const markId = switchboard.provider_agent_id;
  const persona = switchboard.persona_name ?? "Mark";
  console.log(`switchboard agent: ${markId} (persona ${persona})`);

  const { data: callAgent } = await supabase
    .from("call_agent_settings")
    .select("provider_agent_ids, persona_name")
    .eq("workspace_id", WORKSPACE_ID)
    .maybeSingle();
  console.log("call agent before:", callAgent);

  // ---- 1. Allow the per-call prompt override on Mark ----------------------
  const agent = (await el("GET", `/v1/convai/agents/${markId}`)) as {
    name?: string;
    platform_settings?: { overrides?: Record<string, unknown> };
  };
  const overrides = agent.platform_settings?.overrides ?? {};
  const cco = (overrides as { conversation_config_override?: Record<string, unknown> })
    .conversation_config_override ?? {};
  const agentOverrides = (cco.agent as Record<string, unknown>) ?? {};

  await el("PATCH", `/v1/convai/agents/${markId}`, {
    name: "Wrenchlane Voice Agent (Mark)",
    platform_settings: {
      overrides: {
        ...overrides,
        conversation_config_override: {
          ...cco,
          agent: {
            ...agentOverrides,
            first_message: true,
            language: true,
            prompt: { prompt: true },
          },
          tts: { ...((cco.tts as Record<string, unknown>) ?? {}), voice_id: true },
        },
        enable_conversation_initiation_client_data_from_webhook: true,
      },
    },
  });
  console.log(`agent ${markId}: prompt override enabled, renamed from "${agent.name}"`);

  // ---- 2. Point outbound at Mark -------------------------------------------
  const ids = ((callAgent?.provider_agent_ids ?? {}) as Record<string, string>) ?? {};
  const previous = ids.default ?? null;
  const { error } = await supabase
    .from("call_agent_settings")
    .update({
      provider_agent_ids: { ...ids, default: markId, ...(previous && previous !== markId ? { retired_elsa: previous } : {}) },
      persona_name: persona,
    })
    .eq("workspace_id", WORKSPACE_ID);
  if (error) throw new Error(`call_agent_settings update failed: ${error.message}`);
  console.log(
    previous && previous !== markId
      ? `outbound re-pointed: ${previous} -> ${markId} (old id kept under provider_agent_ids.retired_elsa)`
      : `outbound already points at ${markId}`,
  );

  console.log("done. Outbound calls now run as", persona);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

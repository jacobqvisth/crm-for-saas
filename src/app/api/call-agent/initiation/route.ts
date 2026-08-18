import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildCallBrief } from "@/lib/call-agent/brief";
import { buildLocalizedFirstMessage } from "@/lib/call-agent/prompt";
import { DYNAMIC_VARIABLE_DEFAULTS } from "@/lib/call-agent/prompt";
import { buildSwitchboardVariables, matchCaller } from "@/lib/switchboard/brief";
import { buildGreeting, SWITCHBOARD_VARIABLE_DEFAULTS } from "@/lib/switchboard/prompt";
import { loadTargets } from "@/lib/switchboard/settings";

export const dynamic = "force-dynamic";

/**
 * POST /api/call-agent/initiation — ElevenLabs' conversation-initiation webhook.
 *
 * Serves BOTH voice agents, because the provider allows only one such webhook
 * per workspace:
 *   • the outbound call agent (Elsa) — answered with the per-contact call brief
 *   • the inbound switchboard (Mark) — answered with who is calling, who is
 *     reachable right now, and whether the office is open
 *
 * Dispatch is on `agent_id` from the request body rather than on the secret,
 * since the single registered URL carries a single token.
 *
 * PUBLIC route: authenticated by the shared secret (?token=, or the
 * x-callagent-token header configured at provisioning).
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const headerToken = request.headers.get("x-callagent-token");
  const service = createServiceClient();

  const provided = token || headerToken;
  if (!provided) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    agent_id?: string;
    caller_id?: string;
    called_number?: string;
  };

  // The secret identifies the workspace. Accept either agent's secret so the
  // switchboard still authenticates in a workspace with no outbound agent.
  const { data: settings } = await service
    .from("call_agent_settings")
    .select("*")
    .eq("webhook_secret", provided)
    .maybeSingle();

  const { data: switchboard } = await service
    .from("switchboard_settings")
    .select("*")
    .eq("webhook_secret", provided)
    .maybeSingle();

  const workspaceId = settings?.workspace_id ?? switchboard?.workspace_id;
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ---- Switchboard (inbound) --------------------------------------------
  // Resolve the switchboard for this workspace even when we authenticated with
  // the call agent's secret, then match on the agent id in the payload.
  const { data: wsSwitchboard } =
    switchboard && switchboard.workspace_id === workspaceId
      ? { data: switchboard }
      : await service
          .from("switchboard_settings")
          .select("*")
          .eq("workspace_id", workspaceId)
          .maybeSingle();

  if (
    wsSwitchboard?.provider_agent_id &&
    body.agent_id &&
    body.agent_id === wsSwitchboard.provider_agent_id
  ) {
    const caller = await matchCaller(service, workspaceId, body.caller_id ?? null);
    const targets = await loadTargets(service, workspaceId);
    const variables = buildSwitchboardVariables({ row: wsSwitchboard, caller, targets });
    const language = wsSwitchboard.languages_enabled.includes("sv") ? "sv" : "en";

    return NextResponse.json({
      type: "conversation_initiation_client_data",
      dynamic_variables: { ...SWITCHBOARD_VARIABLE_DEFAULTS, ...variables },
      conversation_config_override: {
        agent: {
          language,
          first_message: buildGreeting(wsSwitchboard.persona_name, language),
        },
      },
    });
  }

  // ---- Outbound call agent ------------------------------------------------
  if (!settings) {
    return NextResponse.json({
      type: "conversation_initiation_client_data",
      dynamic_variables: { ...DYNAMIC_VARIABLE_DEFAULTS },
    });
  }

  const defaults = {
    type: "conversation_initiation_client_data",
    dynamic_variables: { ...DYNAMIC_VARIABLE_DEFAULTS },
  };

  // Most recent agent session that is waiting for its call to land.
  const threeMinAgo = new Date(Date.now() - 3 * 60_000).toISOString();
  const { data: sessions } = await service
    .from("call_sessions")
    .select("id, contact_id, agent_job_id, started_at")
    .eq("workspace_id", settings.workspace_id)
    .eq("initiated_by", "agent")
    .in("status", ["dialing", "in_progress"])
    .gte("started_at", threeMinAgo)
    .order("started_at", { ascending: false })
    .limit(1);
  const session = sessions?.[0];
  if (!session?.contact_id) return NextResponse.json(defaults);

  const { data: job } = session.agent_job_id
    ? await service
        .from("call_agent_jobs")
        .select("objective")
        .eq("id", session.agent_job_id)
        .maybeSingle()
    : { data: null };

  const brief = await buildCallBrief(service, session.contact_id, {
    languagesEnabled: settings.languages_enabled,
    objective: job?.objective ?? null,
  });
  if ("error" in brief) return NextResponse.json(defaults);

  return NextResponse.json({
    type: "conversation_initiation_client_data",
    dynamic_variables: brief.variables,
    conversation_config_override: {
      agent: {
        language: brief.language,
        first_message: buildLocalizedFirstMessage(settings.persona_name, brief.language),
      },
    },
  });
}

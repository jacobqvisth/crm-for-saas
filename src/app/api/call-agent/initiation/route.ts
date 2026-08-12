import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildCallBrief } from "@/lib/call-agent/brief";
import { buildLocalizedFirstMessage } from "@/lib/call-agent/prompt";
import { DYNAMIC_VARIABLE_DEFAULTS } from "@/lib/call-agent/prompt";

export const dynamic = "force-dynamic";

/**
 * POST /api/call-agent/initiation — ElevenLabs' conversation-initiation
 * webhook. Fires when a bridged call lands at the agent; we answer with the
 * per-call brief (dynamic variables) + language/greeting overrides.
 *
 * PUBLIC route: authenticated by the shared secret (?token=, also sent as a
 * request header configured at provisioning). Correlation: the active job in
 * 'calling' whose session matches — with a single-call concurrency cap the
 * most recent calling session inside 3 minutes is unambiguous.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const headerToken = request.headers.get("x-callagent-token");
  const service = createServiceClient();

  // The secret is per-workspace; look it up by matching any settings row.
  const provided = token || headerToken;
  if (!provided) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: settings } = await service
    .from("call_agent_settings")
    .select("*")
    .eq("webhook_secret", provided)
    .maybeSingle();
  if (!settings) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

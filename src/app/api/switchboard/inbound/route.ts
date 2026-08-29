import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizePhone } from "@/lib/calls/phone";
import { matchCaller } from "@/lib/switchboard/brief";
import { buildAgentLegPayload } from "@/lib/switchboard/routing";
import type { TablesInsert } from "@/lib/database.types";
import { appBaseUrl } from "@/lib/app-url";

// POST /api/switchboard/inbound — the växel's front door.
//
// 46elks requests this as the number's `voice_start` when someone calls in. We
// answer with an action that connects the caller to the AI receptionist over SIP
// and chains a `next` URL, so when the receptionist ends its own leg the call
// continues to whoever the caller asked for. See src/lib/switchboard/routing.ts.
//
// PUBLIC route: 46elks sends no auth headers, so the configured URL carries
// ?token=<switchboard webhook_secret>, verified here.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function pick(form: FormData, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = form.get(k);
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ hangup: "reject" });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({}); // let 46elks play its default
  }

  const callId = pick(form, "callid", "id");
  const callerRaw = pick(form, "from");
  const dialedRaw = pick(form, "to");
  if (!callId || !dialedRaw) return NextResponse.json({});

  const service = createServiceClient();
  const dialed = normalizePhone(dialedRaw) || dialedRaw;

  const { data: settings } = await service
    .from("switchboard_settings")
    .select("*")
    .eq("webhook_secret", token)
    .maybeSingle();
  if (!settings) return NextResponse.json({ hangup: "reject" });

  // The token proves which workspace, but the number must match too, so one
  // workspace's secret can never answer for another workspace's number.
  if (normalizePhone(settings.number) !== dialed) {
    return NextResponse.json({ hangup: "reject" });
  }

  // Switched off: reject rather than answering and going silent, so the caller
  // gets a normal unobtainable tone instead of dead air.
  if (!settings.enabled) return NextResponse.json({ hangup: "reject" });

  const secret = settings.webhook_secret ?? token;
  const base = appBaseUrl();
  // Recording + hangup reuse the shared call webhook: it correlates on
  // provider_call_id, which we set below, and already runs transcription, the AI
  // summary and timeline logging for every call in the CRM. It also closes out
  // the switchboard_calls row. No switchboard-specific copy of that pipeline.
  const recordHookUrl = `${base}/api/calls/webhook/hangup?token=${encodeURIComponent(
    process.env.CALL_WEBHOOK_SECRET ?? "",
  )}`;
  const nextUrl = `${base}/api/switchboard/next?token=${encodeURIComponent(secret)}`;

  const callerNumber = normalizePhone(callerRaw);
  const caller = await matchCaller(service, settings.workspace_id, callerNumber);

  // Record the call so the tool endpoints, the `next` handler and the hangup
  // webhook can all find it by the 46elks call id.
  const session: TablesInsert<"call_sessions"> = {
    workspace_id: settings.workspace_id,
    contact_id: caller.contactId,
    company_id: caller.companyId,
    user_id: null,
    provider: "46elks",
    provider_call_id: callId,
    direction: "inbound",
    from_number: callerNumber ?? callerRaw,
    to_number: dialed,
    status: "in_progress",
    initiated_by: "switchboard",
  };
  const { data: sessionRow } = await service
    .from("call_sessions")
    .insert(session)
    .select("id")
    .single();

  await service.from("switchboard_calls").upsert(
    {
      workspace_id: settings.workspace_id,
      elks_call_id: callId,
      call_session_id: sessionRow?.id ?? null,
      caller_number: callerNumber ?? callerRaw,
      dialed_number: dialed,
      contact_id: caller.contactId,
      company_id: caller.companyId,
      status: "with_agent",
      answered_at: new Date().toISOString(),
    },
    { onConflict: "elks_call_id" },
  );

  return NextResponse.json(
    buildAgentLegPayload({
      switchboardNumber: dialed,
      nextUrl,
      recordHookUrl,
      bridgeNumber: normalizePhone(settings.bridge_number),
    }),
  );
}

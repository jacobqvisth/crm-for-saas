import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isWithinOfficeHours } from "@/lib/switchboard/types";
import { loadTargets } from "@/lib/switchboard/settings";
import { appBaseUrl } from "@/lib/app-url";
import {
  buildTransferAction,
  buildVoicemailAction,
  resolveFailover,
} from "@/lib/switchboard/routing";

// POST /api/switchboard/next — the transfer step.
//
// 46elks requests this when the AI receptionist's leg ends (it hangs up via the
// end_call tool). Whatever we return continues the SAME call, so the caller is
// put through without being re-dialled.
//
// Three outcomes:
//   • the receptionist asked for a transfer and the target is reachable → ring
//     them, fall back to their failover, then voicemail
//   • a human was wanted but none is reachable → voicemail
//   • the receptionist simply finished the call → empty response ends it
//
// PUBLIC route, authenticated by ?token= like the inbound webhook.
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
  if (!token) return NextResponse.json({});

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({});
  }

  const callId = pick(form, "callid", "id");
  if (!callId) return NextResponse.json({});

  const service = createServiceClient();

  const { data: settings } = await service
    .from("switchboard_settings")
    .select("*")
    .eq("webhook_secret", token)
    .maybeSingle();
  if (!settings) return NextResponse.json({});

  const { data: call } = await service
    .from("switchboard_calls")
    .select("*")
    .eq("elks_call_id", callId)
    .maybeSingle();

  // Same shared hangup webhook as the first leg: see the note in the inbound route.
  const recordHookUrl = `${appBaseUrl()}/api/calls/webhook/hangup?token=${encodeURIComponent(
    process.env.CALL_WEBHOOK_SECRET ?? "",
  )}`;

  // No transfer was requested: the receptionist handled the call itself and hung
  // up. An empty action ends the call cleanly.
  if (!call || call.status !== "forwarding" || !call.target_id) {
    if (call && call.status !== "forwarding") {
      await service
        .from("switchboard_calls")
        .update({
          status: "ended",
          outcome: call.outcome ?? "handled_by_agent",
          ended_at: new Date().toISOString(),
        })
        .eq("id", call.id);
    }
    return NextResponse.json({});
  }

  const targets = await loadTargets(service, settings.workspace_id);
  const target = targets.find((t) => t.id === call.target_id) ?? null;
  const open = isWithinOfficeHours(new Date(), settings);

  // Requested someone we cannot ring (phone unset, calling switched off, or the
  // office is closed): fall back to voicemail rather than silence.
  if (!target?.phone || !open) {
    if (settings.voicemail_enabled) {
      await service
        .from("switchboard_calls")
        .update({ status: "voicemail" })
        .eq("id", call.id);
      return NextResponse.json(buildVoicemailAction(recordHookUrl));
    }
    await service
      .from("switchboard_calls")
      .update({ status: "ended", outcome: "no_answer", ended_at: new Date().toISOString() })
      .eq("id", call.id);
    return NextResponse.json({});
  }

  const action = buildTransferAction({
    target,
    failover: resolveFailover(target, targets),
    ringSeconds: settings.ring_seconds,
    voicemailEnabled: settings.voicemail_enabled,
    recordHookUrl,
  });
  if (!action) return NextResponse.json({});

  await service
    .from("switchboard_calls")
    .update({
      status: "connected",
      target_phone: target.phone,
      forwarded_at: new Date().toISOString(),
    })
    .eq("id", call.id);

  return NextResponse.json(action);
}

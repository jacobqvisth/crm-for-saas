import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { loadTargets } from "@/lib/switchboard/settings";
import { findLiveCall, settingsForToken } from "@/lib/switchboard/live-call";
import { isWithinOfficeHours, matchTarget } from "@/lib/switchboard/types";
import { notifySlack } from "@/lib/switchboard/notify";

// POST /api/switchboard/tools/transfer — the receptionist's transfer_call tool.
//
// This does NOT move the call. It records WHO the caller asked for, then the
// receptionist ends its own leg and 46elks asks /api/switchboard/next what to do
// next, which is where the actual ringing happens. Splitting it this way means
// the transfer survives even if the model says something unexpected afterwards.
//
// The response text is spoken guidance for the model, so it must be short and
// unambiguous: it decides what the caller hears next.
export const dynamic = "force-dynamic";
export const maxDuration = 20;

interface Body {
  person?: string;
  reason?: string;
  caller_name?: string;
}

export async function POST(request: NextRequest) {
  const token =
    request.headers.get("x-switchboard-token") || request.nextUrl.searchParams.get("token");
  const service = createServiceClient();

  const settings = await settingsForToken(service, token);
  if (!settings) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const requested = (body.person ?? "").trim();

  const call = await findLiveCall(service, settings.workspace_id);
  if (!call) {
    return NextResponse.json({
      success: false,
      message: "No active call to transfer. Continue helping the caller yourself.",
    });
  }

  const targets = await loadTargets(service, settings.workspace_id);
  const target = matchTarget(requested, targets);

  if (!target) {
    const options = targets.filter((t) => t.enabled).map((t) => t.label);
    return NextResponse.json({
      success: false,
      message: options.length
        ? `There is nobody here called "${requested}". Tell the caller that name does not work ` +
          `here, and offer these people instead: ${options.join(", ")}.`
        : `There is nobody available to transfer to. Offer to take a message instead.`,
    });
  }

  if (!target.phone) {
    return NextResponse.json({
      success: false,
      message:
        `${target.label} has no phone number set up, so the call cannot be put through. ` +
        `Tell the caller ${target.label} is not reachable right now and offer to take a message.`,
    });
  }

  if (!isWithinOfficeHours(new Date(), settings)) {
    return NextResponse.json({
      success: false,
      message:
        `The office is closed, so nobody will pick up. Do not say you are transferring. ` +
        `Tell the caller the team is not in right now and offer to take a message instead.`,
    });
  }

  await service
    .from("switchboard_calls")
    .update({
      status: "forwarding",
      requested_label: requested || target.label,
      target_id: target.id,
      target_user_id: target.user_id,
      target_phone: target.phone,
      caller_name: body.caller_name?.trim() || call.caller_name,
      summary: body.reason?.trim() || call.summary,
    })
    .eq("id", call.id);

  // Screen pop: tell the human who is calling and why BEFORE their phone rings.
  // This is the warm hand-off. 46elks cannot whisper an announcement into a SIP
  // transfer, but a notification carrying real CRM context beats a whisper.
  await notifySlack({
    targetLabel: target.label,
    callerName: body.caller_name?.trim() || call.caller_name,
    callerNumber: call.caller_number,
    reason: body.reason?.trim() ?? null,
    contactId: call.contact_id,
    companyId: call.company_id,
    supabase: service,
    workspaceId: settings.workspace_id,
  });

  return NextResponse.json({
    success: true,
    message:
      `${target.label} is being called now. Tell the caller you are putting them through to ` +
      `${target.label}, then end the call immediately with the end_call tool so the transfer ` +
      `can happen. Do not say goodbye.`,
  });
}

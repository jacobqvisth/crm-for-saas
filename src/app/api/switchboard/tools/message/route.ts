import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizePhone } from "@/lib/calls/phone";
import { loadTargets } from "@/lib/switchboard/settings";
import { findLiveCall, settingsForToken } from "@/lib/switchboard/live-call";
import { matchTarget } from "@/lib/switchboard/types";
import type { TablesInsert } from "@/lib/database.types";

// POST /api/switchboard/tools/message — the receptionist's take_message tool.
//
// Writes the message onto the call row AND onto the contact timeline, so it
// surfaces where the team already looks rather than only inside the switchboard.
export const dynamic = "force-dynamic";
export const maxDuration = 20;

interface Body {
  caller_name?: string;
  callback_number?: string;
  message?: string;
  for_person?: string;
  callback_window?: string;
}

export async function POST(request: NextRequest) {
  const token =
    request.headers.get("x-switchboard-token") || request.nextUrl.searchParams.get("token");
  const service = createServiceClient();

  const settings = await settingsForToken(service, token);
  if (!settings) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({
      success: false,
      message: "I need to know what the message is about before I can save it.",
    });
  }

  const call = await findLiveCall(service, settings.workspace_id);
  const callerName = (body.caller_name ?? "").trim() || null;
  // Prefer what the caller dictated; fall back to the number they rang from.
  const callback =
    normalizePhone(body.callback_number) ||
    (body.callback_number ?? "").trim() ||
    call?.caller_number ||
    null;

  // Who the message is for, when the caller named someone we know.
  const targets = await loadTargets(service, settings.workspace_id);
  const forTarget = matchTarget(body.for_person, targets);

  const parts = [
    `Message taken by the switchboard${forTarget ? ` for ${forTarget.label}` : ""}.`,
    callerName ? `From: ${callerName}` : null,
    callback ? `Call back on: ${callback}` : null,
    body.callback_window?.trim() ? `Asked to be called: ${body.callback_window.trim()}` : null,
    ``,
    message,
  ].filter((l) => l !== null);
  const bodyText = parts.join("\n");

  if (call) {
    await service
      .from("switchboard_calls")
      .update({
        message_body: bodyText,
        caller_name: callerName ?? call.caller_name,
        outcome: body.callback_window?.trim() ? "callback_booked" : "message_taken",
        requested_label: forTarget?.label ?? call.requested_label,
        target_id: forTarget?.id ?? call.target_id,
        target_user_id: forTarget?.user_id ?? call.target_user_id,
      })
      .eq("id", call.id);
  }

  // Timeline entry, so the message shows up on the contact like any other call.
  const activity: TablesInsert<"activities"> = {
    workspace_id: settings.workspace_id,
    type: "call",
    contact_id: call?.contact_id ?? null,
    company_id: call?.company_id ?? null,
    user_id: forTarget?.user_id ?? null,
    subject: `Phone message${callerName ? ` from ${callerName}` : ""}`,
    body: bodyText,
    outcome: body.callback_window?.trim() ? "callback_scheduled" : null,
    metadata: {
      source: "switchboard",
      persona: settings.persona_name,
      caller_number: call?.caller_number ?? null,
      callback_number: callback,
      for_person: forTarget?.label ?? body.for_person?.trim() ?? null,
      callback_window: body.callback_window?.trim() ?? null,
      switchboard_call_id: call?.id ?? null,
    },
  };
  // Inserts here are best-effort: a failed timeline write must not cost us the
  // message, which is already safe on the call row.
  const { error } = await service.from("activities").insert(activity);
  if (error) console.error("switchboard message activity insert failed", error.message);

  return NextResponse.json({
    success: true,
    message:
      `The message is saved${forTarget ? ` for ${forTarget.label}` : ""}. Tell the caller it has ` +
      `been passed on and that someone will get back to them, then end the call.`,
  });
}

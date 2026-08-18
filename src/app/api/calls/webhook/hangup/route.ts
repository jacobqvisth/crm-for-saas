import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processCallSession } from "@/lib/calls/process";

// Public webhook hit by 46elks when a bridged call ends / a recording is ready.
// 46elks doesn't send auth headers, so we embed a shared secret in the URL
// (?token=) and verify it here. The endpoint is idempotent — 46elks may call
// the recordcall, next, and whenhangup actions, all pointed here.
export const maxDuration = 300;

function pick(form: FormData, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = form.get(k);
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/**
 * Finalise a switchboard call.
 *
 * The outcome is inferred from how far the call got: `connected` means a human
 * picked up, `voicemail` means nobody did, and anything still sitting with the
 * receptionist means it handled the call on its own. An outcome already recorded
 * by a tool (a message taken, a booked callback) always wins.
 */
async function closeSwitchboardCall(
  supabase: ReturnType<typeof createServiceClient>,
  elksCallId: string,
  duration: number | null,
): Promise<void> {
  const { data: call } = await supabase
    .from("switchboard_calls")
    .select("id, status, outcome")
    .eq("elks_call_id", elksCallId)
    .maybeSingle();
  if (!call || call.status === "ended") return;

  const inferred =
    call.status === "connected"
      ? "forwarded"
      : call.status === "voicemail"
        ? "voicemail"
        : call.status === "forwarding"
          ? "no_answer"
          : "handled_by_agent";

  await supabase
    .from("switchboard_calls")
    .update({
      status: "ended",
      outcome: call.outcome ?? inferred,
      ended_at: new Date().toISOString(),
      ...(typeof duration === "number" && !Number.isNaN(duration)
        ? { duration_seconds: duration }
        : {}),
    })
    .eq("id", call.id);
}

export async function POST(request: NextRequest) {
  // Fail CLOSED: without a configured secret this endpoint would accept
  // unauthenticated posts. Security finding H3.
  const expected = process.env.CALL_WEBHOOK_SECRET;
  if (!expected) {
    console.error("hangup webhook: CALL_WEBHOOK_SECRET is not set — rejecting");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const token = request.nextUrl.searchParams.get("token");
  if (token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: true }); // nothing actionable
  }

  const callId = pick(form, "callid", "id");
  const recordingUrl = pick(form, "recordingurl", "wav", "recording", "recording_url");
  const durationRaw = pick(form, "duration");
  const duration = durationRaw ? parseInt(durationRaw, 10) : null;

  if (!callId) return NextResponse.json({ ok: true });

  const supabase = createServiceClient();

  const { data: session } = await supabase
    .from("call_sessions")
    .select("id, status, recording_url, initiated_by")
    .eq("provider_call_id", callId)
    .maybeSingle();

  if (!session) return NextResponse.json({ ok: true });

  // Switchboard calls close out their own row too, so the Phone System page can
  // report what happened to each inbound call. Idempotent: 46elks may hit this
  // endpoint more than once per call (recordcall, next and whenhangup all point
  // here), so an already-ended row keeps its first outcome.
  if (session.initiated_by === "switchboard") {
    await closeSwitchboardCall(supabase, callId, duration);
  }

  const update: Record<string, unknown> = { ended_at: new Date().toISOString() };
  if (typeof duration === "number" && !Number.isNaN(duration)) update.duration_seconds = duration;
  if (recordingUrl && !session.recording_url) update.recording_url = recordingUrl;

  // Move to "completed" unless we've already advanced past it.
  if (!["processing", "processed"].includes(session.status)) {
    update.status = "completed";
  }
  await supabase.from("call_sessions").update(update).eq("id", session.id);

  // Kick AI processing once, after the response, when a recording is available
  // and we haven't already started/finished.
  const haveRecording = recordingUrl || session.recording_url;
  const alreadyHandled = ["processing", "processed"].includes(session.status);
  if (haveRecording && !alreadyHandled) {
    after(async () => {
      try {
        await processCallSession(supabase, session.id);
      } catch (err) {
        console.error("hangup webhook: processCallSession failed", err);
      }
    });
  }

  return NextResponse.json({ ok: true });
}

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

export async function POST(request: NextRequest) {
  // Verify shared secret when one is configured.
  const expected = process.env.CALL_WEBHOOK_SECRET;
  if (expected) {
    const token = request.nextUrl.searchParams.get("token");
    if (token !== expected) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
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
    .select("id, status, recording_url")
    .eq("provider_call_id", callId)
    .maybeSingle();

  if (!session) return NextResponse.json({ ok: true });

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
